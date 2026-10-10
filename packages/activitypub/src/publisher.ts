import type { CoreContext, DomainEvent, EventBus } from '@disbigle/core';
import { schema } from '@disbigle/db';
import type { Context, Federation } from '@fedify/fedify';
import {
  Accept,
  Announce,
  Block,
  Create,
  Delete,
  Follow,
  Like,
  PUBLIC_COLLECTION,
  type Recipient,
  Reject,
  Tombstone,
  Undo,
  Update,
} from '@fedify/vocab';
import { eq, inArray } from 'drizzle-orm';
import { addressing, localActorToPerson, postToNote } from './convert.ts';

type ActorRow = typeof schema.actors.$inferSelect;

const speaksActivityPub = (actor: ActorRow | undefined): actor is ActorRow =>
  !!actor &&
  actor.domain !== null &&
  !actor.suspendedAt &&
  actor.protocols.includes('activitypub') &&
  !!actor.apInbox &&
  !!actor.apUri;

function recipient(actor: ActorRow): Recipient {
  return {
    id: new URL(actor.apUri ?? ''),
    inboxId: new URL(actor.apInbox ?? ''),
    endpoints: actor.apSharedInbox ? { sharedInbox: new URL(actor.apSharedInbox) } : null,
  };
}

const freshId = (ctx: Context<CoreContext>, username: string, kind: string) =>
  new URL(`${ctx.getActorUri(username).href}#${kind}/${crypto.randomUUID()}`);

/**
 * Turns domain events into outgoing ActivityPub activities. Delivery goes through Fedify's queue,
 * so `publish` only enqueues and never waits for remote servers.
 */
export class ActivityPubPublisher implements EventBus {
  constructor(
    private readonly federation: Federation<CoreContext>,
    private readonly core: CoreContext,
  ) {}

  private context(): Context<CoreContext> {
    return this.federation.createContext(new URL(this.core.config.PUBLIC_URL), this.core);
  }

  private async actors(ids: string[]): Promise<Map<string, ActorRow>> {
    if (ids.length === 0) return new Map();
    const rows = await this.core.db
      .select()
      .from(schema.actors)
      .where(inArray(schema.actors.id, ids));
    return new Map(rows.map((a) => [a.id, a]));
  }

  async publish(event: DomainEvent): Promise<void> {
    try {
      await this.handle(event);
    } catch (error) {
      console.error('activitypub: failed to publish', event.type, error);
    }
  }

