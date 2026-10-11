import { backfillRemoteOutbox, resolveRemoteStatus } from '@disbigle/activitypub';
import {
  bridgedAccountByUsername,
  type CoreContext,
  isBridgeUsername,
  LocalMediaStorage,
  type Mailer,
  type MediaStorage,
  MemoryMailer,
} from '@disbigle/core';
import { type MastodonPushStore, mastodonApi, type OAuthStore } from '@disbigle/mastodon-api';
import { DrizzleOAuthStore } from '@disbigle/mastodon-api/drizzle-store';
import { DrizzleMastodonPushStore } from '@disbigle/mastodon-api/push-drizzle-store';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { fedifyPlugin } from '@fedify/fastify';
import type { Federation } from '@fedify/fedify';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Redis } from 'ioredis';
import { errorHandler } from './http.ts';
import { authPlugin } from './plugins/auth.ts';
import { findRemoteAccount } from './resolve.ts';
import { accountRoutes, followRequestRoutes } from './routes/accounts.ts';
import { adminRoutes, reportRoutes } from './routes/admin.ts';
import { aspectRoutes } from './routes/aspects.ts';
import { authRoutes } from './routes/auth.ts';
import { authorizedAppRoutes } from './routes/authorized-apps.ts';
import { filterRoutes } from './routes/filters.ts';
import { inviteRoutes } from './routes/invites.ts';
import { legacyDiasporaRoutes } from './routes/legacy.ts';
import { meRoutes } from './routes/me.ts';
import { mediaRoutes } from './routes/media.ts';
import { migrationRoutes } from './routes/migration.ts';
import { notificationRoutes } from './routes/notifications.ts';
import { pollRoutes } from './routes/polls.ts';
import { publicRoutes } from './routes/public.ts';
import { pushRoutes } from './routes/push.ts';
import { searchRoutes } from './routes/search.ts';
import { statusRoutes } from './routes/statuses.ts';
import { streamingRoutes } from './routes/streaming.ts';
import { tagRoutes } from './routes/tags.ts';
import { timelineRoutes } from './routes/timelines.ts';
import type { StreamingHub } from './streaming.ts';

export interface AppOptions {
  ctx: CoreContext;
  /** Shared rate-limit store; in-memory when omitted (tests, single process). */
  redis?: Redis;
  logger?: FastifyServerOptions['logger'];
  /** Receives domain events for WebSocket clients. */
  hub?: StreamingHub;
  trustProxy?: boolean;
  /** Where uploads are stored; local MEDIA_DIR by default. */
  storage?: MediaStorage;
  /** Serve MEDIA_DIR under /media (development; use the web server in production). */
  serveMedia?: boolean;
  /** ActivityPub federation; when set, its endpoints (actors, inboxes, WebFinger, NodeInfo) are served. */
  federation?: Federation<CoreContext>;
  /** Outgoing email; printed to the log when omitted. */
  mailer?: Mailer;
  /** OAuth persistence for Mastodon-compatible apps; PostgreSQL by default. */
  oauthStore?: OAuthStore;
  /** Push subscriptions of Mastodon apps; PostgreSQL by default. */
  mastodonPushStore?: MastodonPushStore;
  /** Disable rate limiting (tests only). */
  disableRateLimit?: boolean;
  /** Skip the anti-robot check on sign-up (tests only). */
  disableRegistrationGuard?: boolean;
}

const isFederationEndpoint = (url: string) =>
  /^\/(inbox|receive\/|users\/[^/]+\/inbox|\.well-known\/|nodeinfo|users\/|hcard\/|fetch\/)/.test(
    url,
  );

