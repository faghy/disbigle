import { describe, expect, it } from 'vitest';
import {
  authorize,
  form,
  MastodonClient,
  mastodonUser,
  openConsent,
  pkcePair,
  REDIRECT_URI,
  registerApp,
  signUp,
  useMastodonApp,
} from './helpers.ts';

const { app } = useMastodonApp();

describe('OAuth for Mastodon apps', () => {
  it('registers an app, authorizes with a session, exchanges the code with PKCE', async () => {
    const user = await signUp(app);
    const registered = await registerApp(app);
    expect(registered).toMatchObject({
      name: 'Test App',
      website: 'https://app.example',
      scopes: ['read', 'write', 'follow', 'push'],
      redirect_uri: REDIRECT_URI,
      redirect_uris: [REDIRECT_URI],
      client_secret_expires_at: 0,
    });
    const { verifier, challenge } = pkcePair();
    const query = {
      response_type: 'code',
      client_id: registered.client_id,
      redirect_uri: REDIRECT_URI,
      scope: 'read write',
      state: 'opaque-state',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    };

    // Without a session: off to the web sign-in page, which comes back here afterwards.
    const anonymous = await app().inject({
      method: 'GET',
      url: `/oauth/authorize?${new URLSearchParams(query)}`,
    });
    expect(anonymous.statusCode).toBe(302);
    const login = new URL(anonymous.headers.location as string, 'https://disbigle.test');
    expect(login.pathname).toBe('/login');
    expect(login.searchParams.get('redirect')).toMatch(/^\/oauth\/authorize\?/);

    // With a session: the consent page.
    const consent = await openConsent(app, user.client.cookieHeader ?? '', query);
    expect(consent.response.statusCode).toBe(200);
    expect(consent.response.headers['content-type']).toContain('text/html');
    expect(consent.response.body).toContain('Test App');
    expect(consent.response.body).toContain(`@${user.username}`);
    expect(consent.fields).toMatchObject({ client_id: registered.client_id, scope: 'read write' });

    // A forged form (no CSRF token) is refused.
    const forged = await app().inject({
      method: 'POST',
      url: '/oauth/authorize',
      headers: {
        cookie: user.client.cookieHeader ?? '',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: form({ ...consent.fields, csrf: 'nope', decision: 'approve' }),
    });
    expect(forged.statusCode).toBe(403);

    const approved = await app().inject({
      method: 'POST',
      url: '/oauth/authorize',
      headers: {
        cookie: user.client.cookieHeader ?? '',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: form({ ...consent.fields, decision: 'approve' }),
    });
    expect(approved.statusCode).toBe(302);
    const callback = new URL(approved.headers.location as string);
    expect(`${callback.protocol}//${callback.host}${callback.pathname}`).toBe(REDIRECT_URI);
    expect(callback.searchParams.get('state')).toBe('opaque-state');
    const code = callback.searchParams.get('code') ?? '';
    expect(code.length).toBeGreaterThan(30);

    // Form-encoded token request with a wrong verifier: rejected, and the code is spent.
    const wrong = await app().inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({
        grant_type: 'authorization_code',
        code,
        client_id: registered.client_id,
        redirect_uri: REDIRECT_URI,
        code_verifier: pkcePair().verifier,
      }),
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error).toBe('invalid_grant');

    // Second round: a public client (no secret) with the right verifier.
    const again = await openConsent(app, user.client.cookieHeader ?? '', query);
    const approvedAgain = await app().inject({
      method: 'POST',
      url: '/oauth/authorize',
      headers: {
        cookie: user.client.cookieHeader ?? '',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: form({ ...again.fields, decision: 'approve' }),
    });
    const code2 = new URL(approvedAgain.headers.location as string).searchParams.get('code') ?? '';
    const token = await app().inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: form({
        grant_type: 'authorization_code',
        code: code2,
        client_id: registered.client_id,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      }),
    });
    expect(token.statusCode).toBe(200);
    expect(token.headers['cache-control']).toBe('no-store');
    const body = token.json();
    expect(body).toMatchObject({ token_type: 'Bearer', scope: 'read write' });
    expect(typeof body.created_at).toBe('number');

    // The code works once only.
    const replay = await app().inject({
      method: 'POST',
      url: '/oauth/token',
      payload: {
        grant_type: 'authorization_code',
        code: code2,
        client_id: registered.client_id,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      },
    });
    expect(replay.json().error).toBe('invalid_grant');

    const api = new MastodonClient(app, body.access_token);
    const me = await api.get('/api/v1/accounts/verify_credentials');
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      id: user.account.id,
      username: user.username,
      acct: user.username,
      avatar: 'https://disbigle.test/assets/user/default.png',
      source: { privacy: 'public', note: '', follow_requests_count: 0 },
      emojis: [],
    });
    expect(me.headers['access-control-allow-origin']).toBe('*');

    // `write` covers `write:follows`, as in Mastodon.
    const other = await signUp(app);
    expect((await api.post(`/api/v1/accounts/${other.account.id}/follow`)).statusCode).toBe(200);

    // Revocation (client authenticated with HTTP Basic).
    const basic = Buffer.from(`${registered.client_id}:${registered.client_secret}`).toString(
      'base64',
    );
    const revoked = await app().inject({
      method: 'POST',
      url: '/oauth/revoke',
      headers: { authorization: `Basic ${basic}` },
      payload: { token: body.access_token },
    });
    expect(revoked.statusCode).toBe(200);
    const after = await api.get('/api/v1/accounts/verify_credentials');
    expect(after.statusCode).toBe(401);
    expect(after.json()).toEqual({ error: 'The access token is invalid' });
  });

  it('redirects a denial back to the app and shows out-of-band codes on a page', async () => {
    const user = await signUp(app);
    const registered = await app().inject({
      method: 'POST',
      url: '/api/v1/apps',
      payload: {
        client_name: 'Desk',
        redirect_uris: [REDIRECT_URI, 'urn:ietf:wg:oauth:2.0:oob'],
        scopes: 'read',
      },
    });
    const { client_id } = registered.json();
    const denyForm = await openConsent(app, user.client.cookieHeader ?? '', {
      client_id,
      redirect_uri: REDIRECT_URI,
      state: 's1',
    });
    const denied = await app().inject({
      method: 'POST',
      url: '/oauth/authorize',
      headers: {
        cookie: user.client.cookieHeader ?? '',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: form({ ...denyForm.fields, decision: 'deny' }),
    });
    const location = new URL(denied.headers.location as string);
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('state')).toBe('s1');

    const oob = await openConsent(app, user.client.cookieHeader ?? '', {
      client_id,
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
    });
    const shown = await app().inject({
      method: 'POST',
      url: '/oauth/authorize',
      headers: {
        cookie: user.client.cookieHeader ?? '',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: form({ ...oob.fields, decision: 'approve' }),
    });
    expect(shown.statusCode).toBe(200);
    expect(shown.body).toMatch(/<code>[A-Za-z0-9_-]{40,}<\/code>/);

    // Scopes beyond the registration are refused back to the app.
    const tooMuch = await app().inject({
      method: 'GET',
      url: `/oauth/authorize?${new URLSearchParams({ client_id, redirect_uri: REDIRECT_URI, scope: 'write' })}`,
      headers: { cookie: user.client.cookieHeader ?? '' },
    });
    expect(new URL(tooMuch.headers.location as string).searchParams.get('error')).toBe(
      'invalid_scope',
    );
    // An unregistered redirect URI is never redirected to.
    const evil = await app().inject({
      method: 'GET',
      url: `/oauth/authorize?${new URLSearchParams({ client_id, redirect_uri: 'https://evil.example/cb' })}`,
      headers: { cookie: user.client.cookieHeader ?? '' },
    });
    expect(evil.statusCode).toBe(400);
  });

  it('issues application tokens with client_credentials', async () => {
    const registered = await registerApp(app, 'read write');
    const token = await app().inject({
      method: 'POST',
      url: '/oauth/token',
      payload: {
        grant_type: 'client_credentials',
        client_id: registered.client_id,
        client_secret: registered.client_secret,
        scope: 'read',
      },
    });
    expect(token.statusCode).toBe(200);
    const api = new MastodonClient(app, token.json().access_token);
    expect((await api.get('/api/v1/apps/verify_credentials')).json()).toMatchObject({
      name: 'Test App',
      scopes: ['read', 'write'],
    });
    const me = await api.get('/api/v1/accounts/verify_credentials');
    expect(me.statusCode).toBe(422);
    expect((await api.get('/api/v1/timelines/public')).statusCode).toBe(200);

    const badSecret = await app().inject({
      method: 'POST',
      url: '/oauth/token',
      payload: {
        grant_type: 'client_credentials',
        client_id: registered.client_id,
        client_secret: 'wrong',
      },
    });
    expect(badSecret.statusCode).toBe(401);
    expect(badSecret.json().error).toBe('invalid_client');
    const password = await app().inject({
      method: 'POST',
      url: '/oauth/token',
      payload: { grant_type: 'password', client_id: registered.client_id },
    });
    expect(password.json().error).toBe('unsupported_grant_type');
  });

  it('rejects invalid registrations', async () => {
    const noUris = await app().inject({
      method: 'POST',
      url: '/api/v1/apps',
      payload: { client_name: 'x' },
    });
    expect(noUris.statusCode).toBe(422);
    const badScope = await app().inject({
      method: 'POST',
      url: '/api/v1/apps',
      payload: { client_name: 'x', redirect_uris: REDIRECT_URI, scopes: 'read sudo' },
    });
    expect(badScope.statusCode).toBe(422);
    expect(badScope.json().error).toContain('sudo');
  });

  it('serves both API flavours on the same paths', async () => {
    const user = await mastodonUser(app);
    const cookie = user.client.cookieHeader ?? '';

    const mastodon = await user.api.get('/api/v1/instance');
    expect(mastodon.json()).toMatchObject({
      uri: 'disbigle.test',
      version: expect.stringMatching(/^4\.2\.0 \(compatible; Disbigle /),
      urls: { streaming_api: 'wss://disbigle.test' },
    });
    const native = await app().inject({
      method: 'GET',
      url: '/api/v1/instance',
      headers: { cookie },
    });
    expect(native.json()).toHaveProperty('limits.maxPostLength');
    const ourWebClient = await app().inject({
      method: 'GET',
      url: '/api/v1/instance',
      headers: { 'sec-fetch-site': 'same-origin' },
    });
    expect(ourWebClient.json()).toHaveProperty('registrationMode');
    // An app asking anonymously (before signing in) gets the Mastodon shape.
    const anonymousApp = await app().inject({ method: 'GET', url: '/api/v1/instance' });
    expect(anonymousApp.json()).toHaveProperty('uri');

    const posted = await user.api.post('/api/v1/statuses', { status: 'same path, two shapes' });
    expect(posted.statusCode).toBe(200);
    const id = posted.json().id;
    const viaCookie = await user.client.get(`/api/v1/statuses/${id}`);
    expect(viaCookie.json()).toHaveProperty('likesCount', 0);
    const viaToken = await user.api.get(`/api/v1/statuses/${id}`);
    expect(viaToken.json()).toHaveProperty('favourites_count', 0);

    // Native-only routes keep working for the web client.
    expect((await user.client.get('/api/v1/aspects')).statusCode).toBe(200);
    // CORS preflight for browser-based apps.
    const preflight = await app().inject({
      method: 'OPTIONS',
      url: '/api/v1/timelines/home',
      headers: { origin: 'https://elk.zone', 'access-control-request-method': 'GET' },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-headers']).toContain('Authorization');
    const metadata = await app().inject({
      method: 'GET',
      url: '/.well-known/oauth-authorization-server',
    });
    expect(metadata.json()).toMatchObject({ code_challenge_methods_supported: ['S256'] });
  });

  it('accepts the token as a query parameter and rejects disabled tokens', async () => {
    const user = await signUp(app);
    const token = await authorize(app, user.client, 'read');
    const viaQuery = await app().inject({
      method: 'GET',
      url: `/api/v1/accounts/verify_credentials?access_token=${token}`,
    });
    expect(viaQuery.json().id).toBe(user.account.id);
    // A read-only token cannot post.
    const readOnly = await new MastodonClient(app, token).post('/api/v1/statuses', { status: 'x' });
    expect(readOnly.statusCode).toBe(403);
    expect(readOnly.json().error).toBe('This action is outside the authorized scopes');
    const invalid = await new MastodonClient(app, 'not-a-token').get('/api/v1/timelines/home');
    expect(invalid.statusCode).toBe(401);
  });
});
