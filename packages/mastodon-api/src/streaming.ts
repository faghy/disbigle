import type { StreamEvent } from '@disbigle/shared';
import { type MapContext, mapNotification, mapStatus } from './entities/mappers.ts';

/**
 * A Mastodon streaming subscription and the native hub stream that feeds it.
 * Mastodon names: user, user:notification, public[:local|:remote][:media], hashtag[:local], list.
 */
export interface Subscription {
  /** Mastodon stream name, e.g. `hashtag:local`. */
  name: string;
  /** Tag name or list id, for `hashtag*` and `list`. */
  param?: string;
  /** Native hub stream (`user`, `public`, `public:local`, `hashtag:<tag>`). */
  native: string;
  /** Only notifications (user:notification), or no notifications (timelines). */
  notifications: 'only' | 'also' | 'never';
  /** Extra filter on statuses (media only, local only, list members). */
  accepts?: (status: Extract<StreamEvent, { event: 'update' }>['payload']) => boolean;
}

export type SubscriptionRequest = { stream: string; tag?: string; list?: string };

const TAG_RE = /^[\p{L}\p{N}_]{1,100}$/u;

/**
 * Turns a Mastodon subscription request into a subscription, or an error message. `listMembers`
 * resolves the members of one of the user's lists (aspects); null when it is not theirs.
 */
export async function toSubscription(
  input: SubscriptionRequest,
  signedIn: boolean,
  listMembers: (listId: string) => Promise<Set<string> | null>,
): Promise<Subscription | { error: string; status: number }> {
  const stream = input.stream;
  const hasMedia = (s: { media: unknown[] }) => s.media.length > 0;
  const isLocal = (s: { account: { local: boolean } }) => s.account.local;
  switch (stream) {
    case 'user':
    case 'user:notification':
      if (!signedIn) return { error: 'Missing access token', status: 401 };
      return {
        name: stream,
        native: 'user',
        notifications: stream === 'user' ? 'also' : 'only',
      };
    case 'public':
    case 'public:media':
      return {
        name: stream,
        native: 'public',
        notifications: 'never',
        ...(stream === 'public:media' ? { accepts: hasMedia } : {}),
      };
    case 'public:local':
    case 'public:local:media':
      return {
        name: stream,
        native: 'public:local',
        notifications: 'never',
        ...(stream === 'public:local:media' ? { accepts: hasMedia } : {}),
      };
    case 'public:remote':
    case 'public:remote:media':
      return {
        name: stream,
        native: 'public',
        notifications: 'never',
        accepts: (s) => !isLocal(s) && (stream === 'public:remote' || hasMedia(s)),
      };
    case 'hashtag':
    case 'hashtag:local': {
      const tag = (input.tag ?? '').replace(/^#/, '').toLowerCase();
      if (!TAG_RE.test(tag)) return { error: 'No such hashtag', status: 400 };
      return {
        name: stream,
        param: tag,
        native: `hashtag:${tag}`,
        notifications: 'never',
        ...(stream === 'hashtag:local' ? { accepts: isLocal } : {}),
      };
    }
    case 'list': {
      if (!signedIn) return { error: 'Missing access token', status: 401 };
      const members = input.list ? await listMembers(input.list) : null;
      if (!members || !input.list) return { error: 'No such list', status: 400 };
      // A list (aspect) timeline: home posts written by its members.
      return {
        name: 'list',
        param: input.list,
        native: 'user',
        notifications: 'never',
        accepts: (s) => members.has(s.account.id),
      };
    }
    default:
      return { error: 'Unknown stream type', status: 400 };
  }
}

const sameSubscription = (a: Subscription, b: Subscription) =>
  a.name === b.name && a.param === b.param;

/**
 * Per-connection state: the Mastodon subscriptions, and the native streams they need from the hub.
 * `encode` turns one native hub message into the Mastodon messages for this connection.
 */
export class MastodonStreamEncoder {
  readonly subscriptions: Subscription[] = [];

  constructor(
    private readonly map: MapContext,
    private readonly signedIn: boolean,
  ) {}

  add(subscription: Subscription): void {
    if (!this.subscriptions.some((s) => sameSubscription(s, subscription))) {
      this.subscriptions.push(subscription);
    }
  }

  remove(name: string, param?: string): void {
    const index = this.subscriptions.findIndex((s) => s.name === name && s.param === param);
    if (index >= 0) this.subscriptions.splice(index, 1);
  }

  /** Native hub streams to subscribe to. */
  nativeStreams(): Set<string> {
    return new Set(this.subscriptions.map((s) => s.native));
  }

  encode(message: StreamEvent): string[] {
    const out: string[] = [];
    const targets = this.subscriptions.filter((s) => s.native === message.stream);
    let payload: string | undefined;
    const render = () => {
      if (payload !== undefined) return payload;
      if (message.event === 'delete') payload = message.payload;
      else if (message.event === 'notification') {
        payload = JSON.stringify(mapNotification(this.map, message.payload));
      } else
        payload = JSON.stringify(mapStatus(this.map, message.payload, { signedIn: this.signedIn }));
      return payload;
    };
    for (const target of targets) {
      if (message.event === 'notification') {
        if (target.notifications === 'never') continue;
      } else {
        if (target.notifications === 'only') continue;
        if (message.event !== 'delete' && target.accepts && !target.accepts(message.payload))
          continue;
      }
      out.push(
        JSON.stringify({
          stream: target.param !== undefined ? [target.name, target.param] : [target.name],
          event: message.event,
          payload: render(),
        }),
      );
      // A delete is only needed once per connection.
      if (message.event === 'delete') break;
    }
    return out;
  }
}