  private async handle(event: DomainEvent): Promise<void> {
    const ctx = this.context();
    switch (event.type) {
      case 'post.created':
        return this.postCreated(ctx, event.postId);
      case 'post.deleted':
        return this.postDeleted(ctx, event);
      case 'follow.requested': {
        const actors = await this.actors([event.actorId, event.targetActorId]);
        const local = actors.get(event.actorId);
        const target = actors.get(event.targetActorId);
        if (local?.domain !== null || !speaksActivityPub(target) || !event.apUri) return;
        await ctx.sendActivity(
          { identifier: local.username },
          recipient(target),
          new Follow({
            id: new URL(event.apUri),
            actor: ctx.getActorUri(local.username),
            object: new URL(target.apUri ?? ''),
          }),
        );
        return;
      }
      case 'follow.created':
      case 'follow.rejected': {
        const actors = await this.actors([event.actorId, event.targetActorId]);
        const follower = actors.get(event.actorId);
        const local = actors.get(event.targetActorId);
        if (!speaksActivityPub(follower) || local?.domain !== null || !event.apUri) return;
        const followActivity = new Follow({
          id: new URL(event.apUri),
          actor: new URL(follower.apUri ?? ''),
          object: ctx.getActorUri(local.username),
        });
        const Response = event.type === 'follow.created' ? Accept : Reject;
        await ctx.sendActivity(
          { identifier: local.username },
          recipient(follower),
          new Response({
            id: freshId(
              ctx,
              local.username,
              event.type === 'follow.created' ? 'accepts' : 'rejects',
            ),
            actor: ctx.getActorUri(local.username),
            object: followActivity,
          }),
        );
        return;
      }
      case 'follow.removed': {
        const actors = await this.actors([event.actorId, event.targetActorId]);
        const local = actors.get(event.actorId);
        const target = actors.get(event.targetActorId);
        if (local?.domain !== null || !speaksActivityPub(target) || !event.apUri) return;
        await ctx.sendActivity(
          { identifier: local.username },
          recipient(target),
          new Undo({
            id: freshId(ctx, local.username, 'undo'),
            actor: ctx.getActorUri(local.username),
            object: new Follow({
              id: new URL(event.apUri),
              actor: ctx.getActorUri(local.username),
              object: new URL(target.apUri ?? ''),
            }),
          }),
        );
        return;
      }
      case 'like.created':
      case 'like.removed': {
        const [post] = await this.core.db
          .select()
          .from(schema.posts)
          .where(eq(schema.posts.id, event.postId));
        if (!post?.apUri || !event.apUri) return;
        const actors = await this.actors([event.actorId, post.actorId]);
        const local = actors.get(event.actorId);
        const author = actors.get(post.actorId);
        if (local?.domain !== null || !speaksActivityPub(author)) return;
        const likeActivity = new Like({
          id: new URL(event.apUri),
          actor: ctx.getActorUri(local.username),
          object: new URL(post.apUri),
        });
        await ctx.sendActivity(
          { identifier: local.username },
          recipient(author),
          event.type === 'like.created'
            ? likeActivity
            : new Undo({
                id: freshId(ctx, local.username, 'undo'),
                actor: ctx.getActorUri(local.username),
                object: likeActivity,
              }),
        );
        return;
      }
      case 'profile.updated': {
        const [actor] = (await this.actors([event.actorId])).values();
        if (!actor || actor.domain !== null) return;
        const person = await localActorToPerson(
          ctx,
          actor,
          await ctx.getActorKeyPairs(actor.username),
        );
        await ctx.sendActivity(
          { identifier: actor.username },
          'followers',
          new Update({
            id: freshId(ctx, actor.username, 'updates'),
            actor: ctx.getActorUri(actor.username),
            object: person,
            to: PUBLIC_COLLECTION,
          }),
          { preferSharedInbox: true },
        );
        return;
      }
      case 'block.created': {
        const actors = await this.actors([event.actorId, event.targetActorId]);
        const local = actors.get(event.actorId);
        const target = actors.get(event.targetActorId);
        if (local?.domain !== null || !speaksActivityPub(target)) return;
        await ctx.sendActivity(
          { identifier: local.username },
          recipient(target),
          new Block({
            id: freshId(ctx, local.username, 'blocks'),
            actor: ctx.getActorUri(local.username),
            object: new URL(target.apUri ?? ''),
          }),
        );
        return;
      }
      case 'account.deleted': {
        const [actor] = (await this.actors([event.actorId])).values();
        if (!actor || actor.domain !== null) return;
        await ctx.sendActivity(
          { identifier: actor.username },
          'followers',
          new Delete({
            id: new URL(`${ctx.getActorUri(actor.username).href}#delete`),
            actor: ctx.getActorUri(actor.username),
            object: ctx.getActorUri(actor.username),
            to: PUBLIC_COLLECTION,
          }),
          { preferSharedInbox: true },
        );
        // Also tell the servers of the accounts we follow, as Mastodon does.
        const followed = await this.core.db
          .select({ actor: schema.actors })
          .from(schema.follows)
          .innerJoin(schema.actors, eq(schema.actors.id, schema.follows.targetActorId))
          .where(eq(schema.follows.actorId, actor.id));
        const targets = followed.map((f) => f.actor).filter(speaksActivityPub);
        if (targets.length > 0) {
          await ctx.sendActivity(
            { identifier: actor.username },
            targets.map(recipient),
            new Delete({
              id: new URL(`${ctx.getActorUri(actor.username).href}#delete`),
              actor: ctx.getActorUri(actor.username),
              object: ctx.getActorUri(actor.username),
              to: PUBLIC_COLLECTION,
            }),
            { preferSharedInbox: true },
          );
        }
        return;
      }
      default:
        return;
    }
  }

