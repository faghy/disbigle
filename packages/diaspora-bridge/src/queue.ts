// Background jobs of the diaspora* bridge: deliveries, received messages and domain events.
// Two implementations: in memory (tests, single process without Redis) and Redis (persistent,
// shared by the API servers and the worker).
import { randomUUID } from 'node:crypto';
import type { DomainEvent } from '@disbigle/core';
import type { Redis } from 'ioredis';

/** A unit of background work. Everything in it is plain JSON. */
export type DiasporaJob =
  | { type: 'deliver'; url: string; body: string; contentType: string }
  | { type: 'receive-public'; body: string }
  | { type: 'receive-private'; recipientGuid: string; body: string }
  | { type: 'event'; event: DomainEvent };

export type JobHandler = (job: DiasporaJob) => Promise<void>;

/** Thrown by a handler when retrying cannot help (e.g. a 4xx answer, a bad signature). */
export class PermanentJobError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PermanentJobError';
  }
}

export interface ListenOptions {
  signal?: AbortSignal;
  /** Jobs processed in parallel by this consumer. */
  concurrency?: number;
}

export interface JobQueue {
  enqueue(job: DiasporaJob): Promise<void>;
  /** Consumes jobs until `signal` aborts. Resolves when stopped. */
  listen(handler: JobHandler, options?: ListenOptions): Promise<void>;
  /** Resolves when nothing is queued or running (retries scheduled for later are not waited for). */
  idle(): Promise<void>;
}

/** Maximum attempts per job type. Deliveries are retried for about two days. */
export const MAX_ATTEMPTS: Record<DiasporaJob['type'], number> = {
  deliver: 15,
  'receive-public': 5,
  'receive-private': 5,
  event: 4,
};

/**
 * Delay before attempt `attempt + 1` (attempt starts at 1): 30 s doubling up to 12 h, with ±10%
 * jitter. 15 attempts span about 2.2 days.
 */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000 * 2 ** (attempt - 1), 12 * 60 * 60 * 1000);
  return Math.round(base * (0.9 + 0.2 * random()));
}

/** What happens to a failed job. */
function nextStep(job: DiasporaJob, attempt: number, error: unknown): 'retry' | 'drop' {
  if (error instanceof PermanentJobError) return 'drop';
  return attempt < MAX_ATTEMPTS[job.type] ? 'retry' : 'drop';
}

export type FailureListener = (error: unknown, job: DiasporaJob, attempt: number) => void;

const defaultOnFailure: FailureListener = (error, job, attempt) =>
  console.error(`diaspora: ${job.type} job failed for good after ${attempt} attempt(s)`, error);

// ---------------------------------------------------------------------------

interface MemoryEntry {
  job: DiasporaJob;
  attempt: number;
}

/** In-process queue. Not persistent; retries use timers. */
export class MemoryJobQueue implements JobQueue {
  private readonly pending: MemoryEntry[] = [];
  private readonly timers = new Set<NodeJS.Timeout>();
  private handler: JobHandler | undefined;
  private concurrency = 4;
  private running = 0;
  private waiters: Array<() => void> = [];

  constructor(
    private readonly options: {
      onFailure?: FailureListener;
      /** Disable retries (tests). */
      retries?: boolean;
      retryDelay?: (attempt: number) => number;
    } = {},
  ) {}

  async enqueue(job: DiasporaJob): Promise<void> {
    this.pending.push({ job, attempt: 1 });
    this.drain();
  }

  listen(handler: JobHandler, options: ListenOptions = {}): Promise<void> {
    this.handler = handler;
    this.concurrency = options.concurrency ?? 4;
    this.drain();
    return new Promise((resolve) => {
      options.signal?.addEventListener('abort', () => {
        this.handler = undefined;
        for (const timer of this.timers) clearTimeout(timer);
        this.timers.clear();
        resolve();
      });
    });
  }

  idle(): Promise<void> {
    if (this.running === 0 && (this.pending.length === 0 || !this.handler)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private drain(): void {
    const handler = this.handler;
    if (!handler) return;
    while (this.running < this.concurrency && this.pending.length > 0) {
      const entry = this.pending.shift();
      if (!entry) break;
      this.running++;
      handler(entry.job)
        .catch((error) => this.failed(entry, error))
        .finally(() => {
          this.running--;
          this.drain();
          if (this.running === 0 && this.pending.length === 0) {
            const waiters = this.waiters;
            this.waiters = [];
            for (const resolve of waiters) resolve();
          }
        });
    }
  }

  private failed(entry: MemoryEntry, error: unknown): void {
    if (this.options.retries !== false && nextStep(entry.job, entry.attempt, error) === 'retry') {
      const delay = (this.options.retryDelay ?? retryDelayMs)(entry.attempt);
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.pending.push({ job: entry.job, attempt: entry.attempt + 1 });
        this.drain();
      }, delay);
      timer.unref();
      this.timers.add(timer);
      return;
    }
    (this.options.onFailure ?? defaultOnFailure)(error, entry.job, entry.attempt);
  }
}

// ---------------------------------------------------------------------------

/** Moves due retries and expired leases back to the ready list, then leases one job. */
const TAKE_SCRIPT = `
local now = tonumber(ARGV[1])
local due = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', now, 'LIMIT', 0, 100)
for _, m in ipairs(due) do
  redis.call('ZREM', KEYS[2], m)
  redis.call('LPUSH', KEYS[1], m)
end
local expired = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', now, 'LIMIT', 0, 100)
for _, m in ipairs(expired) do
  redis.call('ZREM', KEYS[3], m)
  redis.call('LPUSH', KEYS[1], m)
end
local job = redis.call('RPOP', KEYS[1])
if job then
  redis.call('ZADD', KEYS[3], now + tonumber(ARGV[2]), job)
end
return job`;

