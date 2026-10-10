import { type CoreContext, DomainError, resolveSession, type SessionInfo } from '@disbigle/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

export const SESSION_COOKIE = 'disbigle_session';

declare module 'fastify' {
  interface FastifyRequest {
    /** The resolved session, if the request carries a valid session cookie (any stage). */
    session: SessionInfo | null;
    sessionToken: string | null;
  }
}

export function setSessionCookie(
  reply: FastifyReply,
  ctx: CoreContext,
  token: string,
  expiresAt: Date,
) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.PUBLIC_URL.startsWith('https://'),
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Requires a fully signed-in session; returns it with a non-null type. */
export function requireUser(request: FastifyRequest): SessionInfo {
  const session = request.session;
  if (session?.stage !== 'active') throw new DomainError('unauthorized', 'Sign in required');
  return session;
}

export const authPlugin = fp(async (app: FastifyInstance, opts: { ctx: CoreContext }) => {
  app.decorateRequest('session', null);
  app.decorateRequest('sessionToken', null);

  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    request.sessionToken = token;
    request.session = await resolveSession(opts.ctx, token);
  });

  // CSRF defence in depth: cookie-authenticated writes must come from our own origin.
  // (JSON bodies already require a CORS preflight, and the cookie is SameSite=Lax.)
  const allowedOrigin = new URL(opts.ctx.config.PUBLIC_URL).origin;
  app.addHook('onRequest', async (request) => {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS')
      return;
    const origin = request.headers.origin;
    if (origin && origin !== allowedOrigin && request.cookies[SESSION_COOKIE]) {
      throw new DomainError('forbidden', 'Cross-origin request refused');
    }
  });
});

/** Requires a signed-in moderator or administrator. */
export function requireModerator(request: FastifyRequest): SessionInfo {
  const session = requireUser(request);
  if (session.role === 'user') throw new DomainError('forbidden', 'Moderators only');
  return session;
}

/** Requires a signed-in administrator. */
export function requireAdmin(request: FastifyRequest): SessionInfo {
  const session = requireUser(request);
  if (session.role !== 'admin') throw new DomainError('forbidden', 'Administrators only');
  return session;
}
