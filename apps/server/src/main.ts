import {
  ActivityPubPublisher,
  CompositeEventBus,
  createDisbigleFederation,
  federationOrigin,
  resolveRemoteAccount,
} from '@disbigle/activitypub';
import { loadConfig } from '@disbigle/config';
import {
  type CoreContext,
  PushPublisher,
  processAccountImports,
  recordFailedDelivery,
} from '@disbigle/core';
import { createDatabase } from '@disbigle/db';
import {
  chainResolvers,
  DbRelayableStore,
  DiasporaBridge,
  DiasporaPublisher,
  diasporaRoutes,
  RedisJobQueue,
  startDiasporaQueue,
} from '@disbigle/diaspora-bridge';
import { MastodonPushPublisher } from '@disbigle/mastodon-api';
import { DrizzleOAuthStore } from '@disbigle/mastodon-api/drizzle-store';
import { DrizzleMastodonPushStore } from '@disbigle/mastodon-api/push-drizzle-store';
import { RedisKvStore, RedisMessageQueue } from '@fedify/redis';
import { Redis } from 'ioredis';
import { buildApp } from './app.ts';
import { RedisDailyCounters, RedisKeyValueStore } from './kv.ts';
import { SmtpMailer } from './mailer.ts';
import { findRemoteAccount } from './resolve.ts';
import {
  connectLiveEvents,
  RedisEventBus,
  StreamingHub,
  subscribeHubToRedis,
} from './streaming.ts';

const config = loadConfig();
const { db, close } = createDatabase(config.DATABASE_URL);
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

const subscriber = new Redis(config.REDIS_URL);
const ctx: CoreContext = {
  db,
  config,
  kv: new RedisKeyValueStore(redis),
  counters: new RedisDailyCounters(redis),
};
const federation = createDisbigleFederation({
  kv: new RedisKvStore(redis),
  queue: new RedisMessageQueue(() => new Redis(config.REDIS_URL)),
  // The worker process can drain the queue instead: set RUN_FEDERATION_QUEUE=false here.
  manuallyStartQueue: process.env.RUN_FEDERATION_QUEUE === 'false',
  origin: federationOrigin(config),
  onDeliveryFailure: (host) => recordFailedDelivery(ctx, host ?? 'unknown'),
});
const oauthStore = new DrizzleOAuthStore(db);
const mastodonPushStore = new DrizzleMastodonPushStore(db);
const diaspora = new DiasporaBridge({
  ctx,
  queue: new RedisJobQueue(redis),
  relayables: new DbRelayableStore(ctx),
});
// The worker can consume the diaspora queue instead: set RUN_DIASPORA_QUEUE=false here.
const diasporaQueue = new AbortController();
if (process.env.RUN_DIASPORA_QUEUE !== 'false') {
  void startDiasporaQueue(diaspora, { signal: diasporaQueue.signal });
}
// Unknown remote accounts: try ActivityPub first, then diaspora* (WebFinger + hCard).
ctx.resolveAccount = chainResolvers(
  async (username, domain) =>
    (await resolveRemoteAccount(federation, ctx, `${username}@${domain}`))?.id ?? null,
  diaspora.resolveAccount,
);
ctx.events = new CompositeEventBus([
  new RedisEventBus(redis),
  new ActivityPubPublisher(federation, ctx),
  new DiasporaPublisher(diaspora),
  new PushPublisher(ctx),
  new MastodonPushPublisher(ctx, { push: mastodonPushStore, oauth: oauthStore }),
]);
const hub = new StreamingHub(ctx);
await subscribeHubToRedis(subscriber, hub);
await connectLiveEvents(redis, subscriber, hub);

// Lists brought from other servers (follows, blocks, mutes): worked through here, where every
// protocol can find accounts. A Redis lock keeps one server process at it at a time.
const importTimer = setInterval(async () => {
  const lock = await redis.set(
    'disbigle:job:account-imports',
    String(process.pid),
    'PX',
    25_000,
    'NX',
  );
  if (!lock) return;
  try {
    await processAccountImports(ctx, async (address) => {
      const actor = await findRemoteAccount(federation, ctx, address).catch(() => null);
      return actor?.id ?? null;
    });
  } catch (error) {
    console.error('account imports failed', error);
  } finally {
    await redis.del('disbigle:job:account-imports');
  }
}, 20_000);

const app = await buildApp({
  ctx,
  redis,
  hub,
  federation,
  oauthStore,
  mastodonPushStore,
  ...(config.SMTP_URL ? { mailer: new SmtpMailer(config.SMTP_URL, config.MAIL_FROM) } : {}),
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  trustProxy: process.env.TRUST_PROXY === 'true',
  serveMedia: config.NODE_ENV !== 'production' || process.env.SERVE_MEDIA === 'true',
});
await app.register(diasporaRoutes, { ctx, bridge: diaspora });

const shutdown = async () => {
  clearInterval(importTimer);
  await app.close();
  diasporaQueue.abort();
  await close();
  redis.disconnect();
  subscriber.disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: config.HOST, port: config.PORT });
