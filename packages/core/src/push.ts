import { schema, uuidv7 } from '@disbigle/db';
import type { PushAlerts } from '@disbigle/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import webpush from 'web-push';
import type { CoreContext } from './context.ts';
import { generateActorKeyPair, generateEd25519KeyPair } from './crypto/keys.ts';
import { DomainError } from './errors.ts';
import type { DomainEvent, EventBus } from './events.ts';
import { assertPublicUrl } from './net.ts';

const { instanceKeys, webPushSubscriptions, notifications, actors, users } = schema;

export const defaultPushAlerts: Required<PushAlerts> = {
  follow: true,
  follow_request: true,
  mention: true,
  reply: true,
  reblog: true,
  like: true,
  poll: true,
};

/** The instance's VAPID key pair, created on first use (needs the instance_keys row). */
export async function getVapidKeys(
  ctx: CoreContext,
): Promise<{ publicKey: string; privateKey: string }> {
  const [row] = await ctx.db.select().from(instanceKeys).where(eq(instanceKeys.id, 'instance'));
  if (row?.vapidPublicKey && row.vapidPrivateKey) {
    return { publicKey: row.vapidPublicKey, privateKey: row.vapidPrivateKey };
  }
  if (!row) {
    const [rsa, ed] = await Promise.all([
      generateActorKeyPair(ctx.rsaKeyBits ?? 4096),
      generateEd25519KeyPair(),
    ]);
    await ctx.db
      .insert(instanceKeys)
      .values({
        id: 'instance',
        rsaPrivateKeyPem: rsa.privateKeyPem,
        rsaPublicKeyPem: rsa.publicKeyPem,
        ed25519PrivateKeyPem: ed.privateKeyPem,
        ed25519PublicKeyPem: ed.publicKeyPem,
      })
      .onConflictDoNothing();
    return getVapidKeys(ctx);
  }
  const keys = webpush.generateVAPIDKeys();
  await ctx.db
    .update(instanceKeys)
    .set({ vapidPublicKey: keys.publicKey, vapidPrivateKey: keys.privateKey })
    .where(eq(instanceKeys.id, 'instance'));
  return keys;
}

/** Known push services only: the endpoint is a URL chosen by the browser, so it must be https. */
function validateEndpoint(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new DomainError('validation_failed', 'Invalid endpoint', [
      { path: 'endpoint', message: 'Invalid URL' },
    ]);
  }
  const privateHost = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[?::1\]?|0\.)/i.test(
    url.hostname,
  );
  if (url.protocol !== 'https:' || privateHost) {
    throw new DomainError('validation_failed', 'Invalid endpoint', [
      { path: 'endpoint', message: 'Must be a public https URL' },
    ]);
  }
}

export async function subscribePush(
  ctx: CoreContext,
  userId: string,
  input: { endpoint: string; keys: { p256dh: string; auth: string }; alerts?: PushAlerts },
) {
  validateEndpoint(input.endpoint);
  const [existing] = await ctx.db
    .select({ alerts: webPushSubscriptions.alerts })
    .from(webPushSubscriptions)
    .where(eq(webPushSubscriptions.endpoint, input.endpoint));
  // Re-registering without alerts keeps the saved choices.
  const alerts = { ...defaultPushAlerts, ...existing?.alerts, ...input.alerts };
  await ctx.db
    .insert(webPushSubscriptions)
    .values({
      id: uuidv7(),
      userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      alerts,
    })
    .onConflictDoUpdate({
      target: webPushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        alerts,
        tokenId: null,
        mastodon: null,
      },
    });
  return { endpoint: input.endpoint, alerts };
}

export async function unsubscribePush(
  ctx: CoreContext,
  userId: string,
  endpoint: string,
): Promise<void> {
  await ctx.db
    .delete(webPushSubscriptions)
    .where(
      and(
        eq(webPushSubscriptions.userId, userId),
        eq(webPushSubscriptions.endpoint, endpoint),
        isNull(webPushSubscriptions.tokenId),
      ),
    );
}

