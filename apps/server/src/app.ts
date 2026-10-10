import {
  type CoreContext,
  LocalMediaStorage,
  type Mailer,
  type MediaStorage,
  MemoryMailer,
} from '@disbigle/core';
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
import { accountRoutes, followRequestRoutes } from './routes/accounts.ts';
import { adminRoutes, reportRoutes } from './routes/admin.ts';
import { aspectRoutes } from './routes/aspects.ts';
import { authRoutes } from './routes/auth.ts';
import { legacyDiasporaRoutes } from './routes/legacy.ts';
import { meRoutes } from './routes/me.ts';
import { mediaRoutes } from './routes/media.ts';
import { migrationRoutes } from './routes/migration.ts';
import { notificationRoutes } from './routes/notifications.ts';
import { publicRoutes } from './routes/public.ts';
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
  /** Disable rate limiting (tests only). */
  disableRateLimit?: boolean;
}

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

  if (options.federation) {
    await app.register(fedifyPlugin, {
      federation: options.federation,
      contextDataFactory: () => ctx,
      errorHandlers: {
        // A browser opening an ActivityPub id (e.g. /users/alice) gets the web page instead.
        onNotAcceptable: (request: Request) => {
          const path = new URL(request.url).pathname;
          const match = /^\/users\/([^/]+)(?:\/statuses\/([^/]+))?\/?$/.exec(path);
          if (!match)
            return new Response('Not Acceptable', { status: 406, headers: { Vary: 'Accept' } });
          const target = match[2] ? `/@${match[1]}/${match[2]}` : `/@${match[1]}`;
          return new Response(null, { status: 302, headers: { Location: target, Vary: 'Accept' } });
        },
      },
    });
  }
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);
  if (!disableRateLimit) {
    await app.register(rateLimit, {
      global: true,
      max: 300,
      timeWindow: '5 minutes',
      ...(redis ? { redis, nameSpace: 'disbigle:ratelimit:' } : {}),
    });
  }
  await app.register(authPlugin, { ctx });
  await app.register(websocket, { options: { maxPayload: 4096 } });
  await app.register(multipart);
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
        prefix: '/auth',
      });
      await api.register(meRoutes, { ctx, mediaCtx, prefix: '/me' });
      await api.register(statusRoutes, { ctx, prefix: '/statuses' });
      await api.register(timelineRoutes, { ctx, prefix: '/timelines' });
      await api.register(accountRoutes, { ctx, prefix: '/accounts' });
      await api.register(followRequestRoutes, { ctx, prefix: '/follow_requests' });
      await api.register(aspectRoutes, { ctx, prefix: '/aspects' });
      await api.register(notificationRoutes, { ctx, prefix: '/notifications' });
      await api.register(mediaRoutes, { ctx: mediaCtx, prefix: '/media' });
      await api.register(reportRoutes, { ctx, prefix: '/reports' });
      await api.register(tagRoutes, { ctx, prefix: '/tags' });
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
      if (hub) await api.register(streamingRoutes, { hub, prefix: '/streaming' });
    },
    { prefix: '/api/v1' },
  );

  return app;
}
