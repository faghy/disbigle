import { createDisbigleFederation, federationOrigin } from '@disbigle/activitypub';
import type { Config } from '@disbigle/config';
import { type CoreContext, MemoryKeyValueStore, MemoryMailer } from '@disbigle/core';
import { createTestDatabase } from '@disbigle/db/testing';
import { MemoryKvStore } from '@fedify/fedify';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll } from 'vitest';
import { buildApp } from '../src/app.ts';
import { LocalEventBus, StreamingHub } from '../src/streaming.ts';

export const testConfig: Config = {
  NODE_ENV: 'test',
  PUBLIC_URL: 'https://disbigle.test',
  LOCAL_DOMAIN: 'disbigle.test',
  HOST: '127.0.0.1',
  PORT: 0,
  DATABASE_URL: '',
  REDIS_URL: '',
  SESSION_SECRET: 'test-secret-test-secret-test-secret-test',
  REGISTRATION_MODE: 'open',
  MEDIA_DIR: '/tmp/disbigle-test-media',
  INSTANCE_TITLE: 'Disbigle Test',
  INSTANCE_DESCRIPTION: '',
  MAIL_FROM: 'Disbigle Test <noreply@disbigle.test>',
};

/** Emails sent by test apps, newest last. */
export const testMailer = new MemoryMailer();

export function useTestApp(overrides: Partial<Config> = {}) {
  let app: FastifyInstance | undefined;
  let core: CoreContext | undefined;
  let drop: (() => Promise<void>) | undefined;
  beforeAll(async () => {
    const testDb = await createTestDatabase();
    drop = testDb.drop;
    const ctx: CoreContext = {
      db: testDb.db,
      config: { ...testConfig, ...overrides },
      kv: new MemoryKeyValueStore(),
      rsaKeyBits: 1024,
    };
    core = ctx;
    const hub = new StreamingHub(ctx);
    ctx.events = new LocalEventBus(hub);
    const federation = createDisbigleFederation({
      kv: new MemoryKvStore(),
      allowPrivateAddress: true,
      origin: federationOrigin(ctx.config),
    });
    app = await buildApp({ ctx, hub, federation, mailer: testMailer, disableRateLimit: true });
  });
  afterAll(async () => {
    await app?.close();
    await drop?.();
  });
  const get = () => {
    if (!app) throw new Error('App not initialised');
    return app;
  };
  /** The app's core context, to look at the database directly. */
  const ctx = () => {
    if (!core) throw new Error('App not initialised');
    return core;
  };
  return Object.assign(get, { ctx });
}

/** A tiny cookie-jar client around fastify.inject. */
export class Client {
  private cookie: string | undefined;
  constructor(private readonly app: () => FastifyInstance) {}

  async request(
    method: InjectOptions['method'],
    url: string,
    payload?: unknown,
  ): Promise<LightMyRequestResponse> {
    const response = await this.app().inject({
      method,
      url,
      ...(payload !== undefined ? { payload: payload as object } : {}),
      headers: { 'x-disbigle-api': 'native', ...(this.cookie ? { cookie: this.cookie } : {}) },
    });
    const setCookie = response.cookies.find((c) => c.name === 'disbigle_session');
    if (setCookie)
      this.cookie = setCookie.value ? `disbigle_session=${setCookie.value}` : undefined;
    return response;
  }

  get cookieHeader(): string | undefined {
    return this.cookie;
  }

  get = (url: string) => this.request('GET', url);
  put = (url: string, body: unknown = {}) => this.request('PUT', url, body);
  post = (url: string, body: unknown = {}) => this.request('POST', url, body);
  patch = (url: string, body: unknown = {}) => this.request('PATCH', url, body);
  delete = (url: string) => this.request('DELETE', url);
}

let counter = 0;
export function newUser() {
  counter += 1;
  const username = `u${counter}_${Math.random().toString(36).slice(2, 7)}`;
  return {
    username,
    email: `${username}@example.com`,
    password: 'correct horse battery staple',
    agreement: true,
  };
}