export async function buildApp(options: AppOptions) {
  const { ctx, redis, hub, logger = false, trustProxy = false, disableRateLimit = false } = options;
  const storage = options.storage ?? new LocalMediaStorage(ctx.config.MEDIA_DIR);
  const mediaCtx = { ...ctx, storage };
  const app = Fastify({ logger, trustProxy, bodyLimit: 1024 * 1024 });

  app.setErrorHandler(errorHandler);
  // Accept an empty body with a JSON content type (some clients send it on DELETE/POST).
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const text = typeof body === 'string' ? body : body.toString();
    if (text.trim() === '') return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch {
      const error = new Error('Invalid JSON body') as Error & { statusCode: number };
      error.statusCode = 400;
      done(error, undefined);
    }
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: 'not_found', message: 'Route not found' }),
  );

  // Registered before the federation plugin so inboxes are limited too. Servers deliver many
  // activities from few addresses, so federation endpoints get a higher allowance.
  if (!disableRateLimit) {
    await app.register(rateLimit, {
      global: true,
      // Development gets ten times the allowance: several tabs and test scripts are normal there.
      max: (request) =>
        (isFederationEndpoint(request.url) ? 3000 : 300) *
        (ctx.config.NODE_ENV === 'development' ? 10 : 1),
      timeWindow: '5 minutes',
      ...(redis ? { redis, nameSpace: 'disbigle:ratelimit:' } : {}),
    });
  }
  if (options.federation) {
    await app.register(fedifyPlugin, {
      federation: options.federation,
      contextDataFactory: () => ctx,
      errorHandlers: {
        // A browser opening an ActivityPub id (e.g. /users/alice) gets the web page instead.
        onNotAcceptable: async (request: Request) => {
          const path = new URL(request.url).pathname;
          const match = /^\/users\/([^/]+)(?:\/statuses\/([^/]+))?\/?$/.exec(path);
          if (!match?.[1])
            return new Response('Not Acceptable', { status: 406, headers: { Vary: 'Accept' } });
          let handle = match[1];
          if (isBridgeUsername(handle)) {
            // A bridge identity: show the account it stands for.
            const bridged = await bridgedAccountByUsername(ctx, handle);
            if (!bridged)
              return new Response('Not Found', { status: 404, headers: { Vary: 'Accept' } });
            handle = `${bridged.actor.username}@${bridged.actor.domain}`;
          }
          const target = match[2] ? `/@${handle}/${match[2]}` : `/@${handle}`;
          return new Response(null, { status: 302, headers: { Location: target, Vary: 'Accept' } });
        },
      },
    });
  }
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);
  await app.register(authPlugin, { ctx });
  await app.register(websocket, { options: { maxPayload: 4096 } });
  // Per-route calls add file size and count; these bound everything else in a form.
  await app.register(multipart, {
    limits: { fieldNameSize: 200, fieldSize: 64 * 1024, fields: 100, parts: 110 },
  });
  if (options.serveMedia) {
    const { mkdir } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const root = resolve(ctx.config.MEDIA_DIR);
    await mkdir(root, { recursive: true });
    await app.register(fastifyStatic, {
      root,
      prefix: '/media/',
      decorateReply: false,
      index: false,
    });
  }

  app.get('/health', async () => ({ status: 'ok' }));
  await app.register(legacyDiasporaRoutes, { ctx });

  await app.register(
    async (api) => {
      await api.register(publicRoutes, { ctx });
      await api.register(authRoutes, {
        ctx,
        mailer: options.mailer ?? new MemoryMailer(true),
        registrationGuard: !options.disableRegistrationGuard,
        prefix: '/auth',
      });
      await api.register(meRoutes, { ctx, mediaCtx, prefix: '/me' });
      await api.register(statusRoutes, { ctx, prefix: '/statuses' });
      await api.register(timelineRoutes, { ctx, prefix: '/timelines' });
      await api.register(accountRoutes, {
        ctx,
        ...(options.federation ? { federation: options.federation } : {}),
        prefix: '/accounts',
      });
      await api.register(followRequestRoutes, { ctx, prefix: '/follow_requests' });
      await api.register(aspectRoutes, { ctx, prefix: '/aspects' });
      await api.register(notificationRoutes, { ctx, prefix: '/notifications' });
      await api.register(mediaRoutes, { ctx: mediaCtx, prefix: '/media' });
      await api.register(reportRoutes, { ctx, prefix: '/reports' });
      await api.register(tagRoutes, { ctx, prefix: '/tags' });
      await api.register(pollRoutes, { ctx, prefix: '/polls' });
      await api.register(pushRoutes, { ctx, prefix: '/push' });
      await api.register(inviteRoutes, { ctx, prefix: '/invites' });
      await api.register(filterRoutes, { ctx, prefix: '/filters' });
      await api.register(adminRoutes, { ctx, prefix: '/admin' });
      if (options.federation) {
        await api.register(searchRoutes, {
          ctx,
          federation: options.federation,
          prefix: '/search',
        });
        await api.register(migrationRoutes, {
          ctx,
          federation: options.federation,
          prefix: '/me/migration',
        });
      }
      if (hub) await api.register(streamingRoutes, { hub, ctx, prefix: '/streaming' });
    },
    { prefix: '/api/v1' },
  );

  // Mastodon client API (Tusky, Ivory, Elk…) on the same paths, chosen per request.
  const federation = options.federation;
  const oauthStore = options.oauthStore ?? new DrizzleOAuthStore(ctx.db);
  await app.register(mastodonApi, {
    ctx,
    storage,
    store: oauthStore,
    pushStore: options.mastodonPushStore ?? new DrizzleMastodonPushStore(ctx.db),
    ...(hub ? { hub } : {}),
    ...(federation
      ? {
          resolveAccount: (q: string) => findRemoteAccount(federation, ctx, q),
          resolveStatus: (url: string) => resolveRemoteStatus(federation, ctx, url),
          backfillAccount: (actor) => backfillRemoteOutbox(federation, ctx, actor),
        }
      : {}),
  });
  await app.register(authorizedAppRoutes, { store: oauthStore, prefix: '/api/v1/me/apps' });
  // Signing in again elsewhere is required after a password change or reset: revoke app tokens too.
  app.addHook('onResponse', async (request, reply) => {
    if (reply.statusCode !== 200 || request.method !== 'POST') return;
    const path = request.url.split('?')[0];
    if (path === '/api/v1/me/password' && request.session) {
      await oauthStore.revokeUserTokens(request.session.userId);
    } else if (path === '/api/v1/auth/password/reset' && request.passwordResetUserId) {
      await oauthStore.revokeUserTokens(request.passwordResetUserId);
    }
  });

  return app;
}
