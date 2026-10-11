import { describe, expect, it } from 'vitest';
import {
  createPost,
  follow,
  getVapidKeys,
  listNotificationRows,
  PushPublisher,
  registerUser,
  subscribePush,
  unsubscribePush,
} from '../src/index.ts';
import { uniqueUser, useTestContext } from './helpers.ts';

const ctx = useTestContext();

const keys = {
  p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
  auth: 'tBHItJI5svbpez7KI4CCXg',
};

describe('web push', () => {
  it('creates VAPID keys once', async () => {
    const first = await getVapidKeys(ctx());
    expect(first.publicKey.length).toBeGreaterThan(60);
    expect(await getVapidKeys(ctx())).toEqual(first);
  });

  it('refuses non-https or private endpoints', async () => {
    const { userId } = await registerUser(ctx(), uniqueUser());
    for (const endpoint of ['http://push.example/x', 'https://127.0.0.1/x', 'not a url']) {
      await expect(subscribePush(ctx(), userId, { endpoint, keys })).rejects.toMatchObject({
        code: 'validation_failed',
      });
    }
  });

  it('keeps saved alerts when a subscription is registered again', async () => {
    const { getPushSubscription } = await import('../src/index.ts');
    const { userId } = await registerUser(ctx(), uniqueUser());
    await subscribePush(ctx(), userId, {
      endpoint: 'https://push.example/keep',
      keys,
      alerts: { like: false },
    });
    await subscribePush(ctx(), userId, { endpoint: 'https://push.example/keep', keys });
    expect(
      (await getPushSubscription(ctx(), userId, 'https://push.example/keep'))?.alerts.like,
    ).toBe(false);
    expect(await getPushSubscription(ctx(), userId, 'https://push.example/other')).toBeNull();
  });

  it('sends a localized message for new notifications, honours alerts and drops dead subscriptions', async () => {
    const author = await registerUser(ctx(), { ...uniqueUser(), locale: 'it' });
    const fan = await registerUser(ctx(), uniqueUser());
    await subscribePush(ctx(), author.userId, { endpoint: 'https://push.example/a', keys });
    await subscribePush(ctx(), author.userId, {
      endpoint: 'https://push.example/b',
      keys,
      alerts: { follow: false },
    });

    const sent: { endpoint: string; payload: Record<string, string> }[] = [];
    let failWith: number | null = null;
    const publisher = new PushPublisher(ctx(), async (subscription, payload) => {
      if (failWith) throw Object.assign(new Error('gone'), { statusCode: failWith });
      sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
    });

    await follow(ctx(), fan.actorId, author.actorId);
    const [notification] = await listNotificationRows(ctx(), author.actorId, { limit: 1 });
    expect(await publisher.deliver(notification?.id ?? '', author.actorId)).toBe(1);
    expect(sent[0]?.endpoint).toBe('https://push.example/a');
    expect(sent[0]?.payload.title).toMatch(/ha iniziato a seguirti$/);

    // A mention goes to both subscriptions, with the post text and a link to it.
    const { getCurrentUser } = await import('../src/index.ts');
    const authorName = (await getCurrentUser(ctx(), author.userId)).account.username;
    const post = await createPost(ctx(), fan.actorId, {
      content: `ciao @${authorName}, guarda qui`,
    });
    const [mention] = await listNotificationRows(ctx(), author.actorId, { limit: 1 });
    sent.length = 0;
    expect(await publisher.deliver(mention?.id ?? '', author.actorId)).toBe(2);
    expect(sent[0]?.payload).toMatchObject({
      type: 'mention',
      body: expect.stringContaining('guarda qui'),
    });
    expect(sent[0]?.payload.url).toMatch(new RegExp(`/${post.id}$`));

    // A 410 from the push service removes the subscription; an explicit unsubscribe too.
    failWith = 410;
    await publisher.deliver(mention?.id ?? '', author.actorId);
    failWith = null;
    expect(await publisher.deliver(mention?.id ?? '', author.actorId)).toBe(0);
    await subscribePush(ctx(), author.userId, { endpoint: 'https://push.example/c', keys });
    await unsubscribePush(ctx(), author.userId, 'https://push.example/c');
    expect(await publisher.deliver(mention?.id ?? '', author.actorId)).toBe(0);
  });
});
