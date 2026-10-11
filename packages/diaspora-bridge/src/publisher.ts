// Turns domain events into outgoing diaspora* deliveries, like ActivityPubPublisher does for
// ActivityPub. Only people whose preferred protocol is diaspora* are addressed.
import { randomBytes } from 'node:crypto';
import {
  acceptFollowRequest,
  bridgeIdentityOf,
  type DomainEvent,
  type EventBus,
  ensureBridgeIdentity,
  inAudienceOf,
  postsForNewFollower,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import {
  type AccountDeletion,
  type Comment,
  type Contact,
  type PollParticipation,
  type Profile,
  type Retraction,
  serializeEntity,
  signAccountMigration,
  signRelayable,
} from '@disbigle/diaspora';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  type ActorRow,
  actorById,
  deliversViaDiaspora,
  diasporaIdOf,
  isPublicVisibility,
  type PostRow,
  postById,
  publicReceiveUrl,
  threadRootOf,
} from './actors.ts';
import type { DiasporaBridge } from './bridge.ts';
import {
  commentFor,
  diasporaText,
  emptyRecipients,
  likeFor,
  recipientsFor,
  reshareFor,
  sendInteraction,
  sendToRecipients,
  signerFor,
  statusMessageFor,
} from './outgoing.ts';
import { answerGuids } from './polls.ts';
import { htmlToText } from './text.ts';

async function followedIds(ctx: DiasporaBridge['ctx'], actorId: string): Promise<string[]> {
  const rows = await ctx.db
    .select({ id: schema.follows.targetActorId })
    .from(schema.follows)
    .where(eq(schema.follows.actorId, actorId));
  return rows.map((r) => r.id);
}

/** The public Profile entity of a local actor. */
export function profileFor(
  ctx: DiasporaBridge['ctx'],
  actor: ActorRow,
  diasporaId: string,
): Profile {
  const name = actor.displayName || actor.username;
  const avatar = actor.avatarUrl ? new URL(actor.avatarUrl, ctx.config.PUBLIC_URL).href : null;
  return {
    type: 'Profile',
    author: diasporaId,
    fullName: name.slice(0, 70).replace(/;/g, ','),
    firstName: name.slice(0, 32).replace(/;/g, ','),
    ...(avatar ? { imageUrl: avatar, imageUrlMedium: avatar, imageUrlSmall: avatar } : {}),
    ...(actor.summary ? { bio: htmlToText(actor.summary) } : {}),
    searchable: actor.discoverable,
    public: true,
  };
}

/**
 * diaspora* event publisher. `publish` only queues work on the bridge queue, so requests never
 * wait for remote servers.
 *
 * Older cores did not put the thread root of a deleted reply and the guid of a removed like in
 * the events; for those the publisher falls back to what it saw in this process.
 */
export class DiasporaPublisher implements EventBus {
  private readonly replyRoots = new Map<string, string>();
  private readonly likeGuids = new Map<string, string>();
  private readonly contactsSent = new Set<string>();

  constructor(private readonly bridge: DiasporaBridge) {
    bridge.attachPublisher(this);
  }

  /** Queues the event; it is handled by whichever process consumes the bridge queue. */
  async publish(event: DomainEvent): Promise<void> {
    await this.bridge.queue.enqueue({ type: 'event', event });
  }

  private get ctx() {
    return this.bridge.ctx;
  }

  /** Handles one event now (normally called from the queue). */
  async handle(event: DomainEvent): Promise<void> {
    switch (event.type) {
      case 'post.created':
        return this.postCreated(event.postId);
      case 'post.deleted':
        return this.postDeleted(event);
      case 'like.created':
        return this.likeCreated(event);
      case 'like.removed':
        return this.likeRemoved(event);
      case 'follow.requested':
        return this.followRequested(event.actorId, event.targetActorId);
      case 'follow.removed':
        await this.sendContact(event.actorId, event.targetActorId, {
          following: false,
          sharing: false,
        });
        return;
      case 'block.created':
        await this.sendContact(event.actorId, event.targetActorId, {
          following: false,
          sharing: false,
          blocking: true,
        });
        return;
      case 'profile.updated':
        return this.profileUpdated(event.actorId);
      case 'account.deleted':
        return this.accountDeleted(event.actorId);
      case 'account.moved':
        return this.accountMoved(event.actorId, event.targetActorId);
      case 'poll.voted':
        return this.pollVoted(event);
      case 'follow.created':
        return this.followCreated(event.actorId, event.targetActorId);
      default:
        // follow.rejected has no diaspora* counterpart.
        return;
    }
  }

