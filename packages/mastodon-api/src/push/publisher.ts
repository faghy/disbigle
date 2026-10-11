import {
  assertPublicUrl,
  type CoreContext,
  type DomainEvent,
  type EventBus,
  getVapidKeys,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import type { PushAlerts } from '@disbigle/db/schema';
import type { NotificationType } from '@disbigle/shared';
import { and, eq } from 'drizzle-orm';
import webpush from 'web-push';
import { mapNotificationType } from '../entities/mappers.ts';
import type { OAuthStore } from '../oauth/store.ts';
import { type MastodonPushStore, type MastodonPushSubscription, unsealToken } from './store.ts';

const { users, notifications, actors, posts, follows } = schema;

/** Mastodon alert names → our notification types. */
export function nativeAlerts(alerts: Record<string, boolean | undefined>): Required<PushAlerts> {
  const on = (key: string) => alerts[key] === true;
  return {
    mention: on('mention'),
    reply: on('mention'),
    reblog: on('reblog'),
    follow: on('follow'),
    follow_request: on('follow_request'),
    like: on('favourite'),
    poll: on('poll'),
  };
}

/** Our alerts as Mastodon reports them (types we never send are always false). */
export function mastodonAlerts(alerts: PushAlerts): Record<string, boolean> {
  return {
    mention: alerts.mention === true,
    status: false,
    reblog: alerts.reblog === true,
    follow: alerts.follow === true,
    follow_request: alerts.follow_request === true,
    favourite: alerts.like === true,
    poll: alerts.poll === true,
    update: false,
    'admin.sign_up': false,
    'admin.report': false,
  };
}

const titles: Record<string, Record<string, string>> = {
  en: {
    mention: 'You were mentioned by {name}',
    reply: 'You were mentioned by {name}',
    reblog: '{name} boosted your post',
    follow: '{name} is now following you',
    follow_request: 'Pending follower: {name}',
    like: '{name} favourited your post',
    poll: 'A poll by {name} has ended',
  },
  it: {
    mention: '{name} ti ha menzionato',
    reply: '{name} ti ha menzionato',
    reblog: '{name} ha condiviso il tuo post',
    follow: '{name} ha iniziato a seguirti',
    follow_request: '{name} vuole seguirti',
    like: '{name} ha apprezzato il tuo post',
    poll: 'Un sondaggio di {name} è terminato',
  },
};

export const plainText = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

const truncate = (text: string, length: number) =>
  text.length <= length ? text : `${text.slice(0, length - 1).trimEnd()}…`;

/** The payload Mastodon apps expect (https://docs.joinmastodon.org/methods/push/). */
export interface MastodonPushPayload {
  access_token: string;
  preferred_locale: string;
  notification_id: string;
  notification_type: string;
  icon: string;
  title: string;
  body: string;
}

export type PushSender = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: {
    vapidDetails: { subject: string; publicKey: string; privateKey: string };
    TTL: number;
    contentEncoding: 'aesgcm' | 'aes128gcm';
    urgency: 'normal';
  },
) => Promise<unknown>;

/**
 * Sends Web Push messages in Mastodon's format to subscriptions made by Mastodon apps.
 * Register it on the event bus next to core's PushPublisher (which serves web subscriptions).
 */
export class MastodonPushPublisher implements EventBus {
  constructor(
    private readonly ctx: CoreContext,
    private readonly stores: { push: MastodonPushStore; oauth: OAuthStore },
    private readonly send: PushSender = async (subscription, payload, options) => {
      await assertPublicUrl(subscription.endpoint);
      return webpush.sendNotification(subscription, payload, options);
    },
  ) {}

  async publish(event: DomainEvent): Promise<void> {
    if (event.type !== 'notification.created') return;
    void this.deliver(event.notificationId, event.recipientActorId).catch((error) =>
      console.error('mastodon push: delivery failed', error),
    );
  }

  private async policyAllows(
    subscription: MastodonPushSubscription,
    recipientActorId: string,
    fromActorId: string,
  ): Promise<boolean> {
    const policy = subscription.mastodon.policy;
    if (policy === 'none') return false;
    if (policy === 'all') return true;
    const [actorId, targetActorId] =
      policy === 'followed' ? [recipientActorId, fromActorId] : [fromActorId, recipientActorId];
    const [row] = await this.ctx.db
      .select({ id: follows.id })
      .from(follows)
      .where(and(eq(follows.actorId, actorId), eq(follows.targetActorId, targetActorId)));
    return Boolean(row);
  }

  /** Sends one notification to the recipient's app subscriptions; returns how many were sent. */
  async deliver(notificationId: string, recipientActorId: string): Promise<number> {
    const { db, config } = this.ctx;
    const [user] = await db.select().from(users).where(eq(users.actorId, recipientActorId));
    if (!user) return 0;
    const subscriptions = await this.stores.push.listForUser(user.id);
    if (subscriptions.length === 0) return 0;
    const [row] = await db
      .select({ notification: notifications, from: actors })
      .from(notifications)
      .innerJoin(actors, eq(actors.id, notifications.fromActorId))
      .where(eq(notifications.id, notificationId));
    if (!row) return 0;
    const { notification, from } = row;
    const type = notification.type as NotificationType;
    const [post] = notification.postId
      ? await db.select().from(posts).where(eq(posts.id, notification.postId))
      : [];
    const name = from.displayName || from.username;
    const locale = user.locale === 'it' ? 'it' : 'en';
    const title = (titles[locale]?.[type] ?? name).replace('{name}', name);
    const source = post ? post.summary || plainText(post.contentHtml) : plainText(from.summary);
    const icon = from.avatarUrl ?? `${config.PUBLIC_URL}/assets/user/default.png`;
    const vapid = await getVapidKeys(this.ctx);

    let sent = 0;
    for (const subscription of subscriptions) {
      if (subscription.alerts[type] !== true) continue;
      const token = await this.stores.oauth.findToken(subscription.tokenId);
      const accessToken = unsealToken(config.SESSION_SECRET, subscription.mastodon.sealedToken);
      if (!token || token.revokedAt || !accessToken) {
        // The app was signed out: its subscription is useless.
        await this.stores.push.deleteById(subscription.id);
        continue;
      }
      if (!(await this.policyAllows(subscription, recipientActorId, from.id))) continue;
      const payload: MastodonPushPayload = {
        access_token: accessToken,
        preferred_locale: user.locale,
        notification_id: notification.id,
        notification_type: mapNotificationType(type),
        icon,
        title,
        body: truncate(source, 140),
      };
      try {
        await this.send(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(payload),
          {
            vapidDetails: {
              subject: config.PUBLIC_URL,
              publicKey: vapid.publicKey,
              privateKey: vapid.privateKey,
            },
            TTL: 48 * 60 * 60,
            contentEncoding: subscription.mastodon.standard ? 'aes128gcm' : 'aesgcm',
            urgency: 'normal',
          },
        );
        sent += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await this.stores.push.deleteById(subscription.id);
      }
    }
    return sent;
  }
}
