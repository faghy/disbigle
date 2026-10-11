import { createHash, createHmac } from 'node:crypto';
import {
  getVapidKeys,
  randomToken,
  resolveSession,
  type SessionInfo,
  safeEqual,
  sha256,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireToken } from '../auth.ts';
import { body, type FormObject, MastodonError, parseQuery, str, strings } from '../http.ts';
import type { Deps } from '../options.ts';
import { codePage, consentPage, errorPage, PAGE_CSP, pickLang } from './page.ts';
import { isKnownScope, parseScopes, scopesWithin, supportedScopes } from './scopes.ts';
import type { OAuthApplication } from './store.ts';

export const OOB_REDIRECT = 'urn:ietf:wg:oauth:2.0:oob';
const CODE_TTL_MS = 10 * 60 * 1000;

/** RFC 6749 error response. */
class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
  }
}

function isValidRedirectUri(uri: string): boolean {
  if (uri === OOB_REDIRECT) return true;
  try {
    const url = new URL(uri);
    // Custom schemes (tusky://, ivory://) are fine; fragments are not allowed by RFC 6749.
    return (
      url.hash === '' && !['javascript:', 'data:', 'vbscript:', 'file:'].includes(url.protocol)
    );
  } catch {
    return false;
  }
}

export function serializeApplication(app: OAuthApplication, vapidKey?: string) {
  return {
    id: app.id,
    name: app.name,
    website: app.website,
    scopes: app.scopes,
    redirect_uri: app.redirectUris.join('\n'),
    redirect_uris: app.redirectUris,
    ...(vapidKey !== undefined ? { vapid_key: vapidKey } : {}),
  };
}

