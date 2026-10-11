import { LocalMediaStorage } from '@disbigle/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { resolveAuth } from './auth.ts';
import { FLAVOUR_CONSTRAINT, flavourStrategy } from './dispatch.ts';
import { mastodonErrorHandler, parseFormBody } from './http.ts';
import { oauthRoutes } from './oauth/routes.ts';
import type { Deps, MastodonApiOptions } from './options.ts';
import { accountRoutes } from './routes/accounts.ts';
import { instanceRoutes } from './routes/instance.ts';
import { listRoutes } from './routes/lists.ts';
import { mediaRoutes } from './routes/media.ts';
import { notificationRoutes } from './routes/notifications.ts';
import { searchRoutes } from './routes/search.ts';
import { statusRoutes } from './routes/statuses.ts';
import { streamingRoutes } from './routes/streaming.ts';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers':
    'Link, X-RateLimit-Reset, X-RateLimit-Limit, X-RateLimit-Remaining',
} as const;

/**
 * Mastodon client API (OAuth 2, REST, streaming) on top of the Disbigle core. Register it on the
 * server app: `await app.register(mastodonApi, { ctx, store, hub, ... })`.
 *
 * In `shared` dispatch mode (default) the Mastodon routes use the same `/api/v1` paths as the
 * native API and carry a routing constraint, so Fastify picks them only for Mastodon requests
 * (see `deriveFlavour`). Everything is encapsulated: hooks, the error handler and the
 * form-encoded body parser apply to these routes only.
 */
export async function mastodonApi(app: FastifyInstance, opts: MastodonApiOptions) {
  const dispatch = opts.dispatch ?? 'shared';
  const options: Deps['options'] = {
    ...opts,
    sessionCookie: opts.sessionCookie ?? 'disbigle_session',
    loginPath: opts.loginPath ?? '/login',
    softwareVersion: opts.softwareVersion ?? '0.1.0',
  };
  const storage = opts.storage ?? new LocalMediaStorage(opts.ctx.config.MEDIA_DIR);
  const deps: Deps = {
    ctx: opts.ctx,
    mediaCtx: { ...opts.ctx, storage },
    store: opts.store,
    options,
    baseUrl: opts.ctx.config.PUBLIC_URL,
  };

  if (dispatch === 'shared') {
    if (!app.hasConstraintStrategy(FLAVOUR_CONSTRAINT)) {
      app.addConstraintStrategy(
        flavourStrategy({
          anonymous: opts.anonymous ?? 'mastodon',
          sessionCookie: options.sessionCookie,
        }),
      );
    }
    // Every route below is Mastodon-only unless it opts out with `config.anyFlavour`
    // (paths the native API does not use: /oauth, /api/v1/apps, /api/v2, ...).
    app.addHook('onRoute', (route) => {
      if (route.config?.anyFlavour || route.method === 'OPTIONS') return;
      route.constraints = { ...route.constraints, [FLAVOUR_CONSTRAINT]: 'mastodon' };
    });
  }

  app.setErrorHandler(mastodonErrorHandler);
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      done(null, parseFormBody(typeof body === 'string' ? body : body.toString()));
    },
  );

  app.decorateRequest('mastodonAuth', null as never);
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Browser-based clients (Elk, Phanpy) call from other origins; tokens, not cookies,
    // authenticate these requests, so a wildcard origin without credentials is safe.
    if (!request.url.startsWith('/oauth/authorize')) reply.headers(CORS_HEADERS);
    request.mastodonAuth = await resolveAuth(deps.ctx, deps.store, request);
  });

  // CORS preflight for API and token endpoints (preflights carry no token, so no constraint).
  const preflight = async (_request: FastifyRequest, reply: FastifyReply) =>
    reply
      .status(204)
      .headers({
        ...CORS_HEADERS,
        'access-control-allow-methods': 'GET, HEAD, POST, PUT, PATCH, DELETE',
        'access-control-allow-headers':
          'Authorization, Content-Type, Idempotency-Key, Accept, X-Disbigle-Api',
        'access-control-max-age': '86400',
      })
      .send();
  for (const path of ['/api/*', '/oauth/token', '/oauth/revoke']) {
    app.options(path, { config: { anyFlavour: true } }, preflight);
  }

  await oauthRoutes(app, deps);
  await accountRoutes(app, deps);
  await statusRoutes(app, deps);
  await notificationRoutes(app, deps);
  await listRoutes(app, deps);
  await mediaRoutes(app, deps);
  await searchRoutes(app, deps);
  await instanceRoutes(app, deps);
  if (opts.hub) await streamingRoutes(app, { ...deps, hub: opts.hub });
}