  private async postCreated(ctx: Context<CoreContext>, postId: string): Promise<void> {
    const [post] = await this.core.db
      .select()
      .from(schema.posts)
      .where(eq(schema.posts.id, postId));
    if (!post?.local || !post.apUri) return;
    const [author] = await this.core.db
      .select()
      .from(schema.actors)
      .where(eq(schema.actors.id, post.actorId));
    if (!author || author.domain !== null) return;
    const sender = { identifier: author.username };

    if (post.reblogOfId) {
      const [original] = await this.core.db
        .select()
        .from(schema.posts)
        .where(eq(schema.posts.id, post.reblogOfId));
      if (!original?.apUri) return;
      const [originalAuthor] = await this.core.db
        .select()
        .from(schema.actors)
        .where(eq(schema.actors.id, original.actorId));
      const announce = new Announce({
        id: new URL(post.apUri),
        actor: ctx.getActorUri(author.username),
        object: new URL(original.apUri),
        to: PUBLIC_COLLECTION,
        ccs: [
          ctx.getFollowersUri(author.username),
          ...(originalAuthor?.apUri ? [new URL(originalAuthor.apUri)] : []),
        ],
        published: Temporal.Instant.fromEpochMilliseconds(post.createdAt.getTime()),
      });
      await ctx.sendActivity(sender, 'followers', announce, { preferSharedInbox: true });
      if (speaksActivityPub(originalAuthor))
        await ctx.sendActivity(sender, recipient(originalAuthor), announce);
      return;
    }

    const note = await postToNote(ctx, post, author);
    const { explicitRecipients } = await addressing(ctx, post, author);
    const create = new Create({
      id: new URL(`${post.apUri}/activity`),
      actor: ctx.getActorUri(author.username),
      object: note,
      tos: note.toIds,
      ccs: note.ccIds,
      published: note.published,
    });
    if (
      post.visibility === 'public' ||
      post.visibility === 'unlisted' ||
      post.visibility === 'followers'
    ) {
      await ctx.sendActivity(sender, 'followers', create, { preferSharedInbox: true });
    }
    const direct = explicitRecipients.filter(speaksActivityPub);
    if (post.inReplyToActorId && (post.visibility === 'public' || post.visibility === 'unlisted')) {
      const [parentAuthor] = (await this.actors([post.inReplyToActorId])).values();
      if (speaksActivityPub(parentAuthor) && !direct.some((a) => a.id === parentAuthor.id))
        direct.push(parentAuthor);
    }
    if (direct.length > 0) {
      await ctx.sendActivity(sender, direct.map(recipient), create, {
        preferSharedInbox: post.visibility !== 'limited' && post.visibility !== 'direct',
      });
    }
  }

  private async postDeleted(
    ctx: Context<CoreContext>,
    event: Extract<DomainEvent, { type: 'post.deleted' }>,
  ) {
    if (!event.apUri) return;
    const [author] = await this.core.db
      .select()
      .from(schema.actors)
      .where(eq(schema.actors.id, event.actorId));
    if (!author || author.domain !== null) return;
    const sender = { identifier: author.username };
    const activity = event.reblogOfId
      ? new Undo({
          id: freshId(ctx, author.username, 'undo'),
          actor: ctx.getActorUri(author.username),
          object: new Announce({
            id: new URL(event.apUri),
            actor: ctx.getActorUri(author.username),
          }),
          to: PUBLIC_COLLECTION,
        })
      : new Delete({
          id: new URL(`${event.apUri}#delete`),
          actor: ctx.getActorUri(author.username),
          object: new Tombstone({ id: new URL(event.apUri) }),
          to: PUBLIC_COLLECTION,
        });
    if (
      event.visibility === 'public' ||
      event.visibility === 'unlisted' ||
      event.visibility === 'followers'
    ) {
      await ctx.sendActivity(sender, 'followers', activity, { preferSharedInbox: true });
    }
    const audience = [...(await this.actors(event.audienceActorIds)).values()].filter(
      speaksActivityPub,
    );
    if (audience.length > 0) await ctx.sendActivity(sender, audience.map(recipient), activity);
  }
}

/** Fans one event out to several buses (streaming, ActivityPub, diaspora...). */
export class CompositeEventBus implements EventBus {
  constructor(private readonly buses: EventBus[]) {}
  async publish(event: DomainEvent): Promise<void> {
    await Promise.all(this.buses.map((bus) => bus.publish(event)));
  }
}
