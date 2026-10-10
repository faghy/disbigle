import {
  ActivityPubPublisher,
  CompositeEventBus,
  createDisbigleFederation,
} from '@disbigle/activitypub';
import { loadConfig } from '@disbigle/config';
import { type CoreContext, LocalMediaStorage } from '@disbigle/core';
import { createDatabase } from '@disbigle/db';
import {
  DbRelayableStore,
  DiasporaBridge,
  DiasporaPublisher,
  RedisJobQueue,
  startDiasporaQueue,
} from '@disbigle/diaspora-bridge';
import { RedisKvStore, RedisMessageQueue } from '@fedify/redis';
import { Redis } from 'ioredis';
import { scheduledJobs } from './jobs.ts';

/**
 * Background process: drains the federation delivery queue and runs periodic maintenance.
 * Run one or more of these next to the API servers; scheduled jobs use a Redis lock so each run
 * happens once even with several workers.
 */
const config = loadConfig();
const { db, close } = createDatabase(config.DATABASE_URL);
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

const ctx: CoreContext = {
  db,
  config,
  kv: { get: async () => null, set: async () => {}, del: async () => {} },
};
const federation = createDisbigleFederation({
  kv: new RedisKvStore(redis),
  queue: new RedisMessageQueue(() => new Redis(config.REDIS_URL)),
  manuallyStartQueue: true,
});
const publishChannel = new Redis(config.REDIS_URL);
const diaspora = new DiasporaBridge({
  ctx,
  queue: new RedisJobQueue(redis),
  relayables: new DbRelayableStore(ctx),
});
ctx.events = new CompositeEventBus([
  {
    publish: async (event) =>
      void (await publishChannel.publish('disbigle:events', JSON.stringify(event))),
  },
  new ActivityPubPublisher(federation, ctx),
  new DiasporaPublisher(diaspora),
]);

const abort = new AbortController();
void federation.startQueue(ctx, { signal: abort.signal });
console.log('worker: federation queue started');
void startDiasporaQueue(diaspora, { signal: abort.signal, concurrency: 8 });
console.log('worker: diaspora queue started');

const jobs = scheduledJobs({ ...ctx, storage: new LocalMediaStorage(config.MEDIA_DIR) });
const timers = jobs.map((job) =>
  setInterval(
    async () => {
      const lock = await redis.set(
        `disbigle:job:${job.name}`,
        String(process.pid),
        'PX',
        job.every - 1000,
        'NX',
      );
      if (!lock) return;
      try {
        console.log(`worker: ${job.name}: ${await job.run()}`);
      } catch (error) {
        console.error(`worker: ${job.name} failed`, error);
      }
    },
    Math.min(job.every, 60_000),
  ),
);

const shutdown = async () => {
  abort.abort();
  for (const timer of timers) clearInterval(timer);
  await close();
  redis.disconnect();
  publishChannel.disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
