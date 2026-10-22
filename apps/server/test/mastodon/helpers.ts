import { createHash, randomBytes } from 'node:crypto';
import { createDisbigleFederation } from '@disbigle/activitypub';
import type { Config } from '@disbigle/config';
import { type CoreContext, MemoryKeyValueStore } from '@disbigle/core';
import { createTestDatabase } from '@disbigle/db/testing';
// Until apps/server depends on @disbigle/mastodon-api, import the package sources directly.
import { MemoryOAuthStore } from '@disbigle/mastodon-api';
import { MemoryKvStore } from '@fedify/fedify';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, expect } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { LocalEventBus, StreamingHub } from '../../src/streaming.ts';
import { Client, newUser, testConfig, testMailer } from '../helpers.ts';

export interface MastodonTestApp {
  app: () => FastifyInstance;
  ctx: () => CoreContext;
  store: () => MemoryOAuthStore;
}

/** The server app (native API, federation, streaming hub, Mastodon API) with an in-memory OAuth store. */
export function useMastodonApp(overrides: Partial<Config> = {}): MastodonTestApp {
  let app: FastifyInstance | undefined;
  let ctx: CoreContext | undefined;
  let store: MemoryOAuthStore | undefined;
  let drop: (() => Promise<void>) | undefined;
  beforeAll(async () => {
    const testDb = await createTestDatabase();
    drop = testDb.drop;
    ctx = {
      db: testDb.db,
      config: { ...testConfig, ...overrides },
      kv: new MemoryKeyValueStore(),
      rsaKeyBits: 1024,
    };
    const hub = new StreamingHub(ctx);
    ctx.events = new LocalEventBus(hub);
    const federation = createDisbigleFederation({
      kv: new MemoryKvStore(),
      allowPrivateAddress: true,
    });
    store = new MemoryOAuthStore();
    // buildApp registers the Mastodon plugin itself; tests use an in-memory OAuth store.
    app = await buildApp({
      ctx,
      hub,
      federation,
      mailer: testMailer,
      disableRateLimit: true,
      disableRegistrationGuard: true,
      oauthStore: store,
    });
  });
  afterAll(async () => {
    await app?.close();
    await drop?.();
  });
  const get = <T>(value: T | undefined): T => {
    if (value === undefined) throw new Error('App not initialised');
    return value;
  };
  return { app: () => get(app), ctx: () => get(ctx), store: () => get(store) };
}

/** A web user (cookie session) created through the native API. */
export async function signUp(app: () => FastifyInstance) {
  const client = new Client(app);
  const user = newUser();
  const response = await client.post('/api/v1/auth/register', user);
  if (response.statusCode !== 201) throw new Error(`register failed: ${response.body}`);
  return {
    client,
    username: user.username,
    account: response.json().user.account as { id: string; username: string },
  };
}

export const REDIRECT_URI = 'disbigletest://oauth-callback';

export function form(fields: Record<string, string | string[]>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
  }
  return params.toString();
}

export function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** Registers an app like a client does (form-encoded, as Tusky). */
export async function registerApp(app: () => FastifyInstance, scopes = 'read write follow push') {
  const response = await app().inject({
    method: 'POST',
    url: '/api/v1/apps',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: form({
      client_name: 'Test App',
      redirect_uris: REDIRECT_URI,
      scopes,
      website: 'https://app.example',
    }),
  });
  expect(response.statusCode).toBe(200);
  return response.json() as { client_id: string; client_secret: string; id: string };
}

/** Opens the consent page with the user's session and returns the hidden form fields. */
export async function openConsent(
  app: () => FastifyInstance,
  cookie: string,
  query: Record<string, string>,
) {
  const response = await app().inject({
    method: 'GET',
    url: `/oauth/authorize?${new URLSearchParams(query).toString()}`,
    headers: { cookie },
  });
  // With no-referrer, browsers send `Origin: null` with the form and the approval is refused.
  if (response.statusCode === 200) expect(response.headers['referrer-policy']).toBe('same-origin');
  const fields: Record<string, string> = {};
  for (const match of response.body.matchAll(
    /<input type="hidden" name="([^"]+)" value="([^"]*)">/g,
  )) {
    fields[match[1] ?? ''] = (match[2] ?? '').replace(/&amp;/g, '&');
  }
  return { response, fields };
}

/** Full authorization-code flow with PKCE; returns a user access token. */
export async function authorize(
  app: () => FastifyInstance,
  client: Client,
  scopes = 'read write follow push',
): Promise<string> {
  const registered = await registerApp(app, scopes);
  const { verifier, challenge } = pkcePair();
  const { fields } = await openConsent(app, client.cookieHeader ?? '', {
    response_type: 'code',
    client_id: registered.client_id,
    redirect_uri: REDIRECT_URI,
    scope: scopes,
    state: 'xyz',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  const approved = await app().inject({
    method: 'POST',
    url: '/oauth/authorize',
    headers: {
      cookie: client.cookieHeader ?? '',
      'content-type': 'application/x-www-form-urlencoded',
      // What a browser sends with the consent form under the page's same-origin policy.
      origin: 'https://disbigle.test',
    },
    payload: form({ ...fields, decision: 'approve' }),
  });
  expect(approved.statusCode).toBe(302);
  const location = new URL(approved.headers.location as string);
  const code = location.searchParams.get('code') ?? '';
  const token = await app().inject({
    method: 'POST',
    url: '/oauth/token',
    payload: {
      grant_type: 'authorization_code',
      code,
      client_id: registered.client_id,
      client_secret: registered.client_secret,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    },
  });
  expect(token.statusCode).toBe(200);
  return token.json().access_token as string;
}

/** A Mastodon app: requests carry the bearer token, bodies are JSON unless given as a string. */
export class MastodonClient {
  constructor(
    private readonly app: () => FastifyInstance,
    readonly token: string,
  ) {}

  request(
    method: InjectOptions['method'],
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> {
    const isForm = typeof body === 'string';
    return this.app().inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(isForm ? { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { payload: body as string } : {}),
    });
  }

  get = (url: string) => this.request('GET', url);
  post = (url: string, body: unknown = {}, headers: Record<string, string> = {}) =>
    this.request('POST', url, body, headers);
  put = (url: string, body: unknown = {}) => this.request('PUT', url, body);
  patch = (url: string, body: unknown = {}) => this.request('PATCH', url, body);
  delete = (url: string, body?: unknown) => this.request('DELETE', url, body);
}

/** Signs up a web user and authorizes an app for them. */
export async function mastodonUser(app: () => FastifyInstance, scopes?: string) {
  const user = await signUp(app);
  const token = await authorize(app, user.client, scopes);
  return { ...user, api: new MastodonClient(app, token) };
}

/** Parses a Link header into `{ next, prev }` URLs (path + query). */
export function links(response: LightMyRequestResponse): { next?: string; prev?: string } {
  const header = response.headers.link;
  const result: { next?: string; prev?: string } = {};
  for (const part of String(header ?? '').split(/,\s*/)) {
    const match = /<([^>]+)>;\s*rel="(next|prev)"/.exec(part);
    if (match?.[1] && match[2]) {
      const url = new URL(match[1]);
      result[match[2] as 'next' | 'prev'] = `${url.pathname}${url.search}`;
    }
  }
  return result;
}