  private async localActor(id: string): Promise<ActorRow | null> {
    const actor = await actorById(this.ctx, id);
    return actor && actor.domain === null ? actor : null;
  }

  private async postCreated(postId: string): Promise<void> {
    const ctx = this.ctx;
    const post = await postById(ctx, postId);
    if (post && !post.local && post.inReplyToId) return this.bridgeReply(post);
    if (!post?.local || !post.diasporaGuid) return;
    const author = await this.localActor(post.actorId);
    const signer = author ? await signerFor(ctx, author) : null;
    if (!author || !signer) return;

    if (post.reblogOfId) {
      const original = await postById(ctx, post.reblogOfId);
      const originalAuthor = original ? await actorById(ctx, original.actorId) : null;
      if (!original?.diasporaGuid || !originalAuthor) return;
      const recipients = await recipientsFor(
        ctx,
        { ...post, inReplyToActorId: null },
        { explicitIds: [originalAuthor.id] },
      );
      const entity = reshareFor(ctx, post, author, original, originalAuthor);
      await sendToRecipients(this.bridge, serializeEntity(entity), signer, recipients);
      return;
    }

    if (post.inReplyToId) {
      const root = await threadRootOf(ctx, post);
      if (!root.diasporaGuid || root.id === post.id) return;
      this.replyRoots.set(post.id, root.id);
      await sendInteraction(this.bridge, await commentFor(ctx, post, author, root), author, root);
      return;
    }

    const entity = await statusMessageFor(ctx, post, author);
    await sendToRecipients(
      this.bridge,
      serializeEntity(entity),
      signer,
      await recipientsFor(ctx, post),
    );
  }

  /**
   * A thread started here, and a remote account diaspora* can't reach acting in it: what
   * it does there reaches diaspora* through its bridge identity, relayed by the thread's author.
   */
  private async bridgedThread(authorId: string, rootId: string) {
    const ctx = this.ctx;
    const author = await actorById(ctx, authorId);
    if (!author || author.domain === null || author.protocols.includes('diaspora')) return null;
    const root = await postById(ctx, rootId);
    if (!root?.local || !root.diasporaGuid) return null;
    // On a private thread, only people it was shared with take part (and then everyone in it
    // sees what they do, as on diaspora*).
    if (!(await inAudienceOf(ctx, author.id, root))) return null;
    const rootAuthor = await this.localActor(root.actorId);
    const rootSigner = rootAuthor ? await signerFor(ctx, rootAuthor) : null;
    if (!rootSigner) return null;
    return { author, root, rootGuid: root.diasporaGuid, rootSigner };
  }

  /** A like by someone diaspora* can't reach, as a Like signed by their bridge identity. */
  private async bridgeLike(event: Extract<DomainEvent, { type: 'like.created' }>) {
    const ctx = this.ctx;
    const [row] = await ctx.db.select().from(schema.likes).where(eq(schema.likes.id, event.likeId));
    const target = await postById(ctx, event.postId);
    if (!row?.diasporaGuid || !target?.diasporaGuid) return;
    const thread = await this.bridgedThread(event.actorId, (await threadRootOf(ctx, target)).id);
    if (!thread) return;
    const bridge = await ensureBridgeIdentity(ctx, thread.author);
    const like = {
      ...likeFor(ctx, row.diasporaGuid, thread.author, target),
      author: this.bridgeId(bridge),
    };
    const xml = serializeEntity(signRelayable(like, bridge.privateKeyPem));
    await this.bridge.relayables.save({
      guid: row.diasporaGuid,
      entityType: 'Like',
      parentGuid: target.diasporaGuid,
      author: like.author,
      xml,
      likeId: row.id,
    });
    await sendToRecipients(
      this.bridge,
      xml,
      thread.rootSigner,
      await recipientsFor(ctx, thread.root),
    );
  }

