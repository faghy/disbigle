// Applying verified incoming diaspora* entities to the core.
import {
  block,
  type CoreContext,
  DomainError,
  deletePost,
  deleteRemoteActor,
  extractTags,
  findActorByHandle,
  findPostByGuid,
  follow,
  ingestRemoteAnnounce,
  ingestRemotePost,
  like,
  type RemoteAttachment,
  renderMarkdown,
  unfollow,
  unlike,
  upsertRemoteActor,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import {
  type Comment,
  type Contact,
  type Conversation,
  type Entity,
  type Like,
  type Message,
  type Profile,
  parseDiasporaId,
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
import { recipientsFor, sendToRecipients, signerFor } from './outgoing.ts';
import { diasporaMentionsToMarkdown, mimeTypeFromName, parseDiasporaMentions } from './text.ts';

const { postAudiences, likes } = schema;

/** Finds a known actor (local or already stored remote) by diaspora* ID, without network access. */
async function knownActor(ctx: CoreContext, id: string): Promise<ActorRow | null> {
  try {
    const parsed = parseDiasporaId(id);
    const local = parsed.host === ctx.config.LOCAL_DOMAIN.toLowerCase();
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
  sendToRecipients(bridge, serializeEntity(entity), signer, recipients);
}

async function statusMessage(
  bridge: DiasporaBridge,
  entity: StatusMessage,
  author: ActorRow,
  recipient: ActorRow | undefined,
) {
  const ctx = bridge.ctx;
  let text = entity.text ?? '';
  if (entity.poll) {
    text += `\n\n**${entity.poll.question}**\n\n${entity.poll.pollAnswers.map((a) => `- ${a.answer}`).join('\n')}`;
  }
  const rendered = await renderDiasporaText(ctx, text);
  const attachments: RemoteAttachment[] = (entity.photos ?? []).map((photo) => ({
    url: `${photo.remotePhotoPath}${photo.remotePhotoName}`,
    mimeType: mimeTypeFromName(photo.remotePhotoName),
    ...(photo.text ? { description: photo.text } : {}),
    width: photo.width ?? null,
    height: photo.height ?? null,
  }));
  const audience = [...rendered.mentionIds, ...(recipient ? [recipient.id] : [])];
  const id = await ingestRemotePost(ctx, {
    authorActorId: author.id,
    diasporaGuid: entity.guid,
    contentHtml: rendered.html,
    visibility: entity.public ? 'public' : 'limited',
    audienceActorIds: audience,
    mentionActorIds: rendered.mentionIds,
    tags: rendered.tags,
    attachments,
    ...(entity.createdAt ? { publishedAt: entity.createdAt } : {}),
  });
  // Private posts arrive once per recipient: later copies extend the audience.
  if (id && !entity.public && recipient) await addAudience(ctx, id, [recipient.id]);
}

async function comment(
  bridge: DiasporaBridge,
  entity: Comment | Message,
  author: ActorRow,
  parent: PostRow,
  recipient: ActorRow | undefined,
) {
  const ctx = bridge.ctx;
  const rendered = await renderDiasporaText(ctx, entity.text);
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
}

async function likeEntity(bridge: DiasporaBridge, entity: Like, author: ActorRow) {
  const target = await findPostByGuid(bridge.ctx, entity.parentGuid);
  if (!target) return;
  if (entity.positive) {
    await like(bridge.ctx, author.id, target.id, { diasporaGuid: entity.guid }).catch(
      ignoreDomainErrors,
    );
  }
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
  if (root) await relay(bridge, entity, root, post.actorId);
}

async function contact(bridge: DiasporaBridge, entity: Contact, author: ActorRow) {
  const ctx = bridge.ctx;
  const target = await knownActor(ctx, entity.recipient);
  if (!target || target.domain !== null) return;
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
  for (const message of rest) await comment(bridge, message, author, root, recipient);
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
      await comment(bridge, entity, author, parent, recipient);
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
      if (parent) await comment(bridge, entity, author, parent, recipient);
      return;
    }
    default:
      // Participation, PollParticipation, EventParticipation, AccountMigration, Photo, Event:
      // nothing to store yet.
      return;
  }
}
