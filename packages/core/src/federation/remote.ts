import { isLocalDomain } from '@disbigle/config';
import { schema, uuidv7 } from '@disbigle/db';
import type { Visibility } from '@disbigle/shared';
import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { type CoreContext, emit } from '../context.ts';
import { DomainError } from '../errors.ts';
import { sanitizeRemoteHtml } from '../social/content.ts';
import { findGroup, groupOfActor, isGroupMember, notifyModerators } from '../social/groups.ts';
import { createNotification } from '../social/notifications.ts';
import { deletePost } from '../social/posts.ts';

const { actors, posts, postAudiences, mentions, tags, postTags, mediaAttachments, tombstones } =
  schema;
export type ActorRow = typeof actors.$inferSelect;
export type Protocol = 'activitypub' | 'diaspora';

/**
 * Protocol-neutral description of a remote account. Adapters (ActivityPub, diaspora) fill in what
 * they know; existing values are kept for fields left undefined.
 */
export interface RemoteActorData {
  username: string;
  domain: string;
  displayName?: string;
  summaryHtml?: string;
  avatarUrl?: string | null;
  headerUrl?: string | null;
  fields?: { name: string; value: string }[];
  locked?: boolean;
  bot?: boolean;
  /** An ActivityPub Group (a Lemmy community, a Friendica forum...). */
  group?: boolean;
  discoverable?: boolean;
  publicKeyPem?: string;
  apUri?: string;
  apUrl?: string | null;
  apInbox?: string | null;
  apSharedInbox?: string | null;
  apOutbox?: string | null;
  apFollowers?: string | null;
  diasporaGuid?: string;
  diasporaReceiveUrl?: string | null;
  /** ActivityPub `alsoKnownAs`, as actor URIs. */
  alsoKnownAs?: string[];
  protocol: Protocol;
}

