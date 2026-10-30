// Building diaspora* entities from core rows, computing recipients and sending envelopes.
import { isLocalDomain } from '@disbigle/config';
import { type CoreContext, mediaUrl } from '@disbigle/core';
import { schema } from '@disbigle/db';
import {
  type Comment,
  createMagicEnvelope,
  ENCRYPTED_ENVELOPE_CONTENT_TYPE,
  type Entity,
  encryptMagicEnvelope,
  isRelayable,
  type Like,
  MAGIC_ENV_CONTENT_TYPE,
  type Photo,
  type Reshare,
  type StatusMessage,
  serializeEntity,
  signRelayable,
} from '@disbigle/diaspora';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import {
  type ActorRow,
  actorById,
  deliversViaDiaspora,
  diasporaIdOf,
  isPublicVisibility,
  localPrivateKey,
  type PostRow,
  publicGroupOf,
  publicReceiveUrl,
} from './actors.ts';
import type { DiasporaBridge } from './bridge.ts';
import { diasporaPollOf, pollOfPost } from './polls.ts';
import { htmlToText, mentionsToDiaspora } from './text.ts';

const { actors, follows, postAudiences, mentions, mediaAttachments, groups, groupMembers } = schema;

/** Where an entity must go: public endpoints (one per server) and people reached privately. */
export interface Recipients {
  /** `/receive/public` URL → ids of the people reached through it. */
  publicUrls: Map<string, Set<string>>;
  /** People who get an encrypted copy at their private receive URL. */
  privateActors: ActorRow[];
}

export const emptyRecipients = (): Recipients => ({ publicUrls: new Map(), privateActors: [] });

function addPublic(recipients: Recipients, actor: ActorRow): void {
  const url = publicReceiveUrl(actor);
  if (!url) return;
  const ids = recipients.publicUrls.get(url) ?? new Set<string>();
  ids.add(actor.id);
  recipients.publicUrls.set(url, ids);
}

function addPrivate(recipients: Recipients, actor: ActorRow): void {
  if (!recipients.privateActors.some((a) => a.id === actor.id))
    recipients.privateActors.push(actor);
}

/** Remote followers of `actorId` that are reached over diaspora*. */
export async function diasporaFollowers(ctx: CoreContext, actorId: string): Promise<ActorRow[]> {
  const rows = await ctx.db
    .select({ actor: actors })
    .from(follows)
    .innerJoin(actors, eq(actors.id, follows.actorId))
    .where(eq(follows.targetActorId, actorId));
  return rows.map((r) => r.actor).filter(deliversViaDiaspora);
}

async function actorsByIds(ctx: CoreContext, ids: string[]): Promise<ActorRow[]> {
  if (ids.length === 0) return [];
  return ctx.db
    .select()
    .from(actors)
    .where(inArray(actors.id, [...new Set(ids)]));
}

/** Explicit recipients of a post: audience and mentions. */
async function explicitRecipientIds(ctx: CoreContext, postId: string): Promise<string[]> {
  const [audience, mentioned] = await Promise.all([
    ctx.db
      .select({ id: postAudiences.actorId })
      .from(postAudiences)
      .where(eq(postAudiences.postId, postId)),
    ctx.db.select({ id: mentions.actorId }).from(mentions).where(eq(mentions.postId, postId)),
  ]);
  return [...audience, ...mentioned].map((r) => r.id);
}

/**
 * Who receives a post (or an interaction relayed on it) over diaspora*:
 * public posts go once to each server of the followers, audience and parent author;
 * followers-only posts go privately to each follower and recipient;
 * limited and direct posts go privately to their audience only.
 */
export async function recipientsFor(
  ctx: CoreContext,
  post: Pick<PostRow, 'id' | 'actorId' | 'visibility' | 'inReplyToActorId'> &
    Partial<Pick<PostRow, 'groupId'>>,
  options: { exclude?: string; explicitIds?: string[] } = {},
): Promise<Recipients> {
  const recipients = emptyRecipients();
  if (post.groupId) return groupRecipients(ctx, post.groupId, post, options);
  const explicit = await actorsByIds(
    ctx,
    options.explicitIds ?? [
      ...(await explicitRecipientIds(ctx, post.id)),
      ...(post.inReplyToActorId ? [post.inReplyToActorId] : []),
    ],
  );
  const reachable = explicit.filter(deliversViaDiaspora);
  if (isPublicVisibility(post.visibility)) {
    for (const actor of [...(await diasporaFollowers(ctx, post.actorId)), ...reachable]) {
      addPublic(recipients, actor);
    }
  } else if (post.visibility === 'followers') {
    for (const actor of [...(await diasporaFollowers(ctx, post.actorId)), ...reachable]) {
      addPrivate(recipients, actor);
    }
  } else {
    for (const actor of reachable) addPrivate(recipients, actor);
  }
  if (options.exclude) excludeActor(recipients, options.exclude);
  return recipients;
}

