import { schema, uuidv7 } from '@disbigle/db';
import type { Visibility } from '@disbigle/shared';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { type CoreContext, emit } from '../context.ts';
import { DomainError } from '../errors.ts';
import { sanitizeRemoteHtml } from '../social/content.ts';
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
        domain === null || domain.toLowerCase() === ctx.config.LOCAL_DOMAIN.toLowerCase()
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
  if (domain === ctx.config.LOCAL_DOMAIN.toLowerCase()) {
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
  const existing = matches.find((a) => a.domain !== null) ?? null;

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

async function isTombstoned(ctx: CoreContext, uri: string | undefined): Promise<boolean> {
  if (!uri) return false;
  const [row] = await ctx.db
    .select({ id: tombstones.id })
    .from(tombstones)
    .where(eq(tombstones.uri, uri));
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
  if (await isTombstoned(ctx, data.apUri)) return null;
  const known = data.apUri
    ? await findPostByUri(ctx, data.apUri)
    : await findPostByGuid(ctx, data.diasporaGuid ?? '');
  if (known) return known.id;

  const parent = data.inReplyTo?.postId
    ? ((await ctx.db.select().from(posts).where(eq(posts.id, data.inReplyTo.postId)))[0] ?? null)
    : data.inReplyTo?.uri
      ? await findPostByUri(ctx, data.inReplyTo.uri)
      : null;

  const id = uuidv7();
  const audience = new Set(data.audienceActorIds ?? []);
  const mentioned = new Set(data.mentionActorIds ?? []);
  audience.delete(data.authorActorId);
  mentioned.delete(data.authorActorId);
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
    if (parent) {
      await tx
        .update(posts)
        .set({ repliesCount: sql`${posts.repliesCount} + 1` })
        .where(eq(posts.id, parent.id));
    }
  });

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

/** Applies an edit received from the author's server. */
export async function updateRemotePost(
  ctx: CoreContext,
  authorActorId: string,
  apUri: string,
  changes: { contentHtml: string; summary?: string; sensitive?: boolean },
): Promise<boolean> {
  const updated = await ctx.db
    .update(posts)
    .set({
      contentHtml: sanitizeRemoteHtml(changes.contentHtml).slice(0, 100_000),
      ...(changes.summary !== undefined ? { summary: changes.summary.slice(0, 1000) } : {}),
      ...(changes.sensitive !== undefined ? { sensitive: changes.sensitive } : {}),
      editedAt: new Date(),
    })
    .where(and(eq(posts.apUri, apUri), eq(posts.actorId, authorActorId), eq(posts.local, false)))
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
  if (ref.apUri) {
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
    .returning({ postId: likes.postId });
  for (const row of removed) {
    await ctx.db
      .update(posts)
      .set({ likesCount: sql`greatest(${posts.likesCount} - 1, 0)` })
      .where(eq(posts.id, row.postId));
  }
}

/** Removes everything of a remote account that deleted itself. */
export async function deleteRemoteActor(ctx: CoreContext, actorId: string): Promise<void> {
  const [actor] = await ctx.db.select().from(actors).where(eq(actors.id, actorId));
  if (!actor || actor.domain === null) return;
  await ctx.db.delete(actors).where(eq(actors.id, actorId));
}
