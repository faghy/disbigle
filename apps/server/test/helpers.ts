import type { Config } from '@disbigle/config';
import { type CoreContext, MemoryKeyValueStore } from '@disbigle/core';
import { createTestDatabase } from '@disbigle/db/testing';
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
};

export function useTestApp(overrides: Partial<Config> = {}) {
  let app: FastifyInstance | undefined;
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
    const hub = new StreamingHub(ctx);
    ctx.events = new LocalEventBus(hub);
    app = await buildApp({ ctx, hub, disableRateLimit: true });
  });
  afterAll(async () => {
    await app?.close();
    await drop?.();
  });
  return () => {
    if (!app) throw new Error('App not initialised');
    return app;
  };
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
      headers: this.cookie ? { cookie: this.cookie } : {},
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