/** diaspora* members of a group, who get what the group reshares. */
export async function diasporaGroupMembers(ctx: CoreContext, groupId: string): Promise<ActorRow[]> {
  const rows = await ctx.db
    .select({ actor: actors })
    .from(groupMembers)
    .innerJoin(actors, eq(actors.id, groupMembers.actorId))
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.state, 'member')));
  return rows.map((r) => r.actor).filter(deliversViaDiaspora);
}

/**
 * A thread in a group: in a public group, the group's diaspora* members and the people it names;
 * posts of private groups never reach diaspora*.
 */
async function groupRecipients(
  ctx: CoreContext,
  groupId: string,
  post: Pick<PostRow, 'id' | 'inReplyToActorId'>,
  options: { exclude?: string; explicitIds?: string[] },
): Promise<Recipients> {
  const recipients = emptyRecipients();
  const [group] = await ctx.db.select().from(groups).where(eq(groups.id, groupId));
  if (group?.privacy !== 'public') return recipients;
  const explicit = await actorsByIds(
    ctx,
    options.explicitIds ?? [
      ...(await explicitRecipientIds(ctx, post.id)),
      ...(post.inReplyToActorId ? [post.inReplyToActorId] : []),
    ],
  );
  for (const actor of [
    ...(await diasporaGroupMembers(ctx, groupId)),
    ...explicit.filter(deliversViaDiaspora),
  ])
    addPublic(recipients, actor);
  if (options.exclude) excludeActor(recipients, options.exclude);
  return recipients;
}

/** Drops one person: private copies to them, and public deliveries that would only reach them. */
export function excludeActor(recipients: Recipients, actorId: string): void {
  recipients.privateActors = recipients.privateActors.filter((a) => a.id !== actorId);
  for (const [url, ids] of recipients.publicUrls) {
    ids.delete(actorId);
    if (ids.size === 0) recipients.publicUrls.delete(url);
  }
}

/** Envelope signer: a local actor. */
export interface Signer {
  diasporaId: string;
  privateKey: string;
}

export async function signerFor(ctx: CoreContext, actor: ActorRow): Promise<Signer | null> {
  if (actor.domain !== null) return null;
  const privateKey = await localPrivateKey(ctx, actor.id);
  return privateKey ? { diasporaId: diasporaIdOf(ctx, actor), privateKey } : null;
}

/** Wraps entity XML in a Magic Envelope and queues one delivery per public URL and private recipient. */
export async function sendToRecipients(
  bridge: DiasporaBridge,
  payloadXml: string,
  signer: Signer,
  recipients: Recipients,
): Promise<void> {
  if (recipients.publicUrls.size === 0 && recipients.privateActors.length === 0) return;
  const envelope = createMagicEnvelope(payloadXml, signer.diasporaId, signer.privateKey);
  for (const url of recipients.publicUrls.keys()) {
    await bridge.deliverLater(url, envelope, MAGIC_ENV_CONTENT_TYPE);
  }
  for (const actor of recipients.privateActors) {
    if (!actor.diasporaReceiveUrl) continue;
    await bridge.deliverLater(
      actor.diasporaReceiveUrl,
      encryptMagicEnvelope(envelope, actor.publicKeyPem),
      ENCRYPTED_ENVELOPE_CONTENT_TYPE,
    );
  }
}

/**
 * Sends an interaction (comment, like, retraction of one) about the thread of `root`.
 * If the root author is local, they relay it to everyone who received the root, as diaspora*
 * requires; otherwise it goes to the root author's server, who relays it.
 * Relayables are signed by their author unless the author is the root author.
 */
export async function sendInteraction(
  bridge: DiasporaBridge,
  entity: Entity,
  author: ActorRow,
  root: PostRow,
): Promise<void> {
  const ctx = bridge.ctx;
  const rootAuthor = await actorById(ctx, root.actorId);
  const authorSigner = await signerFor(ctx, author);
  if (!rootAuthor || !authorSigner) return;
  const payload =
    isRelayable(entity) && author.id !== rootAuthor.id && !entity.authorSignature
      ? signRelayable(entity, authorSigner.privateKey)
      : entity;
  const xml = serializeEntity(payload);
  if (rootAuthor.domain === null) {
    const rootSigner = await signerFor(ctx, rootAuthor);
    if (!rootSigner) return;
    await sendToRecipients(bridge, xml, rootSigner, await recipientsFor(ctx, root));
    return;
  }
  if (!deliversViaDiaspora(rootAuthor)) return;
  const recipients = emptyRecipients();
  if (isPublicVisibility(root.visibility)) addPublic(recipients, rootAuthor);
  else addPrivate(recipients, rootAuthor);
  await sendToRecipients(bridge, xml, authorSigner, recipients);
}

/** Mentions of a post, keyed for the mention resolver. */
async function mentionResolver(ctx: CoreContext, postId: string) {
  const rows = await ctx.db
    .select({ actor: actors })
    .from(mentions)
    .innerJoin(actors, eq(actors.id, mentions.actorId))
    .where(eq(mentions.postId, postId));
  return (username: string, domain: string | null): string | null => {
    const wantedDomain = isLocalDomain(ctx.config, domain) ? null : domain;
    const actor = rows
      .map((r) => r.actor)
      .find(
        (a) =>
          a.username.toLowerCase() === username.toLowerCase() &&
          (a.domain?.toLowerCase() ?? null) === wantedDomain,
      );
    return actor ? diasporaIdOf(ctx, actor) : null;
  };
}