  /**
   * Removal of a bridged like or comment: a Retraction naming the bridge identity as author,
   * relayed by the thread's author (diaspora* accepts retractions of comments and likes from
   * either).
   */
  private async bridgeRetraction(
    authorId: string,
    rootId: string,
    targetGuid: string,
    targetType: 'Comment' | 'Like',
  ) {
    const ctx = this.ctx;
    const thread = await this.bridgedThread(authorId, rootId);
    // No bridge identity: nothing of theirs ever reached diaspora*. (The stored copy can't tell:
    // it goes with the comment or like it belongs to.)
    const bridge = thread ? await bridgeIdentityOf(ctx, thread.author.id) : null;
    if (!thread || !bridge) return;
    const retraction: Retraction = {
      type: 'Retraction',
      author: this.bridgeId(bridge),
      targetGuid,
      targetType,
    };
    await sendToRecipients(
      this.bridge,
      serializeEntity(retraction),
      thread.rootSigner,
      await recipientsFor(ctx, thread.root),
    );
    await this.bridge.relayables.delete(targetGuid);
  }

  private bridgeId(bridge: { username: string }): string {
    return `${bridge.username}@${this.ctx.config.LOCAL_DOMAIN}`.toLowerCase();
  }

  /**
   * A reply from someone diaspora* can't reach (an ActivityPub account) on a thread started
   * here. diaspora* needs comments signed by their author, so it goes out from the
   * author's bridge identity, signed with its key, relayed by the thread's author like any comment.
   */
  private async bridgeReply(post: PostRow): Promise<void> {
    const ctx = this.ctx;
    if (!post.threadRootId || post.threadRootId === post.id) return;
    const thread = await this.bridgedThread(post.actorId, post.threadRootId);
    if (!thread) return;
    // A private answer (a direct message to the author, say) never goes to a public thread's audience.
    if (isPublicVisibility(thread.root.visibility) && !isPublicVisibility(post.visibility)) return;
    const { author, root, rootSigner } = thread;
    const bridge = await ensureBridgeIdentity(ctx, author);
    let guid = post.diasporaGuid;
    if (!guid) {
      guid = randomBytes(16).toString('hex');
      await ctx.db
        .update(schema.posts)
        .set({ diasporaGuid: guid })
        .where(and(eq(schema.posts.id, post.id), isNull(schema.posts.diasporaGuid)));
    }
    const comment: Comment = {
      type: 'Comment',
      author: this.bridgeId(bridge),
      guid,
      parentGuid: thread.rootGuid,
      text: await diasporaText(ctx, post),
      createdAt: post.createdAt,
    };
    const xml = serializeEntity(signRelayable(comment, bridge.privateKeyPem));
    // Kept like a received comment, so `/fetch` and late relaying serve the same signed copy.
    await this.bridge.relayables.save({
      guid,
      entityType: 'Comment',
      parentGuid: thread.rootGuid,
      author: comment.author,
      xml,
      postId: post.id,
    });
    await sendToRecipients(this.bridge, xml, rootSigner, await recipientsFor(ctx, root));
  }

  private async postDeleted(event: Extract<DomainEvent, { type: 'post.deleted' }>) {
    const ctx = this.ctx;
    if (!event.diasporaGuid) return;
    const author = await this.localActor(event.actorId);
    if (!author) {
      if (!event.threadRootId || event.threadRootId === event.postId) return;
      return this.bridgeRetraction(
        event.actorId,
        event.threadRootId,
        event.diasporaGuid,
        'Comment',
      );
    }
    const signer = await signerFor(ctx, author);
    if (!signer) return;
    const retraction: Retraction = {
      type: 'Retraction',
      author: diasporaIdOf(ctx, author),
      targetGuid: event.diasporaGuid,
      targetType: 'Post',
    };

    // Newer cores may carry the thread root in the event itself.
    const fromEvent = (event as { threadRootId?: string | null }).threadRootId;
    const rootId =
      fromEvent && fromEvent !== event.postId ? fromEvent : this.replyRoots.get(event.postId);
    if (rootId) {
      this.replyRoots.delete(event.postId);
      const root = await postById(ctx, rootId);
      if (root)
        await sendInteraction(this.bridge, { ...retraction, targetType: 'Comment' }, author, root);
      return;
    }

    let explicitIds = event.audienceActorIds;
    if (event.reblogOfId) {
      const original = await postById(ctx, event.reblogOfId);
      explicitIds = original ? [original.actorId] : [];
    }
    const recipients = await recipientsFor(
      ctx,
      {
        id: event.postId,
        actorId: author.id,
        visibility: event.visibility,
        inReplyToActorId: null,
      },
      { explicitIds },
    );
    await sendToRecipients(this.bridge, serializeEntity(retraction), signer, recipients);
  }

