import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type DiasporaJob,
  MAX_ATTEMPTS,
  MemoryJobQueue,
  PermanentJobError,
  RedisJobQueue,
  retryDelayMs,
} from '../src/queue.ts';

const job = (n: number): DiasporaJob => ({
  type: 'deliver',
  url: `https://pod.example/${n}`,
  body: 'x',
  contentType: 'text/plain',
});

const waitFor = async (check: () => boolean | Promise<boolean>, timeoutMs = 5_000) => {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('retry schedule', () => {
  it('retries deliveries for about two days', () => {
    let total = 0;
    for (let attempt = 1; attempt < MAX_ATTEMPTS.deliver; attempt++) {
      total += retryDelayMs(attempt, () => 0.5);
    }
    const days = total / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(1.8);
    expect(days).toBeLessThan(3);
    expect(retryDelayMs(1, () => 0.5)).toBe(30_000);
    expect(retryDelayMs(40, () => 0.5)).toBe(12 * 60 * 60 * 1000);
  });
});

describe('MemoryJobQueue', () => {
  it('runs jobs, retries failures and drops permanent ones', async () => {
    const failures: unknown[] = [];
    const queue = new MemoryJobQueue({ retryDelay: () => 5, onFailure: (e) => failures.push(e) });
    const attempts = new Map<string, number>();
    const abort = new AbortController();
    void queue.listen(
      async (j) => {
        if (j.type !== 'deliver') return;
        const n = (attempts.get(j.url) ?? 0) + 1;
        attempts.set(j.url, n);
        if (j.url.endsWith('/1') && n < 3) throw new Error('flaky');
        if (j.url.endsWith('/2')) throw new PermanentJobError('gone');
      },
      { signal: abort.signal },
    );
    await queue.enqueue(job(1));
    await queue.enqueue(job(2));
    await waitFor(() => attempts.get('https://pod.example/1') === 3 && failures.length === 1);
    expect(attempts.get('https://pod.example/2')).toBe(1);
    abort.abort();
  });
});

const redisUrl = process.env.REDIS_URL;
let redis: Redis | undefined;
let reachable = false;

beforeAll(async () => {
  if (!redisUrl) return;
  redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  reachable = await redis
    .connect()
    .then(() => true)
    .catch(() => false);
});

afterAll(async () => {
  redis?.disconnect();
});

describe('RedisJobQueue', () => {
  const prefix = `disbigle:test:${randomUUID()}`;

  afterAll(async () => {
    if (!reachable || !redis) return;
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  it('persists jobs across consumers, retries with backoff and dead-letters', async (t) => {
    if (!reachable || !redis) t.skip();
    const conn = redis as Redis;
    const failures: unknown[] = [];
    // Jobs enqueued while nobody consumes (e.g. before a restart)...
    const producer = new RedisJobQueue(conn, { prefix });
    await producer.enqueue(job(1));
    await producer.enqueue(job(2));
    expect(await producer.stats()).toMatchObject({ ready: 2 });

    // ...are consumed by a new process.
    const consumer = new RedisJobQueue(conn, {
      prefix,
      pollMs: 20,
      retryDelay: () => 50,
      onFailure: (e) => failures.push(e),
    });
    const seen = new Map<string, number>();
    const abort = new AbortController();
    const running = consumer.listen(
      async (j) => {
        if (j.type !== 'deliver') return;
        const n = (seen.get(j.url) ?? 0) + 1;
        seen.set(j.url, n);
        if (j.url.endsWith('/1') && n < 2) throw new Error('flaky');
        if (j.url.endsWith('/2')) throw new PermanentJobError('gone');
      },
      { signal: abort.signal, concurrency: 2 },
    );
    await waitFor(() => seen.get('https://pod.example/1') === 2 && failures.length === 1);
    await consumer.idle();
    expect(await consumer.stats()).toEqual({ ready: 0, delayed: 0, inflight: 0, dead: 1 });
    abort.abort();
    await running;
  });

  it('hands a job held by a crashed consumer to another one after the lease', async (t) => {
    if (!reachable || !redis) t.skip();
    const conn = redis as Redis;
    const crashing = new RedisJobQueue(conn, {
      prefix: `${prefix}:lease`,
      pollMs: 20,
      leaseMs: 200,
    });
    await crashing.enqueue(job(3));
    const abortCrash = new AbortController();
    let taken = false;
    void crashing.listen(
      async () => {
        taken = true;
        await new Promise(() => {}); // never finishes, like a process that died
      },
      { signal: abortCrash.signal, concurrency: 1 },
    );
    await waitFor(() => taken);
    abortCrash.abort();

    const rescuer = new RedisJobQueue(conn, {
      prefix: `${prefix}:lease`,
      pollMs: 20,
      leaseMs: 200,
    });
    let done = false;
    const abort = new AbortController();
    const running = rescuer.listen(
      async () => {
        done = true;
      },
      { signal: abort.signal, concurrency: 1 },
    );
    await waitFor(() => done);
    abort.abort();
    await running;
  });
});
