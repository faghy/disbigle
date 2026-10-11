import { type Database, schema, uuidv7 } from '@disbigle/db';
import { createTestDatabase } from '@disbigle/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleMastodonPushStore } from '../src/push/drizzle-store.ts';
import { mastodonAlerts, nativeAlerts } from '../src/push/publisher.ts';
import {
  type MastodonPushStore,
  MemoryMastodonPushStore,
  sealToken,
  unsealToken,
} from '../src/push/store.ts';
import { mastodonContexts, nativeContexts } from '../src/routes/filters.ts';

let drop: (() => Promise<void>) | undefined;
let db: Database | undefined;
let userId = '';
const tokenIds: string[] = [];

beforeAll(async () => {
  const testDb = await createTestDatabase();
  drop = testDb.drop;
  db = testDb.db;
  const actorId = uuidv7();
  userId = uuidv7();
  await db.insert(schema.actors).values({ id: actorId, username: 'owner', publicKeyPem: 'x' });
  await db.insert(schema.users).values({
    id: userId,
    actorId,
    email: 'owner@example.com',
    passwordHash: 'x',
    privateKeyPem: 'x',
  });
  const appId = uuidv7();
  await db.insert(schema.oauthApplications).values({
    id: appId,
    name: 'App',
    clientId: 'c',
    clientSecretHash: 'h',
  });
  for (let i = 0; i < 4; i++) {
    const id = uuidv7();
    tokenIds.push(id);
    await db
      .insert(schema.oauthAccessTokens)
      .values({ id, applicationId: appId, userId, tokenHash: `t${i}`, scopes: ['push'] });
  }
});

afterAll(async () => {
  await drop?.();
});

const stores: [string, () => MastodonPushStore, number][] = [
  ['memory', () => new MemoryMastodonPushStore(), 0],
  [
    'drizzle',
    () => {
      if (!db) throw new Error('not ready');
      return new DrizzleMastodonPushStore(db);
    },
    2,
  ],
];

describe.each(stores)('%s Mastodon push store', (_name, getStore, offset) => {
  it('keeps one subscription per token and replaces it', async () => {
    const store = getStore();
    const [first, second] = [tokenIds[offset] ?? '', tokenIds[offset + 1] ?? ''];
    const base = {
      userId,
      p256dh: 'BPk'.repeat(10),
      auth: 'auth-secret',
      alerts: nativeAlerts({ mention: true, favourite: true }),
      mastodon: { policy: 'all' as const, standard: false, sealedToken: 'sealed' },
    };
    await store.replace({ ...base, tokenId: first, endpoint: `https://push.example/${first}` });
    const replaced = await store.replace({
      ...base,
      tokenId: first,
      endpoint: `https://push.example/${first}/new`,
    });
    await store.replace({ ...base, tokenId: second, endpoint: `https://push.example/${second}` });
    expect((await store.findByToken(first))?.endpoint).toBe(replaced.endpoint);
    expect(await store.listForUser(userId)).toHaveLength(2);

    const updated = await store.update(first, { policy: 'followed', alerts: nativeAlerts({}) });
    expect(updated?.mastodon).toMatchObject({ policy: 'followed', sealedToken: 'sealed' });
    expect(updated?.alerts.like).toBe(false);

    await store.deleteByToken(first);
    expect(await store.findByToken(first)).toBeNull();
    await store.deleteById(replaced.id);
    expect(await store.listForUser(userId)).toHaveLength(1);
    await store.deleteByToken(second);
  });
});

describe('push and filter helpers', () => {
  it('seals access tokens with the session secret', () => {
    const sealed = sealToken('secret', 'token-123');
    expect(sealed).not.toContain('token-123');
    expect(unsealToken('secret', sealed)).toBe('token-123');
    expect(unsealToken('other', sealed)).toBeNull();
  });

  it('maps alerts and filter contexts both ways', () => {
    const native = nativeAlerts({ mention: true, favourite: true, status: true });
    expect(native).toMatchObject({ mention: true, reply: true, like: true, reblog: false });
    expect(mastodonAlerts(native)).toMatchObject({ mention: true, favourite: true, status: false });
    expect(nativeContexts(['account', 'home', 'thread', 'bogus'])).toEqual(['home', 'thread']);
    expect(mastodonContexts(['home', 'public'])).toEqual(['home', 'account', 'public']);
  });
});