  private async likeCreated(event: Extract<DomainEvent, { type: 'like.created' }>) {
    const ctx = this.ctx;
    const author = await this.localActor(event.actorId);
    if (!author) return this.bridgeLike(event);
    const [row] = await ctx.db.select().from(schema.likes).where(eq(schema.likes.id, event.likeId));
    const target = await postById(ctx, event.postId);
    if (!row?.diasporaGuid || !target?.diasporaGuid) return;
    this.likeGuids.set(`${event.actorId}:${event.postId}`, row.diasporaGuid);
    const root = await threadRootOf(ctx, target);
    await sendInteraction(
      this.bridge,
      likeFor(ctx, row.diasporaGuid, author, target),
      author,
      root,
    );
  }

  private async likeRemoved(event: Extract<DomainEvent, { type: 'like.removed' }>) {
    const ctx = this.ctx;
    const author = await this.localActor(event.actorId);
    if (!author) {
      const target = await postById(ctx, event.postId);
      if (!target || !event.diasporaGuid) return;
      const root = await threadRootOf(ctx, target);
      return this.bridgeRetraction(event.actorId, root.id, event.diasporaGuid, 'Like');
    }
    const key = `${event.actorId}:${event.postId}`;
    // Newer cores may carry the guid in the event itself.
    const guid =
      (event as { diasporaGuid?: string | null }).diasporaGuid ?? this.likeGuids.get(key);
    this.likeGuids.delete(key);
    const target = await postById(ctx, event.postId);
    if (!guid || !target) return;
    const retraction: Retraction = {
      type: 'Retraction',
      author: diasporaIdOf(ctx, author),
      targetGuid: guid,
      targetType: 'Like',
    };
    await sendInteraction(this.bridge, retraction, author, await threadRootOf(ctx, target));
  }

  private async followRequested(actorId: string, targetActorId: string) {
    const target = await actorById(this.ctx, targetActorId);
    if (!deliversViaDiaspora(target)) return;
    const sent = await this.sendContact(actorId, targetActorId, { following: true, sharing: true });
    // diaspora* has no accept step: the follow is effective as soon as it is sent.
    if (sent) {
      this.contactsSent.add(`${actorId}:${targetActorId}`);
      await acceptFollowRequest(this.ctx, targetActorId, actorId).catch(() => undefined);
    }
  }

  /**
   * A local person now follows a diaspora* person. Sends the Contact unless it was already sent
   * for the request (cores that create diaspora* follows directly emit only this event).
   */
  private async followCreated(actorId: string, targetActorId: string) {
    await this.sendRecentPosts(actorId, targetActorId);
    const key = `${actorId}:${targetActorId}`;
    if (this.contactsSent.delete(key)) return;
    await this.sendContact(actorId, targetActorId, { following: true, sharing: true });
  }

  /** The latest public posts of a local account, sent to the pod of a new diaspora* follower. */
  private async sendRecentPosts(followerId: string, localId: string) {
    const ctx = this.ctx;
    const [follower, local] = await Promise.all([
      actorById(ctx, followerId),
      this.localActor(localId),
    ]);
    const url = deliversViaDiaspora(follower) ? publicReceiveUrl(follower) : null;
    const signer = local ? await signerFor(ctx, local) : null;
    if (!follower || !local || !url || !signer) return;
    const recipients = { publicUrls: new Map([[url, new Set([follower.id])]]), privateActors: [] };
    for (const post of await postsForNewFollower(ctx, 'diaspora', follower.id, local.id)) {
      if (!post.diasporaGuid) continue;
      const entity = await statusMessageFor(ctx, post, local);
      await sendToRecipients(this.bridge, serializeEntity(entity), signer, recipients);
    }
  }

  private async sendContact(
    actorId: string,
    targetActorId: string,
    flags: Pick<Contact, 'following' | 'sharing' | 'blocking'>,
  ): Promise<boolean> {
    const ctx = this.ctx;
    const local = await this.localActor(actorId);
    const target = await actorById(ctx, targetActorId);
    const signer = local ? await signerFor(ctx, local) : null;
    if (!local || !signer || !deliversViaDiaspora(target)) return false;
    const contact: Contact = {
      type: 'Contact',
      author: signer.diasporaId,
      recipient: diasporaIdOf(ctx, target),
      ...flags,
    };
    const recipients = emptyRecipients();
    recipients.privateActors.push(target);
    await sendToRecipients(this.bridge, serializeEntity(contact), signer, recipients);
    return true;
  }

