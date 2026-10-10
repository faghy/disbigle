import type { CoreContext } from '@disbigle/core';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Redis } from 'ioredis';
import { errorHandler } from './http.ts';
import { authPlugin } from './plugins/auth.ts';
import { accountRoutes, followRequestRoutes } from './routes/accounts.ts';
import { aspectRoutes } from './routes/aspects.ts';
import { authRoutes } from './routes/auth.ts';
import { meRoutes } from './routes/me.ts';
import { notificationRoutes } from './routes/notifications.ts';
import { publicRoutes } from './routes/public.ts';
import { statusRoutes } from './routes/statuses.ts';
import { streamingRoutes } from './routes/streaming.ts';
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
  /** Disable rate limiting (tests only). */
  disableRateLimit?: boolean;
}

export async function buildApp(options: AppOptions) {
  const { ctx, redis, hub, logger = false, trustProxy = false, disableRateLimit = false } = options;
  const app = Fastify({ logger, trustProxy, bodyLimit: 1024 * 1024 });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: 'not_found', message: 'Route not found' }),
  );

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

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(
    async (api) => {
      await api.register(publicRoutes, { ctx });
      await api.register(authRoutes, { ctx, prefix: '/auth' });
      await api.register(meRoutes, { ctx, prefix: '/me' });
      await api.register(statusRoutes, { ctx, prefix: '/statuses' });
      await api.register(timelineRoutes, { ctx, prefix: '/timelines' });
      await api.register(accountRoutes, { ctx, prefix: '/accounts' });
      await api.register(followRequestRoutes, { ctx, prefix: '/follow_requests' });
      await api.register(aspectRoutes, { ctx, prefix: '/aspects' });
      await api.register(notificationRoutes, { ctx, prefix: '/notifications' });
      if (hub) await api.register(streamingRoutes, { hub, prefix: '/streaming' });
    },
    { prefix: '/api/v1' },
  );

  return app;
}
