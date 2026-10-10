import type { Config } from '@disbigle/config';
import { createTestDatabase } from '@disbigle/db/testing';
import { afterAll, beforeAll } from 'vitest';
import { type CoreContext, MemoryKeyValueStore } from '../src/index.ts';

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

/** Provides a fresh migrated database per test file. Call at the top level of a test file. */
export function useTestContext(overrides: Partial<Config> = {}): () => CoreContext {
  let ctx: CoreContext | undefined;
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
  });
  afterAll(async () => {
    await drop?.();
  });
  return () => {
    if (!ctx) throw new Error('Test context not initialised');
    return ctx;
  };
}

let counter = 0;
export function uniqueUser(prefix = 'user') {
  counter += 1;
  const username = `${prefix}${counter}_${Math.random().toString(36).slice(2, 7)}`;
  return {
    username,
    email: `${username}@example.com`,
    password: 'correct horse battery staple',
    agreement: true as const,
  };
}
