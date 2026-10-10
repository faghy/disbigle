import { createServer } from 'node:net';
import { createDisbigleFederation } from '@disbigle/activitypub';
import type { Config } from '@disbigle/config';
import { type CoreContext, MemoryKeyValueStore } from '@disbigle/core';
import { createTestDatabase } from '@disbigle/db/testing';
import {
  type DeliverFn,
  DiasporaBridge,
  DiasporaPublisher,
  diasporaRoutes,
} from '@disbigle/diaspora-bridge';
import { MemoryKvStore } from '@fedify/fedify';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../../src/app.ts';

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

export async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

export interface Instance {
  app: FastifyInstance;
  ctx: CoreContext;
  bridge: DiasporaBridge;
  domain: string;
  url: string;
  close: () => Promise<void>;
}

/**
 * A Disbigle instance that federates over diaspora* only: Fedify is mounted (it serves
 * WebFinger, as in production) but the ActivityPub publisher is not.
 */
export async function startInstance(options: { deliver?: DeliverFn } = {}): Promise<Instance> {
  const port = await freePort();
  const domain = `127.0.0.1:${port}`;
  const url = `http://${domain}`;
  const testDb = await createTestDatabase();
  const ctx: CoreContext = {
    db: testDb.db,
    config: { ...testConfig, PUBLIC_URL: url, LOCAL_DOMAIN: domain },
    kv: new MemoryKeyValueStore(),
    rsaKeyBits: 1024,
  };
  const bridge = new DiasporaBridge({
    ctx,
    allowHttp: true,
    ...(options.deliver ? { deliver: options.deliver } : {}),
    onError: (error) => console.error(`[${domain}]`, error),
  });
  ctx.events = new DiasporaPublisher(bridge);
  ctx.resolveAccount = bridge.resolveAccount;
  const federation = createDisbigleFederation({
    kv: new MemoryKvStore(),
    allowPrivateAddress: true,
  });
  const app = await buildApp({ ctx, federation, disableRateLimit: true });
  await app.register(diasporaRoutes, { ctx, bridge });
  await app.listen({ host: '127.0.0.1', port });
  return {
    app,
    ctx,
    bridge,
    domain,
    url,
    close: async () => {
      await app.close();
      await bridge.idle();
      await testDb.drop();
    },
  };
}

/** A tiny cookie-jar client around fastify.inject. */
export class Client {
  private cookie: string | undefined;
  constructor(private readonly app: FastifyInstance) {}

  async request(
    method: InjectOptions['method'],
    url: string,
    payload?: unknown,
  ): Promise<LightMyRequestResponse> {
    const response = await this.app.inject({
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

  get = (url: string) => this.request('GET', url);
  put = (url: string, body: unknown = {}) => this.request('PUT', url, body);
  post = (url: string, body: unknown = {}) => this.request('POST', url, body);
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
    agreement: true as const,
  };
}

export async function signUp(instance: Instance) {
  const client = new Client(instance.app);
  const response = await client.post('/api/v1/auth/register', newUser());
  if (response.statusCode !== 201) throw new Error(`register failed: ${response.body}`);
  const account = response.json().user.account as { id: string; username: string };
  return { client, account, diasporaId: `${account.username}@${instance.domain}` };
}

export async function eventually<T>(
  check: () => Promise<T | null | undefined | false>,
  timeoutMs = 15_000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('Condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
