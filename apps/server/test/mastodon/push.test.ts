import {
  type CoreContext,
  type DomainEvent,
  getStatus,
  like,
  MemoryEventBus,
  MemoryKeyValueStore,
  randomToken,
  registerUser,
  sha256,
} from '@disbigle/core';
import { createTestDatabase } from '@disbigle/db/testing';
import {
  MastodonPushPublisher,
  type MastodonPushStore,
  MemoryMastodonPushStore,
  MemoryOAuthStore,
  mastodonApi,
  type PushSender,
  unsealToken,
} from '@disbigle/mastodon-api';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newUser, testConfig } from '../helpers.ts';
import { form, MastodonClient } from './helpers.ts';

/**
 * The Mastodon plugin on its own, with options `buildApp` does not pass yet (push store) and a
 * stub resolver for remote posts.
 */
let app: FastifyInstance | undefined;
let ctx: CoreContext | undefined;
let drop: (() => Promise<void>) | undefined;
const oauth = new MemoryOAuthStore();
const pushStore: MastodonPushStore = new MemoryMastodonPushStore();
const events = new MemoryEventBus();
const resolved: string[] = [];
let remotePostId = '';

beforeAll(async () => {
  const testDb = await createTestDatabase();
  drop = testDb.drop;
  ctx = {
    db: testDb.db,
    config: testConfig,
    kv: new MemoryKeyValueStore(),
    rsaKeyBits: 1024,
    events,
  };
  const core = ctx;
  app = Fastify();
  await app.register(multipart);
  await app.register(mastodonApi, {
    ctx: core,
    store: oauth,
    pushStore,
    resolveStatus: async (url) => {
      resolved.push(url);
      // Stands in for a fetch over ActivityPub: "the remote post" is a post stored locally.
      return url === 'https://remote.example/notes/1' ? remotePostId : null;
    },
  });
});

afterAll(async () => {
  await app?.close();
  await drop?.();
});

const getApp = () => {
  if (!app) throw new Error('not ready');
  return app;
};

async function user(scopes = ['read', 'write', 'push']) {
  if (!ctx) throw new Error('not ready');
  const input = newUser();
  const registered = await registerUser(ctx, { ...input, agreement: true });
  const application = await oauth.createApplication({
    name: 'Pushy',
    website: null,
    redirectUris: ['pushy://cb'],
    scopes,
    clientId: randomToken(),
    clientSecretHash: sha256('x'),
  });
  const raw = randomToken();
  const token = await oauth.createToken({
    applicationId: application.id,
    userId: registered.userId,
    tokenHash: sha256(raw),
    scopes,
  });
  return {
    api: new MastodonClient(getApp, raw),
    raw,
    tokenId: token.id,
    userId: registered.userId,
    actorId: registered.actorId,
    username: input.username,
  };
}

