import {
  bridgeIdentityOf,
  type CoreContext,
  type DomainEvent,
  type EventBus,
  ensureBridgeIdentity,
  postsForNewFollower,
} from '@disbigle/core';
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
  Move,
  Note,
  PUBLIC_COLLECTION,
  type Question,
  type Recipient,
  Reject,
  Tombstone,
  Undo,
  Update,
} from '@fedify/vocab';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { bridgedReplyOf, bridgedThreadOf, threadAddressing, threadAudience } from './bridge.ts';
import { addressing, bridgedNote, localActorToPerson, postToNote } from './convert.ts';

type ActorRow = typeof schema.actors.$inferSelect;
type PostRow = typeof schema.posts.$inferSelect;

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

const isPublicThread = (root: PostRow) =>
  root.visibility === 'public' || root.visibility === 'unlisted';

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
      case 'post.updated':
        return this.postCreated(ctx, event.postId, true);
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
        if (event.type === 'follow.created') await this.sendRecentPosts(ctx, local, follower);
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
        if (await this.bridgeLike(ctx, event)) return;
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
      case 'account.moved': {
        const actors = await this.actors([event.actorId, event.targetActorId]);
        const origin = actors.get(event.actorId);
        const target = actors.get(event.targetActorId);
        if (origin?.domain !== null || !target?.apUri) return;
        await ctx.sendActivity(
          { identifier: origin.username },
          'followers',
          new Move({
            id: freshId(ctx, origin.username, 'moves'),
            actor: ctx.getActorUri(origin.username),
            object: ctx.getActorUri(origin.username),
            target: new URL(target.apUri),
            to: PUBLIC_COLLECTION,
          }),
          { preferSharedInbox: true },
        );
        return;
      }
      case 'poll.voted':
        return this.pollVoted(ctx, event);
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

  private async postCreated(
    ctx: Context<CoreContext>,
    postId: string,
    edited = false,
  ): Promise<void> {
    const [post] = await this.core.db
      .select()
      .from(schema.posts)
      .where(eq(schema.posts.id, postId));
    if (post && !post.local && !edited) return this.bridgeReply(ctx, post);
    if (!post?.local || !post.apUri) return;
    const [author] = await this.core.db
      .select()
      .from(schema.actors)
      .where(eq(schema.actors.id, post.actorId));
    if (!author || author.domain !== null) return;
    const sender = { identifier: author.username };

    if (post.reblogOfId) {
      if (edited) return;
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

    const Activity = edited ? Update : Create;
    await this.deliver(
      ctx,
      post,
      author,
      (note) =>
        new Activity({
          id: edited
            ? new URL(`${post.apUri}#updates/${Date.now()}`)
            : new URL(`${post.apUri}/activity`),
          actor: ctx.getActorUri(author.username),
          object: note,
          tos: note.toIds,
          ccs: note.ccIds,
          published: note.published,
        }),
    );
  }

  /**
   * A reply written on diaspora* by someone ActivityPub can't reach, on a public thread started
   * here: sent from their bridge identity to the followers of the thread's author and to the
   * ActivityPub people already in the thread, so both networks see the same conversation.
   */
  private async bridgeReply(ctx: Context<CoreContext>, post: PostRow): Promise<void> {
    const reply = await bridgedReplyOf(this.core, post);
    if (!reply) return;
    const bridge = await ensureBridgeIdentity(this.core, reply.author);
    let { apUri } = post;
    if (!apUri) {
      apUri = ctx.getObjectUri(Note, { identifier: bridge.username, id: post.id }).href;
      await this.core.db
        .update(schema.posts)
        .set({ apUri })
        .where(and(eq(schema.posts.id, post.id), isNull(schema.posts.apUri)));
    }
    const audience = await threadAudience(this.core, reply);
    const targets = new Map<string, ActorRow>();
    for (const actor of audience) if (speaksActivityPub(actor)) targets.set(actor.id, actor);
    if (targets.size === 0) return;
    const addressing = threadAddressing(ctx, reply, audience);
    const parentAuthor = reply.parent ? targets.get(reply.parent.actorId) : undefined;
    if (parentAuthor?.apUri && isPublicThread(reply.root))
      addressing.cc.push(new URL(parentAuthor.apUri));
    const note = bridgedNote(
      ctx,
      { ...post, apUri },
      bridge,
      reply.parent?.apUri ?? null,
      addressing,
    );
    await ctx.sendActivity(
      { identifier: bridge.username },
      [...targets.values()].map(recipient),
      new Create({
        id: new URL(`${apUri}/activity`),
        actor: ctx.getActorUri(bridge.username),
        object: note,
        tos: note.toIds,
        ccs: note.ccIds,
        published: note.published,
      }),
      // Shared inboxes would reach everyone the server hosts; private threads go person by person.
      { preferSharedInbox: isPublicThread(reply.root) },
    );
  }

  /** The latest public posts of `local`, sent to a new follower's inbox only. */
  private async sendRecentPosts(ctx: Context<CoreContext>, local: ActorRow, follower: ActorRow) {
    const recent = await postsForNewFollower(this.core, 'activitypub', follower.id, local.id);
    for (const post of recent) {
      if (!post.apUri) continue;
      const note = await postToNote(ctx, post, local);
      await ctx.sendActivity(
        { identifier: local.username },
        recipient(follower),
        new Create({
          id: new URL(`${post.apUri}/activity`),
          actor: ctx.getActorUri(local.username),
          object: note,
          tos: note.toIds,
          ccs: note.ccIds,
          published: note.published,
        }),
      );
    }
  }

  /**
   * A like (or its removal) by someone ActivityPub can't reach, on a public thread started here:
   * sent from their bridge identity to the thread's ActivityPub audience. True when handled.
   */
  private async bridgeLike(
    ctx: Context<CoreContext>,
    event: Extract<DomainEvent, { type: 'like.created' | 'like.removed' }>,
  ): Promise<boolean> {
    const [target] = await this.core.db
      .select()
      .from(schema.posts)
      .where(eq(schema.posts.id, event.postId));
    if (!target?.apUri) return false;
    const thread = await bridgedThreadOf(
      this.core,
      event.actorId,
      target.threadRootId ?? target.id,
    );
    if (!thread) return false;
    const bridge = await ensureBridgeIdentity(this.core, thread.author);
    let likeUri = event.apUri;
    if (!likeUri && event.type === 'like.created') {
      likeUri = `${ctx.getActorUri(bridge.username).href}#likes/${event.likeId}`;
      await this.core.db
        .update(schema.likes)
        .set({ apUri: likeUri })
        .where(and(eq(schema.likes.id, event.likeId), isNull(schema.likes.apUri)));
    }
    const targets = (await threadAudience(this.core, thread)).filter(speaksActivityPub);
    if (!likeUri || targets.length === 0) return true;
    const shared = isPublicThread(thread.root);
    const like = new Like({
      id: new URL(likeUri),
      actor: ctx.getActorUri(bridge.username),
      object: new URL(target.apUri),
    });
    await ctx.sendActivity(
      { identifier: bridge.username },
      targets.map(recipient),
      event.type === 'like.created'
        ? like
        : new Undo({
            id: freshId(ctx, bridge.username, 'undo'),
            actor: ctx.getActorUri(bridge.username),
            object: like,
          }),
      { preferSharedInbox: shared },
    );
    return true;
  }

  /**
   * A bridged reply deleted by its author on diaspora*: the bridge identity deletes its Note for
   * the thread's ActivityPub audience. True when handled.
   */
  private async bridgeDelete(
    ctx: Context<CoreContext>,
    event: Extract<DomainEvent, { type: 'post.deleted' }>,
  ): Promise<boolean> {
    if (!event.apUri || !event.threadRootId || event.threadRootId === event.postId) return false;
    const thread = await bridgedThreadOf(this.core, event.actorId, event.threadRootId);
    if (!thread) return false;
    const bridge = await bridgeIdentityOf(this.core, thread.author.id);
    if (!bridge || !event.apUri.startsWith(`${ctx.getActorUri(bridge.username).href}/`))
      return true;
    const audience = await threadAudience(this.core, thread);
    const targets = audience.filter(speaksActivityPub);
    if (targets.length === 0) return true;
    const { to, cc } = threadAddressing(ctx, thread, audience);
    await ctx.sendActivity(
      { identifier: bridge.username },
      targets.map(recipient),
      new Delete({
        id: new URL(`${event.apUri}#delete`),
        actor: ctx.getActorUri(bridge.username),
        object: new Tombstone({ id: new URL(event.apUri) }),
        tos: to,
        ccs: cc,
      }),
      { preferSharedInbox: isPublicThread(thread.root) },
    );
    return true;
  }

  /**
   * Sends an activity about a local post to its audience: followers for public, unlisted and
   * followers-only posts; the explicit recipients (and, for public replies, the parent's author)
   * besides. Limited posts go to each recipient on its own, addressed to that recipient only.
   */
  private async deliver(
    ctx: Context<CoreContext>,
    post: PostRow,
    author: ActorRow,
    build: (note: Note | Question) => Create | Update,
  ): Promise<void> {
    const sender = { identifier: author.username };
    const { explicitRecipients } = await addressing(ctx, post, author);
    const direct = explicitRecipients.filter(speaksActivityPub);
    if (post.visibility === 'limited') {
      for (const target of direct) {
        const activity = build(await postToNote(ctx, post, author, target));
        await ctx.sendActivity(sender, recipient(target), activity);
      }
      return;
    }
    const activity = build(await postToNote(ctx, post, author));
    if (
      post.visibility === 'public' ||
      post.visibility === 'unlisted' ||
      post.visibility === 'followers'
    ) {
      await ctx.sendActivity(sender, 'followers', activity, { preferSharedInbox: true });
    }
    if (post.inReplyToActorId && (post.visibility === 'public' || post.visibility === 'unlisted')) {
      const [parentAuthor] = (await this.actors([post.inReplyToActorId])).values();
      if (speaksActivityPub(parentAuthor) && !direct.some((a) => a.id === parentAuthor.id))
        direct.push(parentAuthor);
    }
    if (direct.length > 0) {
      await ctx.sendActivity(sender, direct.map(recipient), activity, {
        preferSharedInbox: post.visibility !== 'direct',
      });
    }
  }

  /**
   * A local vote on a remote poll goes to the poll's author as one Note per choice; any vote on a
   * local poll is followed by an Update of the Question with the new totals.
   */
  private async pollVoted(
    ctx: Context<CoreContext>,
    event: Extract<DomainEvent, { type: 'poll.voted' }>,
  ) {
    const [post] = await this.core.db
      .select()
      .from(schema.posts)
      .where(eq(schema.posts.id, event.postId));
    const [poll] = await this.core.db
      .select()
      .from(schema.polls)
      .where(eq(schema.polls.id, event.pollId));
    if (!post?.apUri || !poll) return;
    const actors = await this.actors([event.actorId, post.actorId]);
    const voter = actors.get(event.actorId);
    const author = actors.get(post.actorId);
    if (!voter || !author) return;

    if (!post.local && voter.domain === null && speaksActivityPub(author)) {
      const votes = await this.core.db
        .select()
        .from(schema.pollVotes)
        .where(inArray(schema.pollVotes.id, event.voteIds));
      for (const vote of votes) {
        if (!vote.apUri) continue;
        const note = new Note({
          id: new URL(vote.apUri),
          attribution: ctx.getActorUri(voter.username),
          name: poll.options[vote.choice]?.title ?? '',
          replyTarget: new URL(post.apUri),
          to: new URL(author.apUri ?? ''),
        });
        await ctx.sendActivity(
          { identifier: voter.username },
          recipient(author),
          new Create({
            id: new URL(`${vote.apUri}/activity`),
            actor: ctx.getActorUri(voter.username),
            object: note,
            to: new URL(author.apUri ?? ''),
          }),
        );
      }
      return;
    }

    if (post.local && author.domain === null) {
      // The new totals reach the poll's audience, never more.
      await this.deliver(
        ctx,
        post,
        author,
        (question) =>
          new Update({
            id: new URL(`${post.apUri}#updates/${Date.now()}`),
            actor: ctx.getActorUri(author.username),
            object: question,
            tos: question.toIds,
            ccs: question.ccIds,
          }),
      );
    }
  }

  private async postDeleted(
    ctx: Context<CoreContext>,
    event: Extract<DomainEvent, { type: 'post.deleted' }>,
  ) {
    if (await this.bridgeDelete(ctx, event)) return;
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
    // As for the reply itself: the author it answered got it, so they get its deletion too.
    const replyTo =
      event.inReplyToActorId && (event.visibility === 'public' || event.visibility === 'unlisted')
        ? [event.inReplyToActorId]
        : [];
    const audience = [
      ...(await this.actors([...event.audienceActorIds, ...replyTo])).values(),
    ].filter(speaksActivityPub);
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
