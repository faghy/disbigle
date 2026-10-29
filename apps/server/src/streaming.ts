import {
  type CoreContext,
  type DomainEvent,
  type EventBus,
  getStatus,
  serializeNotifications,
  streamableTo,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import type { StreamEvent } from '@disbigle/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Redis } from 'ioredis';

/** Minimal view of a WebSocket, so the hub can be tested without a network. */
export interface StreamSocket {
  send(data: string): void;
  readonly readyState: number;
}

interface Connection {
  socket: StreamSocket;
  actorId: string | null;
  streams: Set<string>;
}

export const STREAMS = ['user', 'public', 'public:local'] as const;

export function isValidStream(stream: string, signedIn: boolean): boolean {
  if (stream === 'user') return signedIn;
  return (
    stream === 'public' ||
    stream === 'public:local' ||
    /^hashtag:[\p{L}\p{N}_]{1,100}$/u.test(stream)
  );
}

/** Routes domain events to connected clients, checking visibility per viewer. */
export class StreamingHub {
  private readonly connections = new Set<Connection>();

  constructor(private readonly ctx: CoreContext) {}

  add(socket: StreamSocket, actorId: string | null): Connection {
    const connection: Connection = { socket, actorId, streams: new Set() };
    this.connections.add(connection);
    return connection;
  }

  remove(connection: Connection): void {
    this.connections.delete(connection);
  }

  get size(): number {
    return this.connections.size;
  }

  private send(connection: Connection, message: StreamEvent): void {
    if (connection.socket.readyState === 1) connection.socket.send(JSON.stringify(message));
  }

  async handle(event: DomainEvent): Promise<void> {
    if (this.connections.size === 0) return;
    try {
      if (event.type === 'post.created') await this.onPostCreated(event.postId, 'update');
      else if (event.type === 'post.updated' || event.type === 'poll.voted')
        await this.onPostCreated(event.postId, 'status.update');
      else if (event.type === 'post.deleted') {
        await this.onPostDeleted(event);
      } else if (event.type === 'notification.created') {
        await this.onNotification(event.notificationId, event.recipientActorId);
      }
    } catch (error) {
      console.error('streaming: failed to handle event', event.type, error);
    }
  }

  private async onPostCreated(postId: string, kind: 'update' | 'status.update'): Promise<void> {
    const { db } = this.ctx;
    const { posts, follows, postAudiences, mutes, postTags, tags } = schema;
    const [post] = await db.select().from(posts).where(eq(posts.id, postId));
    if (!post) return;

    const connected = [
      ...new Set([...this.connections].map((c) => c.actorId).filter((id): id is string => !!id)),
    ];
    const homeAudience = new Set<string>([post.actorId]);
    if (connected.length > 0) {
      const [followers, audience, muted] = await Promise.all([
        db
          .select({ id: follows.actorId })
          .from(follows)
          .where(and(eq(follows.targetActorId, post.actorId), inArray(follows.actorId, connected))),
        db
          .select({ id: postAudiences.actorId })
          .from(postAudiences)
          .where(and(eq(postAudiences.postId, post.id), inArray(postAudiences.actorId, connected))),
        db
          .select({ id: mutes.actorId })
          .from(mutes)
          .where(and(eq(mutes.targetActorId, post.actorId), inArray(mutes.actorId, connected))),
      ]);
      if (post.groupId) {
        // Group posts go to the group's members, as in Home; replies stay in their threads.
        if (!post.inReplyToId) {
          const members = await db
            .select({ id: schema.groupMembers.actorId })
            .from(schema.groupMembers)
            .where(
              and(
                eq(schema.groupMembers.groupId, post.groupId),
                eq(schema.groupMembers.state, 'member'),
                inArray(schema.groupMembers.actorId, connected),
              ),
            );
          for (const r of members) homeAudience.add(r.id);
        }
      } else {
        for (const r of [...followers, ...audience]) homeAudience.add(r.id);
      }
      for (const r of muted) homeAudience.delete(r.id);
    }
    const isPublicTopLevel =
      !post.groupId &&
      post.visibility === 'public' &&
      !post.reblogOfId &&
      (post.inReplyToActorId === null || post.inReplyToActorId === post.actorId);
    const tagNames = isPublicTopLevel
      ? (
          await db
            .select({ name: tags.name })
            .from(postTags)
            .innerJoin(tags, eq(tags.id, postTags.tagId))
            .where(eq(postTags.postId, post.id))
        ).map((t) => t.name)
      : [];

    const cache = new Map<string | null, Awaited<ReturnType<typeof getStatus>> | null>();
    const statusFor = async (viewer: string | null) => {
      if (!cache.has(viewer)) {
        cache.set(viewer, await getStatus(this.ctx, viewer, post.id).catch(() => null));
      }
      return cache.get(viewer) ?? null;
    };

    // Mutes, blocks, keyword filters and the like apply to live updates as to timelines.
    const allowed = new Map<string, Promise<boolean>>();
    const allowedFor = (viewer: string | null, context: 'home' | 'public') => {
      const key = `${viewer ?? ''}:${context}`;
      let result = allowed.get(key);
      if (!result) {
        result = streamableTo(this.ctx, viewer, post.id, context).catch(() => false);
        allowed.set(key, result);
      }
      return result;
    };

    for (const c of this.connections) {
      const targets: string[] = [];
      if (
        c.streams.has('user') &&
        c.actorId &&
        homeAudience.has(c.actorId) &&
        (await allowedFor(c.actorId, 'home'))
      )
        targets.push('user');
      if (isPublicTopLevel) {
        const publicTargets: string[] = [];
        if (c.streams.has('public')) publicTargets.push('public');
        if (post.local && c.streams.has('public:local')) publicTargets.push('public:local');
        for (const tag of tagNames)
          if (c.streams.has(`hashtag:${tag}`)) publicTargets.push(`hashtag:${tag}`);
        if (publicTargets.length > 0 && (await allowedFor(c.actorId, 'public')))
          targets.push(...publicTargets);
      }
      if (targets.length === 0) continue;
      const status = await statusFor(c.actorId);
      if (!status) continue;
      for (const stream of targets) this.send(c, { event: kind, stream, payload: status });
    }
  }

  /** Tells only the clients that could have seen the post that it is gone. */
  private async onPostDeleted(
    event: Extract<DomainEvent, { type: 'post.deleted' }>,
  ): Promise<void> {
    const isPublic = event.visibility === 'public' || event.visibility === 'unlisted';
    const allowed = new Set<string>([event.actorId, ...event.audienceActorIds]);
    if (event.visibility === 'followers') {
      const connected = [...this.connections]
        .map((c) => c.actorId)
        .filter((id): id is string => !!id);
      if (connected.length > 0) {
        const rows = await this.ctx.db
          .select({ id: schema.follows.actorId })
          .from(schema.follows)
          .where(
            and(
              eq(schema.follows.targetActorId, event.actorId),
              inArray(schema.follows.actorId, connected),
            ),
          );
        for (const row of rows) allowed.add(row.id);
      }
    }
    for (const c of this.connections) {
      if (c.streams.size === 0) continue;
      if (!isPublic && !(c.actorId && allowed.has(c.actorId))) continue;
      const stream = c.streams.has('user') ? 'user' : ([...c.streams][0] ?? 'user');
      this.send(c, { event: 'delete', stream, payload: event.postId });
    }
  }

  private async onNotification(notificationId: string, recipientActorId: string): Promise<void> {
    const listeners = [...this.connections].filter(
      (c) => c.actorId === recipientActorId && c.streams.has('user'),
    );
    if (listeners.length === 0) return;
    const rows = await this.ctx.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, notificationId));
    const [notification] = await serializeNotifications(this.ctx, recipientActorId, rows);
    if (!notification) return;
    for (const c of listeners)
      this.send(c, { event: 'notification', stream: 'user', payload: notification });
  }
}

const CHANNEL = 'disbigle:events';

/** Publishes domain events to Redis so every server process (and its hub) receives them. */
export class RedisEventBus implements EventBus {
  constructor(private readonly redis: Redis) {}
  async publish(event: DomainEvent): Promise<void> {
    await this.redis.publish(CHANNEL, JSON.stringify(event));
  }
}

export async function subscribeHubToRedis(subscriber: Redis, hub: StreamingHub): Promise<void> {
  await subscriber.subscribe(CHANNEL);
  subscriber.on('message', (_channel, message) => {
    void hub.handle(JSON.parse(message) as DomainEvent);
  });
}

/** In-process bus for tests and single-process setups. */
export class LocalEventBus implements EventBus {
  constructor(private readonly hub: StreamingHub) {}
  async publish(event: DomainEvent): Promise<void> {
    await this.hub.handle(event);
  }
}
