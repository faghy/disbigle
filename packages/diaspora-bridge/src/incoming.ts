// Applying verified incoming diaspora* entities to the core.
import { isLocalDomain } from '@disbigle/config';
import {
  block,
  type CoreContext,
  canView,
  DomainError,
  deletePost,
  deleteRemoteActor,
  extractTags,
  findActorByHandle,
  findPostByGuid,
  follow,
  groupOfActor,
  ingestRemoteAnnounce,
  ingestRemotePost,
  isGroupMember,
  like,
  type RemoteAttachment,
  remoteJoinGroup,
  remoteLeaveGroup,
  renderMarkdown,
  unfollow,
  unlike,
  updateRemotePost,
  upsertRemoteActor,
  votePoll,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import {
  type AccountMigration,
  accountMigrationOldIdentity,
  type Comment,
  type Contact,
  type Conversation,
  type Entity,
  type Like,
  type Message,
  type PollParticipation,
  type Profile,
  parseDiasporaId,
  parseEntity,
  type ReceivedMessage,
  type Reshare,
  type Retraction,
  type StatusMessage,
  serializeEntity,
} from '@disbigle/diaspora';
import { eq } from 'drizzle-orm';
import {
  type ActorRow,
  actorById,
  diasporaIdOf,
  isPublicVisibility,
  type PostRow,
  postById,
  threadRootOf,
} from './actors.ts';
import type { DiasporaBridge } from './bridge.ts';
import { moveVerified } from './moves.ts';
import { recipientsFor, sendToRecipients, signerFor } from './outgoing.ts';
import { answerGuids, pollByGuid, pollOfPost, storeAnswerGuids } from './polls.ts';
import { diasporaMentionsToMarkdown, mimeTypeFromName, parseDiasporaMentions } from './text.ts';

const { postAudiences, likes } = schema;

/** Finds a known actor (local or already stored remote) by diaspora* ID, without network access. */
export async function findActorByDiasporaId(ctx: CoreContext, id: string) {
  return knownActor(ctx, id);
}

async function knownActor(ctx: CoreContext, id: string): Promise<ActorRow | null> {
  try {
    const parsed = parseDiasporaId(id);
    const local = isLocalDomain(ctx.config, parsed.host);
    return await findActorByHandle(ctx, parsed.username, local ? null : parsed.host);
  } catch {
    return null;
  }
}

export interface RenderedText {
  html: string;
  mentionIds: string[];
  tags: string[];
}

/** Renders diaspora* markdown (with `@{Name; id}` mentions) to sanitised HTML. */
export async function renderDiasporaText(ctx: CoreContext, text: string): Promise<RenderedText> {
  const base = ctx.config.PUBLIC_URL;
  const known = new Map<string, ActorRow>();
  for (const mention of parseDiasporaMentions(text)) {
    const actor = await knownActor(ctx, mention.id);
    if (actor && !actor.suspendedAt) known.set(mention.id, actor);
  }
  const markdown = diasporaMentionsToMarkdown(text, (id) => {
    const actor = known.get(id);
    if (!actor) return null;
    return actor.apUrl ?? (actor.domain === null ? `${base}/@${actor.username}` : null);
  });
  const html = renderMarkdown(markdown, {
    resolveMention: () => null,
    tagUrl: (tag) => `${base}/tags/${encodeURIComponent(tag)}`,
    localOrigin: new URL(base).origin,
  } as Parameters<typeof renderMarkdown>[1]);
  return { html, mentionIds: [...known.values()].map((a) => a.id), tags: extractTags(text) };
}

async function audienceOf(ctx: CoreContext, postId: string): Promise<string[]> {
  const rows = await ctx.db
    .select({ id: postAudiences.actorId })
    .from(postAudiences)
    .where(eq(postAudiences.postId, postId));
  return rows.map((r) => r.id);
}

async function addAudience(ctx: CoreContext, postId: string, actorIds: string[]): Promise<void> {
  if (actorIds.length === 0) return;
  await ctx.db
    .insert(postAudiences)
    .values(actorIds.map((actorId) => ({ postId, actorId })))
    .onConflictDoNothing();
}

/** Visibility and audience of a reply: it stays inside the conversation of its parent. */
async function replyAudience(ctx: CoreContext, parent: PostRow, extra: string[]) {
  if (isPublicVisibility(parent.visibility))
    return { visibility: parent.visibility, audience: extra };
  return {
    visibility: parent.visibility,
    audience: [...(await audienceOf(ctx, parent.id)), parent.actorId, ...extra],
  };
}

const ignoreDomainErrors = (error: unknown) => {
  if (!(error instanceof DomainError)) throw error;
};

/** Keeps a received relayable exactly as signed (order, unknown elements, signature). */
async function storeRelayable(
  bridge: DiasporaBridge,
  entity: Comment | Like | PollParticipation,
  links: { postId?: string | null; likeId?: string | null },
): Promise<void> {
  await bridge.relayables.save({
    guid: entity.guid,
    entityType: entity.type,
    parentGuid: entity.parentGuid,
    author: entity.author,
    xml: serializeEntity(entity),
    ...links,
  });
}

/**
 * Relays a stored relayable again to everyone currently in its thread (e.g. after a failure,
 * or when the audience grew). Only possible when the thread root is local.
 */
export async function relayStored(bridge: DiasporaBridge, guid: string): Promise<boolean> {
  const record = await bridge.relayables.get(guid);
  if (!record) return false;
  const target = await findPostByGuid(bridge.ctx, record.parentGuid);
  if (!target) return false;
  const root = await threadRootOf(bridge.ctx, target);
  if (!root.local) return false;
  const author = await findActorByDiasporaId(bridge.ctx, record.author);
  await relay(bridge, parseEntity(record.xml), root, author?.id ?? '');
  return true;
}

/** Re-sends a relayable (or its retraction) received for a local thread to everyone in it. */
async function relay(
  bridge: DiasporaBridge,
  entity: Entity,
  root: PostRow,
  authorId: string,
): Promise<void> {
  if (!root.local) return;
  const rootAuthor = await actorById(bridge.ctx, root.actorId);
  const signer = rootAuthor ? await signerFor(bridge.ctx, rootAuthor) : null;
  if (!signer) return;
  const recipients = await recipientsFor(bridge.ctx, root, { exclude: authorId });
  // The entity is serialised exactly as received: same order, unknown elements and signature.
  await sendToRecipients(bridge, serializeEntity(entity), signer, recipients);
}

/**
 * A public group of ours named in a public post by one of its members: diaspora* has no groups,
 * so mentioning one is how a post is written in it.
 */
async function memberGroupNamed(
  ctx: DiasporaBridge['ctx'],
  authorId: string,
  mentionIds: string[],
): Promise<string | null> {
  for (const id of mentionIds) {
    const record = await groupOfActor(ctx, id);
    if (record?.group.privacy === 'public' && (await isGroupMember(ctx, record.group.id, authorId)))
      return id;
  }
  return null;
}

async function statusMessage(
  bridge: DiasporaBridge,
  entity: StatusMessage,
  author: ActorRow,
  recipient: ActorRow | undefined,
) {
  const ctx = bridge.ctx;
  const text = entity.text ?? '';
  const rendered = await renderDiasporaText(ctx, text);
  // A post we already have, sent again with `edited_at` (Hubzilla, Friendica and Disbigle send
  // edits so): the newer text replaces ours. diaspora* itself never edits.
  const known = entity.editedAt ? await findPostByGuid(ctx, entity.guid) : null;
  if (known && entity.editedAt) {
    if (known.actorId !== author.id) return;
    await updateRemotePost(
      ctx,
      author.id,
      { diasporaGuid: entity.guid },
      { contentHtml: rendered.html, editedAt: entity.editedAt },
    );
    if (!entity.public && recipient) await addAudience(ctx, known.id, [recipient.id]);
    return;
  }
  const attachments: RemoteAttachment[] = (entity.photos ?? []).map((photo) => ({
    url: `${photo.remotePhotoPath}${photo.remotePhotoName}`,
    mimeType: mimeTypeFromName(photo.remotePhotoName),
    ...(photo.text ? { description: photo.text } : {}),
    width: photo.width ?? null,
    height: photo.height ?? null,
  }));
  const audience = [...rendered.mentionIds, ...(recipient ? [recipient.id] : [])];
  const groupActorId = entity.public
    ? await memberGroupNamed(ctx, author.id, rendered.mentionIds)
    : null;
  const id = await ingestRemotePost(ctx, {
    authorActorId: author.id,
    diasporaGuid: entity.guid,
    contentHtml: rendered.html,
    visibility: entity.public ? 'public' : 'limited',
    ...(groupActorId ? { groupActorId } : {}),
    audienceActorIds: audience,
    mentionActorIds: rendered.mentionIds,
    tags: rendered.tags,
    attachments,
    ...(entity.poll
      ? {
          // diaspora* polls are single choice and never close.
          poll: {
            options: entity.poll.pollAnswers.map((a) => ({ title: a.answer, votesCount: 0 })),
            multiple: false,
            expiresAt: null,
            diasporaGuid: entity.poll.guid,
          },
        }
      : {}),
    ...(entity.createdAt ? { publishedAt: entity.createdAt } : {}),
  });
  if (id && entity.poll) {
    const poll = await pollOfPost(ctx, id);
    if (poll && poll.options.length === entity.poll.pollAnswers.length) {
      await storeAnswerGuids(
        ctx,
        poll.id,
        entity.poll.pollAnswers.map((a) => a.guid),
      );
    }
  }
  // Private posts arrive once per recipient: later copies extend the audience.
  if (id && !entity.public && recipient) await addAudience(ctx, id, [recipient.id]);
}

/** Stores a comment or message; false when it is an older version of one already edited here. */
async function comment(
  bridge: DiasporaBridge,
  entity: Comment | Message,
  author: ActorRow,
  parent: PostRow,
  recipient: ActorRow | undefined,
  sender: string,
): Promise<boolean> {
  const ctx = bridge.ctx;
  // Only people who can see a post may comment on it (knowing a private post's guid is not
  // enough), unless the thread's author relays the comment: on diaspora* they decide who takes
  // part, and we only know who the post was shared with here.
  const root = await threadRootOf(ctx, parent);
  const rootAuthor = await actorById(ctx, root.actorId);
  const relayedByOwner = !!rootAuthor && diasporaIdOf(ctx, rootAuthor) === sender.toLowerCase();
  if (!relayedByOwner && !(await canView(ctx, author.id, parent.id))) {
    throw new DomainError('forbidden', 'Comment on a post the author cannot see');
  }
  const rendered = await renderDiasporaText(ctx, entity.text);
  const editedAt = 'editedAt' in entity ? entity.editedAt : undefined;
  const known = await findPostByGuid(ctx, entity.guid);
  if (known?.editedAt || (known && editedAt)) {
    if (known.actorId !== author.id || !editedAt) return false;
    return updateRemotePost(
      ctx,
      author.id,
      { diasporaGuid: entity.guid },
      { contentHtml: rendered.html, editedAt },
    );
  }
  const { visibility, audience } = await replyAudience(ctx, parent, [
    ...rendered.mentionIds,
    ...(recipient ? [recipient.id] : []),
  ]);
  const id = await ingestRemotePost(ctx, {
    authorActorId: author.id,
    diasporaGuid: entity.guid,
    contentHtml: rendered.html,
    visibility,
    audienceActorIds: audience,
    mentionActorIds: rendered.mentionIds,
    tags: rendered.tags,
    inReplyTo: { postId: parent.id },
    ...(entity.createdAt ? { publishedAt: entity.createdAt } : {}),
  });
  if (id && recipient && !isPublicVisibility(visibility))
    await addAudience(ctx, id, [recipient.id]);
  return true;
}

async function likeEntity(bridge: DiasporaBridge, entity: Like, author: ActorRow) {
  const target = await findPostByGuid(bridge.ctx, entity.parentGuid);
  if (!target) return;
  if (entity.positive) {
    await like(bridge.ctx, author.id, target.id, { diasporaGuid: entity.guid }).catch(
      ignoreDomainErrors,
    );
  }
  const [row] = await bridge.ctx.db
    .select({ id: likes.id })
    .from(likes)
    .where(eq(likes.diasporaGuid, entity.guid));
  await storeRelayable(bridge, entity, { likeId: row?.id ?? null });
  await relay(bridge, entity, await threadRootOf(bridge.ctx, target), author.id);
}

async function reshare(bridge: DiasporaBridge, entity: Reshare, author: ActorRow) {
  if (!entity.rootGuid) return;
  const target = await findPostByGuid(bridge.ctx, entity.rootGuid);
  if (!target) return;
  await ingestRemoteAnnounce(bridge.ctx, author.id, target.id, { diasporaGuid: entity.guid });
}

async function retraction(bridge: DiasporaBridge, entity: Retraction, sender: string) {
  const ctx = bridge.ctx;
  if (entity.targetType === 'Like') {
    const [row] = await ctx.db
      .select()
      .from(likes)
      .where(eq(likes.diasporaGuid, entity.targetGuid));
    if (!row) return;
    const post = await postById(ctx, row.postId);
    await unlike(ctx, row.actorId, row.postId);
    await bridge.relayables.delete(entity.targetGuid);
    if (post) await relay(bridge, entity, await threadRootOf(ctx, post), row.actorId);
    return;
  }
  const post = await findPostByGuid(ctx, entity.targetGuid);
  if (!post || post.local) return;
  const root = post.inReplyToId ? await threadRootOf(ctx, post) : null;
  // The sender was checked by the protocol layer: the author, or the root author for comments.
  const postAuthor = await actorById(ctx, post.actorId);
  const asModerator = !postAuthor || diasporaIdOf(ctx, postAuthor) !== sender;
  await deletePost(ctx, post.actorId, post.id, { asModerator }).catch(ignoreDomainErrors);
  await bridge.relayables.delete(entity.targetGuid);
  if (root) await relay(bridge, entity, root, post.actorId);
}

async function contact(bridge: DiasporaBridge, entity: Contact, author: ActorRow) {
  const ctx = bridge.ctx;
  const target = await knownActor(ctx, entity.recipient);
  if (!target || target.domain !== null) return;
  if (target.isGroup) {
    // Adding a public group to an aspect is joining it; removing it, leaving.
    if (entity.sharing && !entity.blocking) await remoteJoinGroup(ctx, target.id, author.id, null);
    else await remoteLeaveGroup(ctx, target.id, author.id);
    return;
  }
  if (entity.blocking) {
    await block(ctx, author.id, target.id).catch(ignoreDomainErrors);
  } else if (entity.sharing) {
    // "sharing" means the author added the recipient to an aspect: they follow them.
    await follow(ctx, author.id, target.id).catch(ignoreDomainErrors);
  } else {
    await unfollow(ctx, author.id, target.id);
  }
}

async function profile(bridge: DiasporaBridge, entity: Profile, author: ActorRow) {
  const ctx = bridge.ctx;
  if (author.domain === null) return;
  const name =
    entity.fullName ?? [entity.firstName, entity.lastName].filter(Boolean).join(' ').trim();
  await upsertRemoteActor(ctx, {
    username: author.username,
    domain: author.domain,
    protocol: 'diaspora',
    ...(name ? { displayName: name } : {}),
    ...(entity.bio !== undefined
      ? { summaryHtml: (await renderDiasporaText(ctx, entity.bio)).html }
      : {}),
    ...(entity.imageUrl
      ? { avatarUrl: new URL(entity.imageUrl, `https://${author.domain}/`).href }
      : {}),
    ...(entity.searchable !== undefined ? { discoverable: entity.searchable } : {}),
  });
}

async function conversation(
  bridge: DiasporaBridge,
  entity: Conversation,
  author: ActorRow,
  recipient: ActorRow | undefined,
) {
  const ctx = bridge.ctx;
  const participants: string[] = [];
  for (const id of entity.participants.split(';')) {
    const actor = (await knownActor(ctx, id.trim())) ?? (await bridge.resolvePerson(id.trim()));
    if (actor && actor.id !== author.id) participants.push(actor.id);
  }
  if (recipient) participants.push(recipient.id);
  const [first, ...rest] = entity.messages ?? [];
  const rendered = await renderDiasporaText(
    ctx,
    `**${entity.subject}**${first ? `\n\n${first.text}` : ''}`,
  );
  const id = await ingestRemotePost(ctx, {
    authorActorId: author.id,
    diasporaGuid: entity.guid,
    contentHtml: rendered.html,
    visibility: 'direct',
    audienceActorIds: [...participants, ...rendered.mentionIds],
    mentionActorIds: rendered.mentionIds,
    tags: rendered.tags,
    ...(entity.createdAt ? { publishedAt: entity.createdAt } : {}),
  });
  if (!id) return;
  await addAudience(ctx, id, participants);
  const root = await postById(ctx, id);
  if (!root) return;
  // The Conversation's author sent these messages with it.
  const sender = diasporaIdOf(ctx, author);
  for (const message of rest) await comment(bridge, message, author, root, recipient, sender);
}

/** A vote on a poll: counted, kept as signed, and relayed when the poll is ours. */
async function pollParticipation(
  bridge: DiasporaBridge,
  entity: PollParticipation,
  author: ActorRow,
) {
  const ctx = bridge.ctx;
  const poll = await pollByGuid(ctx, entity.parentGuid);
  const post = poll ? await postById(ctx, poll.postId) : null;
  if (!poll || !post) return;
  const choice = answerGuids(poll, post.local).indexOf(entity.pollAnswerGuid);
  if (choice < 0) return;
  // Local polls count the vote for real; remote ones keep a local tally of relayed votes.
  await votePoll(ctx, author.id, poll.id, [choice], { diasporaGuid: entity.guid }).catch(
    ignoreDomainErrors,
  );
  await storeRelayable(bridge, entity, {});
  await relay(bridge, entity, await threadRootOf(ctx, post), author.id);
}

/**
 * A person moved to a new identity; the protocol layer verified the migration signature.
 * Local followers of the old identity now follow the new one.
 */
async function accountMigration(bridge: DiasporaBridge, entity: AccountMigration) {
  const ctx = bridge.ctx;
  const oldId = accountMigrationOldIdentity(entity);
  if (!oldId) return;
  const origin = await findActorByDiasporaId(ctx, oldId);
  const target = await bridge.resolvePerson(entity.profile.author);
  if (!origin || !target || origin.id === target.id || origin.domain === null) return;
  if (target.domain !== null) await profile(bridge, entity.profile, target);
  await moveVerified(ctx, origin.id, target.id);
}

/** Applies a verified message to the core. `recipient` is set for private deliveries. */
export async function applyEntity(
  bridge: DiasporaBridge,
  message: ReceivedMessage,
  recipient?: ActorRow,
): Promise<void> {
  const { entity, sender } = message;
  const ctx = bridge.ctx;
  if (!('author' in entity)) return;
  const author = await bridge.resolvePerson(entity.author);
  // Entities authored here (e.g. our own comment relayed back) are already applied.
  if (!author || author.domain === null) return;

  switch (entity.type) {
    case 'StatusMessage':
      return statusMessage(bridge, entity, author, recipient);
    case 'Comment': {
      const parent = await findPostByGuid(ctx, entity.parentGuid);
      if (!parent) return;
      // A stale copy must not replace the stored, newer one that later relays send.
      if (!(await comment(bridge, entity, author, parent, recipient, sender))) return;
      const stored = await findPostByGuid(ctx, entity.guid);
      await storeRelayable(bridge, entity, { postId: stored?.id ?? null });
      // Waiting for a group's moderators: relayed once approved.
      if (stored?.pendingApproval) return;
      return relay(bridge, entity, await threadRootOf(ctx, parent), author.id);
    }
    case 'Like':
      return likeEntity(bridge, entity, author);
    case 'Reshare':
      return reshare(bridge, entity, author);
    case 'Retraction':
      return retraction(bridge, entity, sender);
    case 'Contact':
      return contact(bridge, entity, author);
    case 'Profile':
      return profile(bridge, entity, author);
    case 'AccountDeletion':
      return deleteRemoteActor(ctx, author.id);
    case 'Conversation':
      return conversation(bridge, entity, author, recipient);
    case 'Message': {
      const parent = await findPostByGuid(ctx, entity.conversationGuid);
      if (parent) await comment(bridge, entity, author, parent, recipient, sender);
      return;
    }
    case 'AccountMigration':
      return accountMigration(bridge, entity);
    case 'PollParticipation':
      return pollParticipation(bridge, entity, author);
    default:
      // Participation, EventParticipation, Photo, Event:
      // nothing to store yet.
      return;
  }
}