const subscription = {
  endpoint: 'https://push.example.net/relay/abc',
  keys: {
    p256dh:
      'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  },
};

describe('Mastodon Web Push', () => {
  it('subscribes with the access token and sends Mastodon-format payloads', async () => {
    const alice = await user();
    const bob = await user();

    const created = await alice.api.post(
      '/api/v1/push/subscription',
      form({
        'subscription[endpoint]': subscription.endpoint,
        'subscription[keys][p256dh]': subscription.keys.p256dh,
        'subscription[keys][auth]': subscription.keys.auth,
        'data[alerts][favourite]': 'true',
        'data[alerts][mention]': 'true',
        'data[alerts][follow]': 'false',
        'data[policy]': 'all',
      }),
    );
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      endpoint: subscription.endpoint,
      standard: false,
      policy: 'all',
      alerts: { favourite: true, mention: true, follow: false, reblog: false },
    });
    expect(created.json().server_key.length).toBeGreaterThan(40);
    expect((await alice.api.get('/api/v1/push/subscription')).json().id).toBe(created.json().id);
    // The stored subscription carries the token only in sealed form.
    const stored = await pushStore.findByToken(alice.tokenId);
    expect(stored?.mastodon.sealedToken).not.toContain(alice.raw);
    expect(unsealToken(testConfig.SESSION_SECRET, stored?.mastodon.sealedToken ?? '')).toBe(
      alice.raw,
    );

    const sent: { payload: Record<string, unknown>; options: Parameters<PushSender>[2] }[] = [];
    const publisher = new MastodonPushPublisher(
      ctx as CoreContext,
      { push: pushStore, oauth },
      async (_subscription, payload, options) => {
        sent.push({ payload: JSON.parse(payload), options });
      },
    );
    const post = (await alice.api.post('/api/v1/statuses', { status: 'push me' })).json();
    events.events.length = 0;
    await like(ctx as CoreContext, bob.actorId, post.id);
    const notification = events.events.find(
      (e): e is Extract<DomainEvent, { type: 'notification.created' }> =>
        e.type === 'notification.created',
    );
    expect(notification).toBeDefined();
    expect(
      await publisher.deliver(
        notification?.notificationId ?? '',
        notification?.recipientActorId ?? '',
      ),
    ).toBe(1);
    expect(sent[0]?.payload).toEqual({
      access_token: alice.raw,
      preferred_locale: 'en',
      notification_id: notification?.notificationId,
      notification_type: 'favourite',
      icon: 'https://disbigle.test/assets/user/default.png',
      title: `${bob.username} favourited your post`,
      body: 'push me',
    });
    expect(sent[0]?.options).toMatchObject({ contentEncoding: 'aesgcm', TTL: 172800 });

    // Alerts and policy: no favourites any more, and only from accounts Alice follows.
    const updated = await alice.api.put('/api/v1/push/subscription', {
      data: { alerts: { mention: true }, policy: 'followed' },
    });
    expect(updated.json()).toMatchObject({ policy: 'followed', alerts: { favourite: false } });
    await bob.api.post('/api/v1/statuses', { status: `@${alice.username} hi` });
    const mention = events.events
      .filter(
        (e): e is Extract<DomainEvent, { type: 'notification.created' }> =>
          e.type === 'notification.created',
      )
      .at(-1);
    expect(
      await publisher.deliver(mention?.notificationId ?? '', mention?.recipientActorId ?? ''),
    ).toBe(0);

    // Signing the app out removes its subscription at the next delivery.
    const token = await oauth.findToken(alice.tokenId);
    if (token) await oauth.revokeToken(token.id);
    await alice.api.put('/api/v1/push/subscription', { data: { alerts: { mention: true } } });
    expect(
      await publisher.deliver(mention?.notificationId ?? '', mention?.recipientActorId ?? ''),
    ).toBe(0);
    expect(await pushStore.findByToken(alice.tokenId)).toBeNull();
  });

  it('validates subscriptions and needs the push scope', async () => {
    const noPush = await user(['read', 'write']);
    const refused = await noPush.api.post('/api/v1/push/subscription', { subscription });
    expect(refused.statusCode).toBe(403);
    const carol = await user();
    expect((await carol.api.get('/api/v1/push/subscription')).statusCode).toBe(404);
    const local = await carol.api.post('/api/v1/push/subscription', {
      subscription: { ...subscription, endpoint: 'http://127.0.0.1/push' },
    });
    expect(local.statusCode).toBe(422);
    const standard = await carol.api.post('/api/v1/push/subscription', {
      subscription: { ...subscription, endpoint: 'https://push.example.net/c', standard: true },
      data: { alerts: { follow: true } },
    });
    expect(standard.json()).toMatchObject({ standard: true, alerts: { follow: true } });
    expect((await carol.api.delete('/api/v1/push/subscription')).statusCode).toBe(200);
    expect((await carol.api.get('/api/v1/push/subscription')).statusCode).toBe(404);
  });
});

describe('Status search with remote resolution', () => {
  it('resolves unknown status URLs through the resolver when asked to', async () => {
    const dave = await user();
    remotePostId = (await dave.api.post('/api/v1/statuses', { status: 'from afar' })).json().id;
    const url = 'https://remote.example/notes/1';
    const withoutResolve = await dave.api.get(
      `/api/v2/search?type=statuses&q=${encodeURIComponent(url)}`,
    );
    expect(withoutResolve.json().statuses).toEqual([]);
    expect(resolved).toEqual([]);

    const found = await dave.api.get(
      `/api/v2/search?type=statuses&resolve=true&q=${encodeURIComponent(url)}`,
    );
    expect(found.json().statuses.map((s: { id: string }) => s.id)).toEqual([remotePostId]);
    expect(resolved).toEqual([url]);
    expect((await getStatus(ctx as CoreContext, null, remotePostId)).id).toBe(remotePostId);

    // Anonymous searches never fetch remote objects.
    const anonymous = await getApp().inject({
      method: 'GET',
      url: `/api/v2/search?type=statuses&resolve=true&q=${encodeURIComponent(url)}`,
    });
    expect(anonymous.json().statuses).toEqual([]);
    expect(resolved).toHaveLength(1);
  });
});
