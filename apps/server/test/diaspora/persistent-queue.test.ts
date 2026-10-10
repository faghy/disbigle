import { randomUUID } from 'node:crypto';
import { RedisJobQueue, startDiasporaQueue } from '@disbigle/diaspora-bridge';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventually, type Instance, signUp, startInstance } from './helpers.ts';

const prefix = `disbigle:test:${randomUUID()}`;
let redis: Redis | undefined;
let reachable = false;
let a: Instance | undefined;
let b: Instance | undefined;
const consumers: AbortController[] = [];

beforeAll(async () => {
  if (!process.env.REDIS_URL) return;
  redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  reachable = await redis
    .connect()
    .then(() => true)
    .catch(() => false);
  if (!reachable) return;
  const queue = (name: string) =>
    new RedisJobQueue(redis as Redis, { prefix: `${prefix}:${name}`, pollMs: 20 });
  [a, b] = await Promise.all([
    startInstance({ queue: queue('a'), consume: false }),
    startInstance({ queue: queue('b'), consume: false }),
  ]);
}, 60_000);

afterAll(async () => {
  for (const c of consumers) c.abort();
  await Promise.all([a?.close(), b?.close()]);
  if (redis && reachable) {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length > 0) await redis.del(...keys);
  }
  redis?.disconnect();
});

/** Runs the queue consumer of an instance, as the worker process would. */
function consume(instance: Instance): AbortController {
  const controller = new AbortController();
  consumers.push(controller);
  void startDiasporaQueue(instance.bridge, { signal: controller.signal, concurrency: 2 });
  return controller;
}

describe('diaspora* over a persistent Redis queue', () => {
  it('keeps outgoing work queued until a consumer runs', async (t) => {
    if (!reachable || !a || !b) t.skip();
    const [ia, ib] = [a as Instance, b as Instance];
    consume(ib);
    const consumerA = consume(ia);

    const alice = await signUp(ia);
    const bob = await signUp(ib);
    const bobOnA = await ia.bridge.resolvePerson(bob.diasporaId);
    await alice.client.post(`/api/v1/accounts/${bobOnA?.id}/follow`);
    await eventually(async () => {
      const list = (await bob.client.get(`/api/v1/accounts/${bob.account.id}/followers`)).json();
      return list.length === 1;
    });

    // B's consumer is down (a deploy, a crash): the post waits in Redis...
    const bobConsumer = consumers[0];
    bobConsumer?.abort();
    await bob.client.post('/api/v1/statuses', { content: 'scritto mentre il worker era fermo' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const home = (await alice.client.get('/api/v1/timelines/home')).json();
    expect(home.some((s: { content: string }) => s.content.includes('worker era fermo'))).toBe(
      false,
    );

    // ...and is delivered once a consumer is back.
    consume(ib);
    await eventually(async () => {
      const list = (await alice.client.get('/api/v1/timelines/home')).json();
      return list.some((s: { content: string }) => s.content.includes('worker era fermo'));
    });
    consumerA.abort();
  }, 60_000);
});
