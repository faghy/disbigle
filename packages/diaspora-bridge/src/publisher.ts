// Turns domain events into outgoing diaspora* deliveries, like ActivityPubPublisher does for
// ActivityPub. Only people whose preferred protocol is diaspora* are addressed.
import { acceptFollowRequest, type DomainEvent, type EventBus } from '@disbigle/core';
import { schema } from '@disbigle/db';
import {
  type AccountDeletion,
  type Contact,
  type Profile,
  type Retraction,
  serializeEntity,
} from '@disbigle/diaspora';
import { eq } from 'drizzle-orm';
import {
  type ActorRow,
  actorById,
  deliversViaDiaspora,
  diasporaIdOf,
  postById,
  threadRootOf,
} from './actors.ts';
import type { DiasporaBridge } from './bridge.ts';
import {
  commentFor,
  emptyRecipients,
  likeFor,
  recipientsFor,
  reshareFor,
  sendInteraction,
  sendToRecipients,
  signerFor,
  statusMessageFor,
} from './outgoing.ts';
import { htmlToText } from './text.ts';

async function followedIds(ctx: DiasporaBridge['ctx'], actorId: string): Promise<string[]> {
  const rows = await ctx.db
    .select({ id: schema.follows.targetActorId })
    .from(schema.follows)
    .where(eq(schema.follows.actorId, actorId));
  return rows.map((r) => r.id);
}

/**
 * diaspora* event publisher. `publish` only queues work on the bridge queue, so requests never
 * wait for remote servers.
 *
 * Two facts are not carried by the current domain events and are remembered in memory
 * (lost on restart): the thread root of a deleted reply, and the guid of a removed like.
 */
export class DiasporaPublisher implements EventBus {
  private readonly replyRoots = new Map<string, string>();
  private readonly likeGuids = new Map<string, string>();
  private readonly contactsSent = new Set<string>();

  constructor(private readonly bridge: DiasporaBridge) {}

  async publish(event: DomainEvent): Promise<void> {
    this.bridge.queue.push(() => this.handle(event));
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
      sendToRecipients(this.bridge, serializeEntity(entity), signer, recipients);
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
    sendToRecipients(this.bridge, serializeEntity(entity), signer, await recipientsFor(ctx, post));
  }

  private async postDeleted(event: Extract<DomainEvent, { type: 'post.deleted' }>) {
    const ctx = this.ctx;
    if (!event.diasporaGuid) return;
    const author = await this.localActor(event.actorId);
    const signer = author ? await signerFor(ctx, author) : null;
    if (!author || !signer) return;
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
    sendToRecipients(this.bridge, serializeEntity(retraction), signer, recipients);
  }

  private async likeCreated(event: Extract<DomainEvent, { type: 'like.created' }>) {
    const ctx = this.ctx;
    const author = await this.localActor(event.actorId);
    if (!author) return;
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
    if (!author) return;
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
    const key = `${actorId}:${targetActorId}`;
    if (this.contactsSent.delete(key)) return;
    await this.sendContact(actorId, targetActorId, { following: true, sharing: true });
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
    sendToRecipients(this.bridge, serializeEntity(contact), signer, recipients);
    return true;
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
    sendToRecipients(this.bridge, serializeEntity(deletion), signer, recipients);
  }

  private async profileUpdated(actorId: string) {
    const ctx = this.ctx;
    const actor = await this.localActor(actorId);
    const signer = actor ? await signerFor(ctx, actor) : null;
    if (!actor || !signer) return;
    const name = actor.displayName || actor.username;
    const profile: Profile = {
      type: 'Profile',
      author: signer.diasporaId,
      fullName: name.slice(0, 70).replace(/;/g, ','),
      firstName: name.slice(0, 32).replace(/;/g, ','),
      ...(actor.avatarUrl
        ? {
            imageUrl: new URL(actor.avatarUrl, ctx.config.PUBLIC_URL).href,
            imageUrlMedium: new URL(actor.avatarUrl, ctx.config.PUBLIC_URL).href,
            imageUrlSmall: new URL(actor.avatarUrl, ctx.config.PUBLIC_URL).href,
          }
        : {}),
      ...(actor.summary ? { bio: htmlToText(actor.summary) } : {}),
      searchable: actor.discoverable,
      public: true,
    };
    const recipients = await recipientsFor(
      ctx,
      { id: actor.id, actorId: actor.id, visibility: 'public', inReplyToActorId: null },
      { explicitIds: [] },
    );
    sendToRecipients(this.bridge, serializeEntity(profile), signer, recipients);
  }
}
