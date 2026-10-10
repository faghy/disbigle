import { loadConfig } from '@disbigle/config';
import { createDatabase } from '@disbigle/db';
import { Redis } from 'ioredis';
import { buildApp } from './app.ts';
import { RedisKeyValueStore } from './kv.ts';
import { RedisEventBus, StreamingHub, subscribeHubToRedis } from './streaming.ts';

const config = loadConfig();
const { db, close } = createDatabase(config.DATABASE_URL);
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

const subscriber = new Redis(config.REDIS_URL);
const ctx = { db, config, kv: new RedisKeyValueStore(redis), events: new RedisEventBus(redis) };
const hub = new StreamingHub(ctx);
await subscribeHubToRedis(subscriber, hub);

const app = await buildApp({
  ctx,
  redis,
  hub,
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