const titles: Record<string, Record<string, string>> = {
  en: {
    follow: '{name} followed you',
    follow_request: '{name} wants to follow you',
    mention: '{name} mentioned you',
    reply: '{name} replied to you',
    reblog: '{name} reshared your post',
    like: '{name} liked your post',
    poll: 'A poll you took part in has ended',
  },
  it: {
    follow: '{name} ha iniziato a seguirti',
    follow_request: '{name} vuole seguirti',
    mention: '{name} ti ha menzionato',
    reply: '{name} ti ha risposto',
    reblog: '{name} ha condiviso il tuo post',
    like: '{name} ha apprezzato il tuo post',
    poll: 'Un sondaggio a cui hai partecipato è terminato',
  },
  es: {
    follow: '{name} ha empezado a seguirte',
    follow_request: '{name} quiere seguirte',
    mention: '{name} te ha mencionado',
    reply: '{name} te ha respondido',
    reblog: '{name} ha compartido tu publicación',
    like: '{name} le ha dado me gusta a tu publicación',
    poll: 'Ha terminado una encuesta en la que participaste',
  },
};

const plainText = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

type Sender = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: {
    vapidDetails: { subject: string; publicKey: string; privateKey: string };
    TTL: number;
  },
) => Promise<unknown>;

/** Sends Web Push messages for new notifications. Failures never affect the request that caused them. */
export class PushPublisher implements EventBus {
  constructor(
    private readonly ctx: CoreContext,
    private readonly send: Sender = async (subscription, payload, options) => {
      await assertPublicUrl(subscription.endpoint);
      return webpush.sendNotification(subscription, payload, options);
    },
  ) {}

  async publish(event: DomainEvent): Promise<void> {
    if (event.type !== 'notification.created') return;
    void this.deliver(event.notificationId, event.recipientActorId).catch((error) =>
      console.error('push: delivery failed', error),
    );
  }

  /** Exposed for tests. */
  async deliver(notificationId: string, recipientActorId: string): Promise<number> {
    const { db } = this.ctx;
    const [user] = await db.select().from(users).where(eq(users.actorId, recipientActorId));
    if (!user) return 0;
    const subscriptions = await db
      .select()
      .from(webPushSubscriptions)
      .where(and(eq(webPushSubscriptions.userId, user.id), isNull(webPushSubscriptions.tokenId)));
    if (subscriptions.length === 0) return 0;
    const [row] = await db
      .select({ notification: notifications, from: actors })
      .from(notifications)
      .innerJoin(actors, eq(actors.id, notifications.fromActorId))
      .where(eq(notifications.id, notificationId));
    if (!row) return 0;
    const { notification, from } = row;
    const [post] = notification.postId
      ? await db.select().from(schema.posts).where(eq(schema.posts.id, notification.postId))
      : [];
    const name = from.displayName || from.username;
    const title =
      (titles[user.locale] ?? titles.en)?.[notification.type]?.replace('{name}', name) ?? name;
    const acct = from.domain ? `${from.username}@${from.domain}` : from.username;
    const url = post
      ? `${this.ctx.config.PUBLIC_URL}/@${acct}/${post.id}`
      : `${this.ctx.config.PUBLIC_URL}/notifications`;
    const payload = JSON.stringify({
      notificationId: notification.id,
      type: notification.type,
      title,
      body: post ? plainText(post.contentHtml).slice(0, 200) : '',
      icon: from.avatarUrl,
      url,
    });
    const vapid = await getVapidKeys(this.ctx);
    let sent = 0;
    for (const subscription of subscriptions) {
      if (subscription.alerts[notification.type] === false) continue;
      try {
        await this.send(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          payload,
          {
            vapidDetails: {
              subject: this.ctx.config.PUBLIC_URL,
              publicKey: vapid.publicKey,
              privateKey: vapid.privateKey,
            },
            TTL: 24 * 60 * 60,
          },
        );
        sent += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        // The browser unsubscribed: forget the subscription.
        if (status === 404 || status === 410) {
          await db.delete(webPushSubscriptions).where(eq(webPushSubscriptions.id, subscription.id));
        }
      }
    }
    return sent;
  }
}

/** The alerts saved for one of the user's subscriptions, or null if it is not registered. */
export async function getPushSubscription(ctx: CoreContext, userId: string, endpoint: string) {
  const [row] = await ctx.db
    .select()
    .from(webPushSubscriptions)
    .where(
      and(
        eq(webPushSubscriptions.userId, userId),
        eq(webPushSubscriptions.endpoint, endpoint),
        isNull(webPushSubscriptions.tokenId),
      ),
    );
  return row ? { endpoint: row.endpoint, alerts: { ...defaultPushAlerts, ...row.alerts } } : null;
}
