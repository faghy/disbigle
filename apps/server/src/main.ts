import {
  ActivityPubPublisher,
  CompositeEventBus,
  createDisbigleFederation,
  resolveRemoteAccount,
} from '@disbigle/activitypub';
import { loadConfig } from '@disbigle/config';
import type { CoreContext } from '@disbigle/core';
import { createDatabase } from '@disbigle/db';
import { RedisKvStore, RedisMessageQueue } from '@fedify/redis';
import { Redis } from 'ioredis';
import { buildApp } from './app.ts';
import { RedisKeyValueStore } from './kv.ts';
import { SmtpMailer } from './mailer.ts';
import { RedisEventBus, StreamingHub, subscribeHubToRedis } from './streaming.ts';

const config = loadConfig();
const { db, close } = createDatabase(config.DATABASE_URL);
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

const subscriber = new Redis(config.REDIS_URL);
const ctx: CoreContext = { db, config, kv: new RedisKeyValueStore(redis) };
const federation = createDisbigleFederation({
  kv: new RedisKvStore(redis),
  queue: new RedisMessageQueue(() => new Redis(config.REDIS_URL)),
  // The worker process can drain the queue instead: set RUN_FEDERATION_QUEUE=false here.
  manuallyStartQueue: process.env.RUN_FEDERATION_QUEUE === 'false',
});
ctx.resolveAccount = async (username, domain) =>
  (await resolveRemoteAccount(federation, ctx, `${username}@${domain}`))?.id ?? null;
ctx.events = new CompositeEventBus([
  new RedisEventBus(redis),
  new ActivityPubPublisher(federation, ctx),
]);
const hub = new StreamingHub(ctx);
await subscribeHubToRedis(subscriber, hub);

const app = await buildApp({
  ctx,
  redis,
  hub,
  federation,
  ...(config.SMTP_URL ? { mailer: new SmtpMailer(config.SMTP_URL, config.MAIL_FROM) } : {}),
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  trustProxy: process.env.TRUST_PROXY === 'true',
  serveMedia: config.NODE_ENV !== 'production' || process.env.SERVE_MEDIA === 'true',
});

const shutdown = async () => {
  await app.close();
  await close();
  redis.disconnect();
  subscriber.disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: config.HOST, port: config.PORT });