/** Keeps only http(s) URLs: remote data must never smuggle `javascript:` or `data:` links. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

export async function findActorByApUri(ctx: CoreContext, uri: string): Promise<ActorRow | null> {
  const [actor] = await ctx.db.select().from(actors).where(eq(actors.apUri, uri));
  return actor ?? null;
}

export async function findActorByHandle(ctx: CoreContext, username: string, domain: string | null) {
  const [actor] = await ctx.db
    .select()
    .from(actors)
    .where(
      and(
        sql`lower(${actors.username}) = lower(${username})`,
        domain === null || isLocalDomain(ctx.config, domain)
          ? isNull(actors.domain)
          : sql`lower(${actors.domain}) = lower(${domain})`,
      ),
    );
  return actor ?? null;
}

/** Creates or refreshes a remote actor. One row per account, even when it speaks both protocols. */
export async function upsertRemoteActor(
  ctx: CoreContext,
  data: RemoteActorData,
): Promise<ActorRow> {
  const domain = data.domain.toLowerCase();
  if (isLocalDomain(ctx.config, domain)) {
    throw new DomainError('bad_request', 'Refusing to store a local account as remote');
  }
  const matches = await ctx.db
    .select()
    .from(actors)
    .where(
      or(
        data.apUri ? eq(actors.apUri, data.apUri) : undefined,
        data.diasporaGuid ? eq(actors.diasporaGuid, data.diasporaGuid) : undefined,
        and(
          sql`lower(${actors.username}) = lower(${data.username})`,
          sql`lower(${actors.domain}) = ${domain}`,
        ),
      ),
    );
  // Identity rules: the account is username@domain. An ActivityPub id may move to a new username on
  // the same server (rename), but a guid or id already owned by a different account is a conflict:
  // accepting it would let one server take over another person's record and keys.
  const sameHandle = (a: ActorRow) =>
    a.domain !== null &&
    a.domain.toLowerCase() === domain &&
    a.username.toLowerCase() === data.username.toLowerCase();
  const byHandle = matches.find(sameHandle);
  const byApUri = data.apUri ? matches.find((a) => a.apUri === data.apUri) : undefined;
  const byGuid = data.diasporaGuid
    ? matches.find((a) => a.diasporaGuid === data.diasporaGuid)
    : undefined;
  const conflict = () => new DomainError('conflict', 'This identity belongs to another account');
  if (byGuid && !sameHandle(byGuid)) throw conflict();
  if (
    byApUri &&
    (byApUri.domain?.toLowerCase() !== domain || (byHandle && byHandle.id !== byApUri.id))
  ) {
    throw conflict();
  }
  const existing = byHandle ?? byApUri ?? null;
  if (existing?.diasporaGuid && data.diasporaGuid && existing.diasporaGuid !== data.diasporaGuid)
    throw conflict();
  if (existing?.apUri && data.apUri && existing.apUri !== data.apUri && byHandle) {
    // Same handle, different ActivityPub id: only accept it on the same origin.
    if (new URL(existing.apUri).host !== new URL(data.apUri).host) throw conflict();
  }

  const values = {
    displayName: data.displayName?.slice(0, 200),
    summary:
      data.summaryHtml !== undefined
        ? sanitizeRemoteHtml(data.summaryHtml).slice(0, 20000)
        : undefined,
    avatarUrl: data.avatarUrl === undefined ? undefined : safeHttpUrl(data.avatarUrl),
    headerUrl: data.headerUrl === undefined ? undefined : safeHttpUrl(data.headerUrl),
    fields: data.fields?.slice(0, 16).map((f) => ({
      name: f.name.slice(0, 255),
      value: sanitizeRemoteHtml(f.value).slice(0, 2047),
    })),
    locked: data.locked,
    bot: data.bot,
    isGroup: data.group,
    discoverable: data.discoverable,
    publicKeyPem: data.publicKeyPem,
    apUri: data.apUri,
    apUrl: data.apUrl === undefined ? undefined : safeHttpUrl(data.apUrl),
    apInbox: data.apInbox,
    apSharedInbox: data.apSharedInbox,
    apOutbox: data.apOutbox,
    apFollowers: data.apFollowers,
    diasporaGuid: data.diasporaGuid,
    diasporaReceiveUrl: data.diasporaReceiveUrl,
    alsoKnownAs: data.alsoKnownAs?.slice(0, 20),
    lastFetchedAt: new Date(),
  };
  const defined = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
  // Images: remember the remote original; keep a cached local copy while the original is unchanged.
  for (const [field, remoteField] of [
    ['avatarUrl', 'avatarRemoteUrl'],
    ['headerUrl', 'headerRemoteUrl'],
  ] as const) {
    if (!(field in defined)) continue;
    const incoming = defined[field] as string | null;
    defined[remoteField] = incoming;
    if (existing && incoming !== null && existing[remoteField] === incoming) delete defined[field];
  }

  if (existing) {
    const protocols = [...new Set([...existing.protocols, data.protocol])];
    const [updated] = await ctx.db
      .update(actors)
      .set({
        ...defined,
        protocols,
        preferredProtocol: protocols.includes('activitypub') ? 'activitypub' : 'diaspora',
        updatedAt: new Date(),
      })
      .where(eq(actors.id, existing.id))
      .returning();
    if (!updated) throw new Error('Update failed');
    return updated;
  }

  if (!data.publicKeyPem) throw new DomainError('bad_request', 'Remote actor has no public key');
  const [created] = await ctx.db
    .insert(actors)
    .values({
      id: uuidv7(),
      username: data.username,
      domain,
      publicKeyPem: data.publicKeyPem,
      ...defined,
      protocols: [data.protocol],
      preferredProtocol: data.protocol,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  // Lost a race with a concurrent insert: read the winner.
  const again = await findActorByHandle(ctx, data.username, domain);
  if (!again) throw new Error('Remote actor insert failed');
  return again;
}

export interface RemoteAttachment {
  url: string;
  mimeType: string;
  description?: string;
  width?: number | null;
  height?: number | null;
  blurhash?: string | null;
}

export interface RemotePostData {
  authorActorId: string;
  apUri?: string;
  apUrl?: string | null;
  diasporaGuid?: string;
  /** Already-rendered HTML; sanitised here. */
  contentHtml: string;
  summary?: string;
  sensitive?: boolean;
  language?: string | null;
  visibility: Visibility;
  /** Local and known remote actors addressed explicitly. */
  audienceActorIds?: string[];
  mentionActorIds?: string[];
  tags?: string[];
  inReplyTo?: { postId?: string | null; uri?: string | null };
  /** One of our groups' actors, when the post was addressed to it. */
  groupActorId?: string | null;
  attachments?: RemoteAttachment[];
  publishedAt?: Date;
  poll?: {
    options: { title: string; votesCount: number; diasporaGuid?: string }[];
    multiple: boolean;
    expiresAt: Date | null;
    votersCount?: number;
    diasporaGuid?: string;
  };
}

export async function findPostByUri(ctx: CoreContext, uri: string) {
  const [post] = await ctx.db.select().from(posts).where(eq(posts.apUri, uri));
  return post ?? null;
}

export async function findPostByGuid(ctx: CoreContext, guid: string) {
  const [post] = await ctx.db.select().from(posts).where(eq(posts.diasporaGuid, guid));
  return post ?? null;
}

async function isTombstoned(
  ctx: CoreContext,
  uri: string | undefined,
  authorActorId: string,
): Promise<boolean> {
  if (!uri) return false;
  // Only the author's own Delete counts: a tombstone left by someone else blocks nothing.
  const [row] = await ctx.db
    .select({ id: tombstones.id })
    .from(tombstones)
    .where(and(eq(tombstones.uri, uri), eq(tombstones.actorId, authorActorId)));
  return Boolean(row);
}

const mediaTypeOf = (mime: string): 'image' | 'video' | 'audio' | 'unknown' =>
  mime.startsWith('image/')
    ? 'image'
    : mime.startsWith('video/')
      ? 'video'
      : mime.startsWith('audio/')
        ? 'audio'
        : 'unknown';

/**
 * Stores a post received from another server. Idempotent: a post already known by its federated
 * id is returned unchanged. Returns null for deleted (tombstoned) objects.
 */
export async function ingestRemotePost(
  ctx: CoreContext,
  data: RemotePostData,
): Promise<string | null> {
  if (!data.apUri && !data.diasporaGuid)
    throw new DomainError('bad_request', 'Remote post has no id');
  if (await isTombstoned(ctx, data.apUri, data.authorActorId)) return null;
  const known = data.apUri
    ? await findPostByUri(ctx, data.apUri)
    : await findPostByGuid(ctx, data.diasporaGuid ?? '');
  // Same id from someone else: never hand out (or widen the audience of) another author's post.
  if (known) return known.actorId === data.authorActorId ? known.id : null;

  const parent = data.inReplyTo?.postId
    ? ((await ctx.db.select().from(posts).where(eq(posts.id, data.inReplyTo.postId)))[0] ?? null)
    : data.inReplyTo?.uri
      ? await findPostByUri(ctx, data.inReplyTo.uri)
      : null;

  // Ids follow the publication date (as on Mastodon), so backfilled posts sort where they belong.
  const published = data.publishedAt?.getTime();
  const id = uuidv7(published && published < Date.now() ? published : Date.now());
  const audience = new Set(data.audienceActorIds ?? []);
  const mentioned = new Set(data.mentionActorIds ?? []);
  audience.delete(data.authorActorId);
  mentioned.delete(data.authorActorId);
  // Public posts join a group: replies the group of their thread, new posts the public group
  // they were addressed to, when the author is a member. Private answers stay private.
  let groupId: string | null = null;
  if (data.visibility === 'public' || data.visibility === 'unlisted') {
    if (parent?.groupId) groupId = parent.groupId;
    else if (data.groupActorId && !parent) {
      const record = await groupOfActor(ctx, data.groupActorId);
      if (
        record?.group.privacy === 'public' &&
        (await isGroupMember(ctx, record.group.id, data.authorActorId))
      )
        groupId = record.group.id;
    }
  }
  if (data.groupActorId) {
    audience.delete(data.groupActorId);
    mentioned.delete(data.groupActorId);
  }
  // In a group that approves posts, what comes from elsewhere waits for a moderator too.
  const pending = groupId ? Boolean((await findGroup(ctx, groupId))?.group.postApproval) : false;
  const tagNames = [
    ...new Set((data.tags ?? []).map((t) => t.replace(/^#/, '').toLowerCase()).filter(Boolean)),
  ];

  await ctx.db.transaction(async (tx) => {
    await tx.insert(posts).values({
      id,
      actorId: data.authorActorId,
      local: false,
      visibility: data.visibility,
      contentHtml: sanitizeRemoteHtml(data.contentHtml).slice(0, 100_000),
      summary: (data.summary ?? '').slice(0, 1000),
      sensitive: data.sensitive ?? Boolean(data.summary),
      language: data.language ?? null,
      inReplyToId: parent?.id ?? null,
      inReplyToActorId: parent?.actorId ?? null,
      inReplyToUri: parent ? null : (data.inReplyTo?.uri ?? null),
      threadRootId: parent ? (parent.threadRootId ?? parent.id) : id,
      groupId,
      pendingApproval: pending,
      apUri: data.apUri ?? null,
      apUrl: safeHttpUrl(data.apUrl ?? data.apUri),
      diasporaGuid: data.diasporaGuid ?? null,
      createdAt:
        data.publishedAt && data.publishedAt.getTime() < Date.now() ? data.publishedAt : new Date(),
    });
    if (audience.size > 0) {
      await tx
        .insert(postAudiences)
        .values([...audience].map((actorId) => ({ postId: id, actorId })));
    }
    if (mentioned.size > 0) {
      await tx.insert(mentions).values([...mentioned].map((actorId) => ({ postId: id, actorId })));
    }
    if (tagNames.length > 0) {
      await tx
        .insert(tags)
        .values(tagNames.map((name) => ({ id: uuidv7(), name })))
        .onConflictDoNothing();
      const tagRows = await tx
        .select({ id: tags.id })
        .from(tags)
        .where(inArray(tags.name, tagNames));
      await tx.insert(postTags).values(tagRows.map((t) => ({ postId: id, tagId: t.id })));
    }
    const attachments = (data.attachments ?? [])
      .map((a) => ({ ...a, url: safeHttpUrl(a.url) ?? '' }))
      .filter((a) => a.url)
      .slice(0, 8);
    if (attachments.length > 0) {
      await tx.insert(mediaAttachments).values(
        attachments.map((a, position) => ({
          id: uuidv7(),
          actorId: data.authorActorId,
          postId: id,
          type: mediaTypeOf(a.mimeType),
          mimeType: a.mimeType,
          remoteUrl: a.url,
          width: a.width ?? null,
          height: a.height ?? null,
          blurhash: a.blurhash ?? null,
          description: (a.description ?? '').slice(0, 1500),
          position,
        })),
      );
    }
    if (data.poll && data.poll.options.length >= 2) {
      await tx.insert(schema.polls).values({
        id: uuidv7(),
        postId: id,
        options: data.poll.options.slice(0, 20).map((o) => ({
          title: o.title.slice(0, 200),
          votesCount: o.votesCount,
          ...(o.diasporaGuid ? { diasporaGuid: o.diasporaGuid } : {}),
        })),
        multiple: data.poll.multiple,
        expiresAt: data.poll.expiresAt,
        votersCount: data.poll.votersCount ?? 0,
        diasporaGuid: data.poll.diasporaGuid ?? null,
      });
    }
    if (parent && !pending) {
      await tx
        .update(posts)
        .set({ repliesCount: sql`${posts.repliesCount} + 1` })
        .where(eq(posts.id, parent.id));
    }
  });

  if (pending && groupId) {
    await notifyModerators(ctx, groupId, data.authorActorId, 'group_post_pending', id);
    return id;
  }
  for (const actorId of mentioned) {
    await createNotification(ctx, {
      actorId,
      type: 'mention',
      fromActorId: data.authorActorId,
      postId: id,
    });
  }
  if (parent && !mentioned.has(parent.actorId)) {
    await createNotification(ctx, {
      actorId: parent.actorId,
      type: 'reply',
      fromActorId: data.authorActorId,
      postId: id,
    });
  }
  await emit(ctx, { type: 'post.created', postId: id, actorId: data.authorActorId });
  return id;
}

/**
 * Applies an edit received from the author's server, to the post with that ActivityPub id (a
 * string) or diaspora* guid. With `editedAt`, an edit older than the one already applied is
 * ignored (diaspora* copies may arrive in any order).
 */
export async function updateRemotePost(
  ctx: CoreContext,
  authorActorId: string,
  id: string | { diasporaGuid: string },
  changes: { contentHtml: string; summary?: string; sensitive?: boolean; editedAt?: Date },
): Promise<boolean> {
  const updated = await ctx.db
    .update(posts)
    .set({
      contentHtml: sanitizeRemoteHtml(changes.contentHtml).slice(0, 100_000),
      ...(changes.summary !== undefined ? { summary: changes.summary.slice(0, 1000) } : {}),
      ...(changes.sensitive !== undefined ? { sensitive: changes.sensitive } : {}),
      editedAt: changes.editedAt ?? new Date(),
    })
    .where(
      and(
        typeof id === 'string' ? eq(posts.apUri, id) : eq(posts.diasporaGuid, id.diasporaGuid),
        eq(posts.actorId, authorActorId),
        eq(posts.local, false),
        changes.editedAt
          ? or(isNull(posts.editedAt), lt(posts.editedAt, changes.editedAt))
          : undefined,
      ),
    )
    .returning({ id: posts.id });
  return updated.length > 0;
}

/** Deletes a remote post by its federated id, only when the request comes from its author. */
export async function deleteRemotePost(
  ctx: CoreContext,
  authorActorId: string,
  ref: { apUri?: string; diasporaGuid?: string },
): Promise<boolean> {
  const post = ref.apUri
    ? await findPostByUri(ctx, ref.apUri)
    : await findPostByGuid(ctx, ref.diasporaGuid ?? '');
  // A tombstone for an object we don't have yet is kept only when the URI lives on the sender's
  // own server, so nobody can pre-delete someone else's posts.
  const [author] = await ctx.db.select().from(actors).where(eq(actors.id, authorActorId));
  const sameOrigin = (uri: string, other: string | null | undefined) => {
    try {
      return !!other && new URL(uri).origin === new URL(other).origin;
    } catch {
      return false;
    }
  };
  const owns = post ? post.actorId === authorActorId : sameOrigin(ref.apUri ?? '', author?.apUri);
  if (ref.apUri && owns) {
    await ctx.db
      .insert(tombstones)
      .values({ id: uuidv7(), uri: ref.apUri, actorId: authorActorId })
      .onConflictDoNothing();
  }
  if (!post || post.actorId !== authorActorId || post.local) return false;
  await deletePost(ctx, authorActorId, post.id);
  return true;
}

/** Records a reshare made on another server. */
export async function ingestRemoteAnnounce(
  ctx: CoreContext,
  actorId: string,
  targetPostId: string,
  ref: { apUri?: string; diasporaGuid?: string },
): Promise<void> {
  const [target] = await ctx.db.select().from(posts).where(eq(posts.id, targetPostId));
  if (!target || (target.visibility !== 'public' && target.visibility !== 'unlisted')) return;
  const id = uuidv7();
  const inserted = await ctx.db
    .insert(posts)
    .values({
      id,
      actorId,
      local: false,
      visibility: target.visibility,
      reblogOfId: target.id,
      threadRootId: id,
      apUri: ref.apUri ?? null,
      diasporaGuid: ref.diasporaGuid ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: posts.id });
  if (inserted.length === 0) return;
  await ctx.db
    .update(posts)
    .set({ reblogsCount: sql`${posts.reblogsCount} + 1` })
    .where(eq(posts.id, target.id));
  await createNotification(ctx, {
    actorId: target.actorId,
    type: 'reblog',
    fromActorId: actorId,
    postId: target.id,
  });
  await emit(ctx, { type: 'post.created', postId: id, actorId });
}

/** Undoes a remote reshare or like identified by its activity id. */
export async function undoRemoteActivity(
  ctx: CoreContext,
  actorId: string,
  uri: string,
): Promise<void> {
  const [reblog] = await ctx.db
    .select()
    .from(posts)
    .where(and(eq(posts.apUri, uri), eq(posts.actorId, actorId), eq(posts.local, false)));
  if (reblog?.reblogOfId) {
    await deletePost(ctx, actorId, reblog.id);
    return;
  }
  const { likes } = schema;
  const removed = await ctx.db
    .delete(likes)
    .where(and(eq(likes.apUri, uri), eq(likes.actorId, actorId)))
    .returning({ postId: likes.postId, diasporaGuid: likes.diasporaGuid });
  for (const row of removed) {
    await ctx.db
      .update(posts)
      .set({ likesCount: sql`greatest(${posts.likesCount} - 1, 0)` })
      .where(eq(posts.id, row.postId));
    // Other networks may have seen the like (through a bridge identity): tell them too.
    await emit(ctx, {
      type: 'like.removed',
      actorId,
      postId: row.postId,
      apUri: uri,
      diasporaGuid: row.diasporaGuid,
    });
  }
}

/** Removes everything of a remote account that deleted itself. */
export async function deleteRemoteActor(ctx: CoreContext, actorId: string): Promise<void> {
  const [actor] = await ctx.db.select().from(actors).where(eq(actors.id, actorId));
  if (!actor || actor.domain === null) return;
  await ctx.db.delete(actors).where(eq(actors.id, actorId));
}
