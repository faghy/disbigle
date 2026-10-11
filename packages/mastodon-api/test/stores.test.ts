import { schema, uuidv7 } from '@disbigle/db';
import { createTestDatabase } from '@disbigle/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleOAuthStore } from '../src/oauth/drizzle-store.ts';
import { MemoryOAuthStore, type OAuthStore } from '../src/oauth/store.ts';

let drop: (() => Promise<void>) | undefined;
let drizzleStore: DrizzleOAuthStore | undefined;
let userId = '';

beforeAll(async () => {
  const testDb = await createTestDatabase();
  drop = testDb.drop;
  const actorId = uuidv7();
  userId = uuidv7();
  await testDb.db
    .insert(schema.actors)
    .values({ id: actorId, username: 'owner', publicKeyPem: 'x' });
  await testDb.db.insert(schema.users).values({
    id: userId,
    actorId,
    email: 'owner@example.com',
    passwordHash: 'x',
    privateKeyPem: 'x',
  });
  drizzleStore = new DrizzleOAuthStore(testDb.db);
});

afterAll(async () => {
  await drop?.();
});

const stores: [string, () => OAuthStore][] = [
  ['memory', () => new MemoryOAuthStore()],
  [
    'drizzle',
    () => {
      if (!drizzleStore) throw new Error('not ready');
      return drizzleStore;
    },
  ],
];

describe.each(stores)('%s OAuth store', (_name, getStore) => {
  it('stores applications, single-use grants and revocable tokens', async () => {
    const store = getStore();
    const app = await store.createApplication({
      name: 'Tusky',
      website: null,
      redirectUris: ['tusky://oauth'],
      scopes: ['read', 'write'],
      clientId: `client-${uuidv7()}`,
      clientSecretHash: 'hash',
    });
    expect(await store.findApplicationByClientId(app.clientId)).toMatchObject({
      id: app.id,
      redirectUris: ['tusky://oauth'],
    });

    const codeHash = `code-${uuidv7()}`;
    await store.createGrant({
      applicationId: app.id,
      userId,
      codeHash,
      redirectUri: 'tusky://oauth',
      scopes: ['read'],
      codeChallenge: 'c'.repeat(43),
      codeChallengeMethod: 'S256',
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await store.consumeGrant(codeHash)).toMatchObject({
      userId,
      codeChallengeMethod: 'S256',
    });
    expect(await store.consumeGrant(codeHash)).toBeNull();

    const tokenHash = `token-${uuidv7()}`;
    const token = await store.createToken({
      applicationId: app.id,
      userId,
      tokenHash,
      scopes: ['read'],
    });
    expect((await store.findActiveToken(tokenHash))?.id).toBe(token.id);
    await store.touchToken(token.id, new Date());
    expect((await store.listUserTokens(userId)).map((t) => t.id)).toContain(token.id);
    await store.revokeToken(token.id);
    expect(await store.findActiveToken(tokenHash)).toBeNull();

    const appToken = await store.createToken({
      applicationId: app.id,
      userId: null,
      tokenHash: `app-${uuidv7()}`,
      scopes: ['read'],
    });
    expect(appToken.userId).toBeNull();
    await store.createToken({
      applicationId: app.id,
      userId,
      tokenHash: `t2-${uuidv7()}`,
      scopes: [],
    });
    expect(await store.revokeUserTokens(userId)).toBeGreaterThanOrEqual(1);
    expect(await store.listUserTokens(userId)).toEqual([]);
  });
});