interface StoredJob {
  id: string;
  attempt: number;
  job: DiasporaJob;
}

export interface RedisJobQueueOptions {
  /** Key prefix, default `disbigle:diaspora`. */
  prefix?: string;
  /** How long a consumer may hold a job before another one takes it over (crash recovery). */
  leaseMs?: number;
  /** Idle polling interval. */
  pollMs?: number;
  /** Failed jobs kept for inspection in `<prefix>:dead`. */
  deadLetterLimit?: number;
  onFailure?: FailureListener;
  /** Delay before the next attempt (default `retryDelayMs`). */
  retryDelay?: (attempt: number) => number;
}

/**
 * Persistent queue on Redis (ioredis 5). Jobs survive restarts; a job held by a consumer that
 * dies is handed to another one after `leaseMs`. Keys:
 * `<prefix>:ready` (list), `<prefix>:delayed` (retries, zset by due time),
 * `<prefix>:inflight` (leases, zset by deadline), `<prefix>:dead` (list).
 */
export class RedisJobQueue implements JobQueue {
  private readonly keys: { ready: string; delayed: string; inflight: string; dead: string };
  private readonly leaseMs: number;
  private readonly pollMs: number;
  private readonly deadLetterLimit: number;
  private readonly onFailure: FailureListener;
  private readonly retryDelay: (attempt: number) => number;

  constructor(
    private readonly redis: Redis,
    options: RedisJobQueueOptions = {},
  ) {
    const prefix = options.prefix ?? 'disbigle:diaspora';
    this.keys = {
      ready: `${prefix}:ready`,
      delayed: `${prefix}:delayed`,
      inflight: `${prefix}:inflight`,
      dead: `${prefix}:dead`,
    };
    this.leaseMs = options.leaseMs ?? 10 * 60 * 1000;
    this.pollMs = options.pollMs ?? 500;
    this.deadLetterLimit = options.deadLetterLimit ?? 1000;
    this.onFailure = options.onFailure ?? defaultOnFailure;
    this.retryDelay = options.retryDelay ?? retryDelayMs;
  }

  async enqueue(job: DiasporaJob): Promise<void> {
    const stored: StoredJob = { id: randomUUID(), attempt: 1, job };
    await this.redis.lpush(this.keys.ready, JSON.stringify(stored));
  }

  async listen(handler: JobHandler, options: ListenOptions = {}): Promise<void> {
    const { signal } = options;
    const loops = Array.from({ length: options.concurrency ?? 4 }, () =>
      this.loop(handler, signal),
    );
    await Promise.all(loops);
  }

  async idle(): Promise<void> {
    for (;;) {
      const [ready, inflight, due] = await Promise.all([
        this.redis.llen(this.keys.ready),
        this.redis.zcard(this.keys.inflight),
        this.redis.zcount(this.keys.delayed, '-inf', Date.now()),
      ]);
      if (ready === 0 && inflight === 0 && due === 0) return;
      await sleep(50);
    }
  }

  /** Counts per state, for monitoring. */
  async stats() {
    const [ready, delayed, inflight, dead] = await Promise.all([
      this.redis.llen(this.keys.ready),
      this.redis.zcard(this.keys.delayed),
      this.redis.zcard(this.keys.inflight),
      this.redis.llen(this.keys.dead),
    ]);
    return { ready, delayed, inflight, dead };
  }

  private async take(): Promise<string | null> {
    const result = await this.redis.eval(
      TAKE_SCRIPT,
      3,
      this.keys.ready,
      this.keys.delayed,
      this.keys.inflight,
      Date.now(),
      this.leaseMs,
    );
    return typeof result === 'string' ? result : null;
  }

  private async loop(handler: JobHandler, signal: AbortSignal | undefined): Promise<void> {
    while (!signal?.aborted) {
      let raw: string | null;
      try {
        raw = await this.take();
      } catch (error) {
        console.error('diaspora: queue unavailable', error);
        await sleep(this.pollMs * 4, signal);
        continue;
      }
      if (!raw) {
        await sleep(this.pollMs, signal);
        continue;
      }
      await this.run(raw, handler);
    }
  }

  private async run(raw: string, handler: JobHandler): Promise<void> {
    let stored: StoredJob;
    try {
      stored = JSON.parse(raw) as StoredJob;
    } catch {
      await this.redis.zrem(this.keys.inflight, raw);
      return;
    }
    try {
      await handler(stored.job);
      await this.redis.zrem(this.keys.inflight, raw);
    } catch (error) {
      const step = nextStep(stored.job, stored.attempt, error);
      const multi = this.redis.multi().zrem(this.keys.inflight, raw);
      if (step === 'retry') {
        const next: StoredJob = { ...stored, attempt: stored.attempt + 1 };
        multi.zadd(
          this.keys.delayed,
          Date.now() + this.retryDelay(stored.attempt),
          JSON.stringify(next),
        );
      } else {
        multi
          .lpush(
            this.keys.dead,
            JSON.stringify({ ...stored, error: String(error), failedAt: new Date().toISOString() }),
          )
          .ltrim(this.keys.dead, 0, this.deadLetterLimit - 1);
      }
      await multi.exec();
      if (step === 'drop') this.onFailure(error, stored.job, stored.attempt);
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