function readCookie(request: FastifyRequest, name: string): string | null {
  const header = request.headers.cookie ?? '';
  for (const part of header.split(/;\s*/)) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index) === name) {
      try {
        return decodeURIComponent(part.slice(index + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function pkceS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function withParams(uri: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) search.set(k, v);
  return `${uri}${uri.includes('?') ? '&' : '?'}${search.toString()}`;
}

/** OAuth 2 provider for client apps: registration, authorization code (+PKCE), tokens. */
export async function oauthRoutes(app: FastifyInstance, deps: Deps) {
  const { ctx, store, options, baseUrl } = deps;
  const anyFlavour = { config: { anyFlavour: true } };

  const vapidKey = async () => {
    try {
      return (await getVapidKeys(ctx)).publicKey;
    } catch {
      return '';
    }
  };

  // --- Client registration ---

  app.post('/api/v1/apps', anyFlavour, async (request) => {
    const input = body(request);
    const name = str(input.client_name)?.trim() ?? '';
    if (!name) throw new MastodonError(422, "Validation failed: Application name can't be blank");
    if (name.length > 255)
      throw new MastodonError(422, 'Validation failed: Application name is too long');
    const rawUris = Array.isArray(input.redirect_uris)
      ? strings(input.redirect_uris)
      : (str(input.redirect_uris) ?? '').split(/\s*\n\s*/);
    const redirectUris = [...new Set(rawUris.map((u) => u.trim()).filter(Boolean))];
    if (redirectUris.length === 0) {
      throw new MastodonError(422, "Validation failed: Redirect URI can't be blank");
    }
    if (!redirectUris.every(isValidRedirectUri)) {
      throw new MastodonError(422, 'Validation failed: Redirect URI must be an absolute URI.');
    }
    const scopes = parseScopes(str(input.scopes));
    const unknown = scopes.filter((s) => !isKnownScope(s));
    if (unknown.length > 0) {
      throw new MastodonError(422, `Validation failed: Scopes ${unknown.join(', ')} are invalid`);
    }
    const website = str(input.website)?.trim() || null;
    if (website && !/^https?:\/\/\S+$/.test(website)) {
      throw new MastodonError(422, 'Validation failed: Website is invalid');
    }
    const clientId = randomToken(32);
    const clientSecret = randomToken(32);
    const created = await store.createApplication({
      name,
      website,
      redirectUris,
      scopes,
      clientId,
      clientSecretHash: sha256(clientSecret),
    });
    return {
      ...serializeApplication(created, await vapidKey()),
      client_id: clientId,
      client_secret: clientSecret,
      client_secret_expires_at: 0,
    };
  });

  app.get('/api/v1/apps/verify_credentials', anyFlavour, async (request) => {
    const auth = requireToken(request);
    if (!auth.application) throw new MastodonError(401, 'The access token is invalid');
    return serializeApplication(auth.application, await vapidKey());
  });

  // --- Authorization endpoint ---

  const sessionOf = async (request: FastifyRequest): Promise<SessionInfo | null> => {
    const token = readCookie(request, options.sessionCookie);
    if (!token) return null;
    const session = await resolveSession(ctx, token);
    return session?.stage === 'active' ? session : null;
  };

  const csrfFor = (session: SessionInfo) =>
    createHmac('sha256', ctx.config.SESSION_SECRET)
      .update(`oauth-consent:${session.sessionId}`)
      .digest('base64url');

  const html = (reply: FastifyReply, status: number, page: string) =>
    reply
      .status(status)
      .header('content-type', 'text/html; charset=utf-8')
      .header('content-security-policy', PAGE_CSP)
      .header('cache-control', 'no-store')
      .send(page);

  interface AuthorizeRequest {
    app: OAuthApplication;
    redirectUri: string;
    scopes: string[];
    state: string | undefined;
    codeChallenge: string | null;
    codeChallengeMethod: 'S256' | null;
  }

  /** Validates authorize parameters; errors before the redirect URI is trusted are shown as a page. */
  const validateAuthorize = async (
    params: FormObject,
  ): Promise<{ ok: AuthorizeRequest } | { page: string } | { redirect: string }> => {
    const clientId = str(params.client_id) ?? '';
    const application = clientId ? await store.findApplicationByClientId(clientId) : null;
    if (!application) return { page: 'Unknown client application.' };
    const requested = str(params.redirect_uri);
    const redirectUri =
      requested ??
      (application.redirectUris.length === 1 ? application.redirectUris[0] : undefined);
    if (!redirectUri || !application.redirectUris.includes(redirectUri)) {
      return { page: 'The redirect URI is not registered for this application.' };
    }
    const state = str(params.state);
    const fail = (error: string, description: string) =>
      redirectUri === OOB_REDIRECT
        ? { page: description }
        : { redirect: withParams(redirectUri, { error, error_description: description, state }) };

    const responseType = str(params.response_type);
    if (responseType !== undefined && responseType !== 'code') {
      return fail('unsupported_response_type', 'Only response_type=code is supported.');
    }
    const scopes = parseScopes(str(params.scope));
    if (!scopes.every(isKnownScope) || !scopesWithin(scopes, application.scopes)) {
      return fail('invalid_scope', 'The requested scope is invalid, unknown, or malformed.');
    }
    const codeChallenge = str(params.code_challenge) || null;
    const method = str(params.code_challenge_method) || null;
    if (codeChallenge && method !== 'S256') {
      return fail('invalid_request', 'code_challenge_method must be S256.');
    }
    if (codeChallenge && !/^[A-Za-z0-9._~-]{43,128}$/.test(codeChallenge)) {
      return fail('invalid_request', 'Invalid code_challenge.');
    }
    return {
      ok: {
        app: application,
        redirectUri,
        scopes,
        state,
        codeChallenge,
        codeChallengeMethod: codeChallenge ? 'S256' : null,
      },
    };
  };

  app.get('/oauth/authorize', anyFlavour, async (request, reply) => {
    const params = parseQuery(request);
    const lang = pickLang(str(params.lang), request.headers['accept-language']);
    const checked = await validateAuthorize(params);
    if ('page' in checked) return html(reply, 400, errorPage(lang, checked.page));
    if ('redirect' in checked) return reply.redirect(checked.redirect, 302);

    const session = await sessionOf(request);
    if (!session) {
      return reply.redirect(
        `${options.loginPath}?redirect=${encodeURIComponent(request.url)}`,
        302,
      );
    }
    const [actor] = await ctx.db
      .select({ username: schema.actors.username })
      .from(schema.actors)
      .where(eq(schema.actors.id, session.actorId));
    const [user] = await ctx.db
      .select({ locale: schema.users.locale })
      .from(schema.users)
      .where(eq(schema.users.id, session.userId));
    const { ok } = checked;
    return html(
      reply,
      200,
      consentPage({
        lang: pickLang(str(params.lang), user?.locale, request.headers['accept-language']),
        appName: ok.app.name,
        appWebsite: ok.app.website,
        handle: actor?.username ?? '',
        scopes: ok.scopes,
        fields: {
          client_id: ok.app.clientId,
          redirect_uri: ok.redirectUri,
          scope: ok.scopes.join(' '),
          response_type: 'code',
          ...(ok.state !== undefined ? { state: ok.state } : {}),
          ...(ok.codeChallenge
            ? { code_challenge: ok.codeChallenge, code_challenge_method: 'S256' }
            : {}),
          csrf: csrfFor(session),
        },
      }),
    );
  });

  app.post('/oauth/authorize', anyFlavour, async (request, reply) => {
    const params = body(request);
    const lang = pickLang(request.headers['accept-language']);
    const session = await sessionOf(request);
    if (!session)
      return html(reply, 401, errorPage(lang, 'Your session has expired. Sign in again.'));
    const csrf = str(params.csrf) ?? '';
    if (!safeEqual(csrf, csrfFor(session))) {
      return html(reply, 403, errorPage(lang, 'The form has expired. Go back and try again.'));
    }
    const checked = await validateAuthorize(params);
    if ('page' in checked) return html(reply, 400, errorPage(lang, checked.page));
    if ('redirect' in checked) return reply.redirect(checked.redirect, 302);
    const { ok } = checked;

    if (str(params.decision) !== 'approve') {
      if (ok.redirectUri === OOB_REDIRECT) {
        return html(reply, 200, errorPage(lang, 'The authorization was denied.'));
      }
      return reply.redirect(
        withParams(ok.redirectUri, {
          error: 'access_denied',
          error_description: 'The resource owner or authorization server denied the request.',
          state: ok.state,
        }),
        302,
      );
    }

    const code = randomToken(32);
    await store.createGrant({
      applicationId: ok.app.id,
      userId: session.userId,
      codeHash: sha256(code),
      redirectUri: ok.redirectUri,
      scopes: ok.scopes,
      codeChallenge: ok.codeChallenge,
      codeChallengeMethod: ok.codeChallengeMethod,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
    if (ok.redirectUri === OOB_REDIRECT) return html(reply, 200, codePage(lang, code));
    return reply.redirect(withParams(ok.redirectUri, { code, state: ok.state }), 302);
  });

  // --- Token endpoint ---

  const clientCredentials = (request: FastifyRequest, params: FormObject) => {
    const basic = /^basic\s+(.+)$/i.exec(request.headers.authorization ?? '');
    if (basic?.[1]) {
      const decoded = Buffer.from(basic[1], 'base64').toString('utf8');
      const index = decoded.indexOf(':');
      if (index > 0) {
        return {
          clientId: decodeURIComponent(decoded.slice(0, index)),
          clientSecret: decodeURIComponent(decoded.slice(index + 1)),
        };
      }
    }
    return { clientId: str(params.client_id) ?? '', clientSecret: str(params.client_secret) };
  };

  const authenticateClient = async (
    request: FastifyRequest,
    params: FormObject,
    options: { allowPublic: boolean },
  ) => {
    const { clientId, clientSecret } = clientCredentials(request, params);
    const application = clientId ? await store.findApplicationByClientId(clientId) : null;
    if (!application) {
      throw new OAuthError('invalid_client', 'Client authentication failed.', 401);
    }
    if (clientSecret === undefined || clientSecret === '') {
      if (!options.allowPublic) {
        throw new OAuthError('invalid_client', 'Client authentication failed.', 401);
      }
      return { application, authenticated: false };
    }
    if (!safeEqual(sha256(clientSecret), application.clientSecretHash)) {
      throw new OAuthError('invalid_client', 'Client authentication failed.', 401);
    }
    return { application, authenticated: true };
  };

  const tokenResponse = (token: string, scopes: string[], createdAt: Date) => ({
    access_token: token,
    token_type: 'Bearer',
    scope: scopes.join(' '),
    created_at: Math.floor(createdAt.getTime() / 1000),
  });

  app.post(
    '/oauth/token',
    { config: { anyFlavour: true, rateLimit: { max: 60, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      reply.header('cache-control', 'no-store').header('pragma', 'no-cache');
      const params = body(request);
      try {
        const grantType = str(params.grant_type);
        if (grantType === 'authorization_code') {
          // Public clients may omit the secret when they use PKCE (checked below).
          const client = await authenticateClient(request, params, { allowPublic: true });
          const code = str(params.code) ?? '';
          const grant = code ? await store.consumeGrant(sha256(code)) : null;
          if (
            !grant ||
            grant.applicationId !== client.application.id ||
            grant.expiresAt.getTime() <= Date.now()
          ) {
            throw new OAuthError(
              'invalid_grant',
              'The provided authorization grant is invalid, expired, revoked, does not match the redirection URI used in the authorization request, or was issued to another client.',
            );
          }
          const redirectUri = str(params.redirect_uri) ?? grant.redirectUri;
          if (redirectUri !== grant.redirectUri) {
            throw new OAuthError('invalid_grant', 'The redirect URI does not match.');
          }
          if (grant.codeChallenge) {
            const verifier = str(params.code_verifier) ?? '';
            if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
              throw new OAuthError('invalid_grant', 'Missing or invalid code_verifier.');
            }
            if (!safeEqual(pkceS256(verifier), grant.codeChallenge)) {
              throw new OAuthError('invalid_grant', 'The code_verifier does not match.');
            }
          } else if (!client.authenticated) {
            throw new OAuthError('invalid_client', 'Client authentication failed.', 401);
          }
          const raw = randomToken(32);
          const token = await store.createToken({
            applicationId: client.application.id,
            userId: grant.userId,
            tokenHash: sha256(raw),
            scopes: grant.scopes,
          });
          return tokenResponse(raw, token.scopes, token.createdAt);
        }
        if (grantType === 'client_credentials') {
          const client = await authenticateClient(request, params, { allowPublic: false });
          const scopes = parseScopes(str(params.scope));
          if (!scopes.every(isKnownScope) || !scopesWithin(scopes, client.application.scopes)) {
            throw new OAuthError(
              'invalid_scope',
              'The requested scope is invalid, unknown, or malformed.',
            );
          }
          const raw = randomToken(32);
          const token = await store.createToken({
            applicationId: client.application.id,
            userId: null,
            tokenHash: sha256(raw),
            scopes,
          });
          return tokenResponse(raw, token.scopes, token.createdAt);
        }
        throw new OAuthError(
          'unsupported_grant_type',
          'The authorization grant type is not supported by the authorization server.',
        );
      } catch (error) {
        if (error instanceof OAuthError) {
          return reply
            .status(error.status)
            .send({ error: error.error, error_description: error.description });
        }
        throw error;
      }
    },
  );

  app.post('/oauth/revoke', anyFlavour, async (request, reply) => {
    const params = body(request);
    try {
      const client = await authenticateClient(request, params, { allowPublic: true });
      const raw = str(params.token) ?? '';
      const token = raw ? await store.findActiveToken(sha256(raw)) : null;
      if (token) {
        if (token.applicationId !== client.application.id) {
          throw new OAuthError(
            'unauthorized_client',
            'You are not authorized to revoke this token',
            403,
          );
        }
        await store.revokeToken(token.id);
      }
      return {};
    } catch (error) {
      if (error instanceof OAuthError) {
        return reply
          .status(error.status)
          .send({ error: error.error, error_description: error.description });
      }
      throw error;
    }
  });

  // RFC 8414 metadata (Mastodon 4.3+): lets clients discover PKCE support and endpoints.
  app.get('/.well-known/oauth-authorization-server', anyFlavour, async () => ({
    issuer: `${baseUrl}/`,
    service_documentation: 'https://docs.joinmastodon.org/',
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    revocation_endpoint: `${baseUrl}/oauth/revoke`,
    app_registration_endpoint: `${baseUrl}/api/v1/apps`,
    scopes_supported: supportedScopes(),
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'client_credentials'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
  }));
}
