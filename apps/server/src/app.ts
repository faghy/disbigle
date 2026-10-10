import type { CoreContext } from '@disbigle/core';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Redis } from 'ioredis';
import { errorHandler } from './http.ts';
import { authPlugin } from './plugins/auth.ts';
import { authRoutes } from './routes/auth.ts';
import { meRoutes } from './routes/me.ts';
import { publicRoutes } from './routes/public.ts';

export interface AppOptions {
  ctx: CoreContext;
  /** Shared rate-limit store; in-memory when omitted (tests, single process). */
  redis?: Redis;
  logger?: FastifyServerOptions['logger'];
  trustProxy?: boolean;
}

export async function buildApp({ ctx, redis, logger = false, trustProxy = false }: AppOptions) {
  const app = Fastify({ logger, trustProxy, bodyLimit: 1024 * 1024 });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: 'not_found', message: 'Route not found' }),
  );

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '5 minutes',
    ...(redis ? { redis, nameSpace: 'disbigle:ratelimit:' } : {}),
  });
  await app.register(authPlugin, { ctx });

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(
    async (api) => {
      await api.register(publicRoutes, { ctx });
      await api.register(authRoutes, { ctx, prefix: '/auth' });
      await api.register(meRoutes, { ctx, prefix: '/me' });
    },
    { prefix: '/api/v1' },
  );

  return app;
}