/** The diaspora* markdown text of a post. */
export async function diasporaText(ctx: CoreContext, post: PostRow): Promise<string> {
  const source = post.source ?? htmlToText(post.contentHtml);
  const text = mentionsToDiaspora(source, await mentionResolver(ctx, post.id));
  return post.summary ? `**${post.summary}**\n\n${text}` : text;
}

const absolute = (ctx: CoreContext, url: string) => new URL(url, ctx.config.PUBLIC_URL).href;

async function photosOf(
  ctx: CoreContext,
  post: PostRow,
  authorId: string,
  isPublic: boolean,
): Promise<Photo[]> {
  const media = await ctx.db
    .select()
    .from(mediaAttachments)
    .where(eq(mediaAttachments.postId, post.id))
    .orderBy(asc(mediaAttachments.position));
  const photos: Photo[] = [];
  for (const m of media) {
    if (m.type !== 'image') continue;
    const url = m.filePath ? mediaUrl(ctx, m.filePath) : m.remoteUrl;
    if (!url) continue;
    const href = absolute(ctx, url);
    const slash = href.lastIndexOf('/');
    photos.push({
      type: 'Photo',
      guid: m.id.replace(/-/g, ''),
      author: authorId,
      public: isPublic,
      createdAt: m.createdAt,
      remotePhotoPath: href.slice(0, slash + 1),
      remotePhotoName: href.slice(slash + 1),
      ...(m.description ? { text: m.description } : {}),
      statusMessageGuid: post.diasporaGuid ?? undefined,
      ...(m.height ? { height: m.height } : {}),
      ...(m.width ? { width: m.width } : {}),
    });
  }
  return photos;
}

/** StatusMessage for a top-level local post. */
export async function statusMessageFor(
  ctx: CoreContext,
  post: PostRow,
  author: ActorRow,
): Promise<StatusMessage> {
  const authorId = diasporaIdOf(ctx, author);
  const isPublic = isPublicVisibility(post.visibility);
  const photos = await photosOf(ctx, post, authorId, isPublic);
  const pollRow = await pollOfPost(ctx, post.id);
  const poll = pollRow ? diasporaPollOf(post, pollRow) : null;
  const text = await diasporaText(ctx, post);
  return {
    type: 'StatusMessage',
    author: authorId,
    guid: post.diasporaGuid ?? '',
    createdAt: post.createdAt,
    public: isPublic,
    providerDisplayName: 'Disbigle',
    text: poll && 'fallbackText' in poll ? `${text}\n\n${poll.fallbackText}` : text,
    ...(post.editedAt ? { editedAt: post.editedAt } : {}),
    ...(photos.length > 0 ? { photos } : {}),
    ...(poll && 'poll' in poll ? { poll: poll.poll } : {}),
  };
}

/** Comment for a local reply. diaspora* has no nested comments: the parent is the thread root. */
export async function commentFor(
  ctx: CoreContext,
  post: PostRow,
  author: ActorRow,
  root: PostRow,
): Promise<Comment> {
  return {
    type: 'Comment',
    author: diasporaIdOf(ctx, author),
    guid: post.diasporaGuid ?? '',
    parentGuid: root.diasporaGuid ?? '',
    text: await diasporaText(ctx, post),
    createdAt: post.createdAt,
    ...(post.editedAt ? { editedAt: post.editedAt } : {}),
  };
}

export function likeFor(ctx: CoreContext, guid: string, author: ActorRow, target: PostRow): Like {
  return {
    type: 'Like',
    author: diasporaIdOf(ctx, author),
    guid,
    parentGuid: target.diasporaGuid ?? '',
    parentType: target.inReplyToId ? 'Comment' : 'Post',
    positive: true,
  };
}

export function reshareFor(
  ctx: CoreContext,
  post: PostRow,
  author: ActorRow,
  original: PostRow,
  originalAuthor: ActorRow,
): Reshare {
  return {
    type: 'Reshare',
    author: diasporaIdOf(ctx, author),
    guid: post.diasporaGuid ?? '',
    createdAt: post.createdAt,
    rootAuthor: diasporaIdOf(ctx, originalAuthor),
    rootGuid: original.diasporaGuid ?? '',
  };
}

/** Local actor by username (for the hCard and fetch routes). */
export async function localActorByGuid(ctx: CoreContext, guid: string): Promise<ActorRow | null> {
  const [actor] = await ctx.db
    .select()
    .from(actors)
    .where(and(eq(actors.diasporaGuid, guid), isNull(actors.domain)));
  if (!actor || actor.suspendedAt) return null;
  // Groups exist on diaspora* only while they are public.
  if (actor.isGroup && !(await publicGroupOf(ctx, actor))) return null;
  return actor;
}