  /** A local vote: a signed PollParticipation, routed like a comment on the poll's post. */
  private async pollVoted(event: Extract<DomainEvent, { type: 'poll.voted' }>) {
    const ctx = this.ctx;
    const voter = await this.localActor(event.actorId);
    const post = await postById(ctx, event.postId);
    const [poll] = await ctx.db
      .select()
      .from(schema.polls)
      .where(eq(schema.polls.id, event.pollId));
    if (!voter || !post || !poll?.diasporaGuid || poll.multiple) return;
    const [vote] = await ctx.db
      .select()
      .from(schema.pollVotes)
      .where(inArray(schema.pollVotes.id, event.voteIds));
    const answer = vote ? answerGuids(poll, post.local)[vote.choice] : null;
    if (!vote?.diasporaGuid || !answer) return;
    const participation: PollParticipation = {
      type: 'PollParticipation',
      author: diasporaIdOf(ctx, voter),
      guid: vote.diasporaGuid,
      parentGuid: poll.diasporaGuid,
      pollAnswerGuid: answer,
    };
    await sendInteraction(this.bridge, participation, voter, await threadRootOf(ctx, post));
  }

  /**
   * AccountMigration to the diaspora* contacts of a local account that moved. As in diaspora*,
   * the old identity is the author (and signs the envelope) and the new identity signs the
   * migration, so both keys are needed: this works when the new account is also local.
   * For a move to another server, that server has to announce it (see the package notes).
   */
  private async accountMoved(actorId: string, targetActorId: string) {
    const ctx = this.ctx;
    const origin = await actorById(ctx, actorId);
    const target = await actorById(ctx, targetActorId);
    if (!origin || !target || origin.domain !== null) return;
    const oldSigner = await signerFor(ctx, origin);
    const newSigner = await signerFor(ctx, target);
    if (!oldSigner) return;
    if (!newSigner) {
      console.warn(
        `diaspora: ${oldSigner.diasporaId} moved to a remote account; AccountMigration needs the new key and must come from the new server`,
      );
      return;
    }
    const migration = signAccountMigration(
      {
        type: 'AccountMigration',
        author: oldSigner.diasporaId,
        profile: profileFor(ctx, target, newSigner.diasporaId),
      },
      newSigner.privateKey,
    );
    const recipients = await recipientsFor(
      ctx,
      { id: origin.id, actorId: origin.id, visibility: 'public', inReplyToActorId: null },
      { explicitIds: await followedIds(ctx, origin.id) },
    );
    await sendToRecipients(this.bridge, serializeEntity(migration), oldSigner, recipients);
  }

  /** AccountDeletion to every diaspora* contact: followers and followed people. */
  private async accountDeleted(actorId: string) {
    const ctx = this.ctx;
    // The actor is suspended by now, but its keys stay available until the purge.
    const actor = await actorById(ctx, actorId);
    const signer = actor && actor.domain === null ? await signerFor(ctx, actor) : null;
    if (!signer) return;
    const recipients = await recipientsFor(
      ctx,
      { id: actorId, actorId, visibility: 'public', inReplyToActorId: null },
      { explicitIds: await followedIds(ctx, actorId) },
    );
    const deletion: AccountDeletion = { type: 'AccountDeletion', author: signer.diasporaId };
    await sendToRecipients(this.bridge, serializeEntity(deletion), signer, recipients);
  }

  private async profileUpdated(actorId: string) {
    const ctx = this.ctx;
    const actor = await this.localActor(actorId);
    const signer = actor ? await signerFor(ctx, actor) : null;
    if (!actor || !signer) return;
    const profile = profileFor(ctx, actor, signer.diasporaId);
    const recipients = await recipientsFor(
      ctx,
      { id: actor.id, actorId: actor.id, visibility: 'public', inReplyToActorId: null },
      { explicitIds: [] },
    );
    await sendToRecipients(this.bridge, serializeEntity(profile), signer, recipients);
  }
}
