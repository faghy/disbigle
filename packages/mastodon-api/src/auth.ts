import { type CoreContext, sha256 } from '@disbigle/core';
import { schema } from '@disbigle/db';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { MastodonError } from './http.ts';
import { scopeAllows } from './oauth/scopes.ts';
import type { OAuthApplication, OAuthStore, OAuthToken } from './oauth/store.ts';

export interface AuthUser {
  userId: string;
  actorId: string;
  role: 'user' | 'moderator' | 'admin';
  locale: string;
}

export type AuthState =
  | { kind: 'none' }
  | { kind: 'invalid'; message: string; status: number }
  | { kind: 'ok'; token: OAuthToken; application: OAuthApplication | null; user: AuthUser | null };

declare module 'fastify' {
  interface FastifyRequest {
    /** OAuth state of a Mastodon API request, resolved by the Mastodon plugin. */
    mastodonAuth: AuthState;
  }
}

/** The bearer token of a request: header, `access_token` query, or WebSocket subprotocol. */
export function extractToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header) {
    const match = /^bearer\s+(.+)$/i.exec(header.trim());
    if (match?.[1]) return match[1].trim();
  }
  const query = request.query as Record<string, unknown> | undefined;
  const fromQuery = query?.access_token;
  if (typeof fromQuery === 'string' && fromQuery) return fromQuery;
  const protocol = request.headers['sec-websocket-protocol'];
  if (request.headers.upgrade?.toLowerCase() === 'websocket' && typeof protocol === 'string') {
    const first = protocol.split(',')[0]?.trim();
    if (first) return first;
  }
  return null;
}

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export async function resolveAuth(
  ctx: CoreContext,
  store: OAuthStore,
  request: FastifyRequest,
): Promise<AuthState> {
  const raw = extractToken(request);
  if (!raw) return { kind: 'none' };
  const token = await store.findActiveToken(sha256(raw));
  if (!token) return { kind: 'invalid', message: 'The access token is invalid', status: 401 };
  const application = await store.findApplication(token.applicationId);
  if (!application) return { kind: 'invalid', message: 'The access token is invalid', status: 401 };

  let user: AuthUser | null = null;
  if (token.userId) {
    const [row] = await ctx.db
      .select({ user: schema.users, actor: schema.actors })
      .from(schema.users)
      .innerJoin(schema.actors, eq(schema.actors.id, schema.users.actorId))
      .where(eq(schema.users.id, token.userId));
    if (!row) return { kind: 'invalid', message: 'The access token is invalid', status: 401 };
    if (
      row.user.disabledAt ||
      !row.user.approved ||
      row.user.deletionRequestedAt ||
      row.actor.suspendedAt
    ) {
      return { kind: 'invalid', message: 'Your login is currently disabled', status: 403 };
    }
    user = {
      userId: row.user.id,
      actorId: row.actor.id,
      role: row.user.role,
      locale: row.user.locale,
    };
  }
  const now = new Date();
  if (!token.lastUsedAt || now.getTime() - token.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await store.touchToken(token.id, now);
  }
  return { kind: 'ok', token, application, user };
}

function checkScopes(token: OAuthToken, scopes: string[]) {
  if (scopes.length === 0) return;
  if (!scopes.some((scope) => scopeAllows(token.scopes, scope))) {
    throw new MastodonError(403, 'This action is outside the authorized scopes');
  }
}

/**
 * Requires a user token with one of `scopes` (any of them is enough, as with Doorkeeper's
 * `doorkeeper_authorize! :read, :'read:statuses'`).
 */
export function requireUser(request: FastifyRequest, ...scopes: string[]): AuthUser {
  const auth = request.mastodonAuth;
  if (auth.kind === 'none') throw new MastodonError(401, 'The access token is invalid');
  if (auth.kind === 'invalid') throw new MastodonError(auth.status, auth.message);
  checkScopes(auth.token, scopes);
  if (!auth.user) throw new MastodonError(422, 'This method requires an authenticated user');
  return auth.user;
}

/** The signed-in user when a valid token is present (scopes checked), otherwise null. */
export function optionalUser(request: FastifyRequest, ...scopes: string[]): AuthUser | null {
  const auth = request.mastodonAuth;
  if (auth.kind !== 'ok') return null;
  checkScopes(auth.token, scopes);
  return auth.user;
}

/** Viewer actor id for visibility checks (null when signed out). */
export function viewerId(request: FastifyRequest, ...scopes: string[]): string | null {
  return optionalUser(request, ...scopes)?.actorId ?? null;
}

/** Any valid token, user or application. */
export function requireToken(request: FastifyRequest) {
  const auth = request.mastodonAuth;
  if (auth.kind === 'none') throw new MastodonError(401, 'The access token is invalid');
  if (auth.kind === 'invalid') throw new MastodonError(auth.status, auth.message);
  return auth;
}
