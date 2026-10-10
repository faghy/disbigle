import { loadConfig } from '@disbigle/config';
import { createDatabase } from '@disbigle/db';
import { Redis } from 'ioredis';
import { buildApp } from './app.ts';
import { RedisKeyValueStore } from './kv.ts';

const config = loadConfig();
const { db, close } = createDatabase(config.DATABASE_URL);
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

const app = await buildApp({
  ctx: { db, config, kv: new RedisKeyValueStore(redis) },
  redis,
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  trustProxy: process.env.TRUST_PROXY === 'true',
});

const shutdown = async () => {
  await app.close();
  await close();
  redis.disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: config.HOST, port: config.PORT });
