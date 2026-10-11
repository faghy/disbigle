import { randomBytes } from 'node:crypto';
import { schema, uuidv7 } from '@disbigle/db';
import {
  type CreatePostRequest,
  createPostRequestSchema,
  type EditPostRequest,
  editPostRequestSchema,
  type Status,
  type StatusContext,
  type Visibility,
} from '@disbigle/shared';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { type CoreContext, emit } from '../context.ts';
import { DomainError } from '../errors.ts';
import { extractMentions, extractTags, renderMarkdown } from './content.ts';
import { notFilteredFor } from './filters.ts';
import { createNotification } from './notifications.ts';
import { hydrateStatuses, type PostRow } from './statuses.ts';
import { visibleTo } from './visibility.ts';

const {
  posts,
  actors,
  postAudiences,
  postAspects,
  mentions,
  tags,
  postTags,
  mediaAttachments,
  likes,
  bookmarks,
} = schema;
const { aspects, aspectMemberships, tombstones } = schema;

async function getLocalActor(ctx: CoreContext, actorId: string) {
  const [actor] = await ctx.db.select().from(actors).where(eq(actors.id, actorId));
  if (!actor || actor.domain !== null)
    throw new DomainError('forbidden', 'Only local accounts can post');
  return actor;
}

/** Loads a post the viewer is allowed to see, or throws not_found. */
export async function getVisiblePost(
  ctx: CoreContext,
  viewerActorId: string | null,
  postId: string,
) {
  const [post] = await ctx.db
    .select()
    .from(posts)
    .where(and(eq(posts.id, postId), visibleTo(viewerActorId)));
  if (!post) throw new DomainError('not_found', 'Post not found');
  return post;
}

/** Resolves written mentions to known accounts: local ones, and remote ones already fetched. */
async function resolveMentions(ctx: CoreContext, source: string) {
  const parsed = extractMentions(source);
  const resolved = new Map<string, typeof actors.$inferSelect>();
  for (const mention of parsed) {
    const domain = mention.domain === ctx.config.LOCAL_DOMAIN.toLowerCase() ? null : mention.domain;
    const [actor] = await ctx.db
      .select()
      .from(actors)
      .where(
        and(
          sql`lower(${actors.username}) = lower(${mention.username})`,
          domain === null ? isNull(actors.domain) : sql`lower(${actors.domain}) = ${domain}`,
        ),
      );
    let found = actor;
    if (!found && domain !== null && ctx.resolveAccount) {
      const id = await ctx.resolveAccount(mention.username, domain).catch(() => null);
      found = id ? (await ctx.db.select().from(actors).where(eq(actors.id, id)))[0] : undefined;
    }
    if (found && !found.suspendedAt) {
      resolved.set(`${mention.username.toLowerCase()}@${mention.domain ?? ''}`, found);
    }
  }
  return resolved;
}

export async function createPost(
  ctx: CoreContext,
  authorActorId: string,
  request: CreatePostRequest,
): Promise<Status> {
  const input = createPostRequestSchema.parse(request);
  const author = await getLocalActor(ctx, authorActorId);
  const parent = input.inReplyToId
    ? await getVisiblePost(ctx, authorActorId, input.inReplyToId)
    : null;
  if (parent?.reblogOfId)
    throw new DomainError('bad_request', 'Reply to the original post instead');

  let visibility: Visibility = input.visibility;
  const audience = new Set<string>();
  let aspectIds: string[] = [];

  if (parent && (parent.visibility === 'limited' || parent.visibility === 'direct')) {
    // Replies to private conversations stay inside them.
    visibility = parent.visibility;
    const parentAudience = await ctx.db
      .select({ actorId: postAudiences.actorId })
      .from(postAudiences)
      .where(eq(postAudiences.postId, parent.id));
    for (const row of parentAudience) audience.add(row.actorId);
    audience.add(parent.actorId);
  } else if (visibility === 'limited') {
    if (input.aspectIds.length === 0) {
      throw new DomainError('validation_failed', 'Choose at least one aspect', [
        { path: 'aspectIds', message: 'Choose at least one aspect' },
      ]);
    }
    const owned = await ctx.db
      .select({ id: aspects.id })
      .from(aspects)
      .where(and(eq(aspects.ownerActorId, authorActorId), inArray(aspects.id, input.aspectIds)));
    if (owned.length !== new Set(input.aspectIds).size)
      throw new DomainError('not_found', 'Aspect not found');
    aspectIds = owned.map((a) => a.id);
    const members = await ctx.db
      .selectDistinct({ actorId: aspectMemberships.actorId })
      .from(aspectMemberships)
      .where(inArray(aspectMemberships.aspectId, aspectIds));
    for (const row of members) audience.add(row.actorId);
  }

  const mentioned = await resolveMentions(ctx, input.content);
  const mentionedIds = new Set([...mentioned.values()].map((a) => a.id));
  for (const id of mentionedIds) audience.add(id);
  audience.delete(authorActorId);
  mentionedIds.delete(authorActorId);

  if (visibility === 'direct' && audience.size === 0) {
    throw new DomainError('validation_failed', 'Mention at least one person', [
      { path: 'content', message: 'Mention at least one person' },
    ]);
  }

  const mediaIds = [...new Set(input.mediaIds)];
  if (mediaIds.length > 0) {
    const media = await ctx.db
      .select({ id: mediaAttachments.id })
      .from(mediaAttachments)
      .where(
        and(
          inArray(mediaAttachments.id, mediaIds),
          eq(mediaAttachments.actorId, authorActorId),
          isNull(mediaAttachments.postId),
        ),
      );
    if (media.length !== mediaIds.length) throw new DomainError('not_found', 'Media not found');
  }

  const base = ctx.config.PUBLIC_URL;
  const contentHtml = renderMarkdown(input.content, {
    resolveMention: (username, domain) =>
      mentioned.get(`${username.toLowerCase()}@${domain ?? ''}`)?.apUrl ?? null,
    tagUrl: (tag) => `${base}/tags/${encodeURIComponent(tag)}`,
    localOrigin: new URL(base).origin,
  });
  const tagNames = extractTags(input.content);

  const id = uuidv7();
  const row: typeof posts.$inferInsert = {
    id,
    actorId: authorActorId,
    local: true,
    visibility,
    source: input.content,
    contentHtml,
    summary: input.summary,
    sensitive: input.sensitive || input.summary.length > 0,
    language: input.language ?? null,
    inReplyToId: parent?.id ?? null,
    inReplyToActorId: parent?.actorId ?? null,
    threadRootId: parent ? (parent.threadRootId ?? parent.id) : id,
    apUri: `${author.apUri}/statuses/${id}`,
    apUrl: `${base}/@${author.username}/${id}`,
    diasporaGuid: randomBytes(16).toString('hex'),
  };

  await ctx.db.transaction(async (tx) => {
    await tx.insert(posts).values(row);
    if (audience.size > 0) {
      await tx
        .insert(postAudiences)
        .values([...audience].map((actorId) => ({ postId: id, actorId })));
    }
    if (aspectIds.length > 0) {
      await tx.insert(postAspects).values(aspectIds.map((aspectId) => ({ postId: id, aspectId })));
    }
    if (mentionedIds.size > 0) {
      await tx
        .insert(mentions)
        .values([...mentionedIds].map((actorId) => ({ postId: id, actorId })));
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
    if (input.poll) {
      await tx.insert(schema.polls).values({
        id: uuidv7(),
        postId: id,
        options: input.poll.options.map((title) => ({ title, votesCount: 0 })),
        multiple: input.poll.multiple,
        expiresAt: new Date(Date.now() + input.poll.expiresIn * 1000),
        diasporaGuid: randomBytes(16).toString('hex'),
      });
    }
    for (const [position, mediaId] of mediaIds.entries()) {
      await tx
        .update(mediaAttachments)
        .set({ postId: id, position })
        .where(eq(mediaAttachments.id, mediaId));
    }
    if (parent) {
      await tx
        .update(posts)
        .set({ repliesCount: sql`${posts.repliesCount} + 1` })
        .where(eq(posts.id, parent.id));
    }
  });

  for (const actorId of mentionedIds) {
    await createNotification(ctx, {
      actorId,
      type: 'mention',
      fromActorId: authorActorId,
      postId: id,
    });
  }
  if (parent && !mentionedIds.has(parent.actorId)) {
    await createNotification(ctx, {
      actorId: parent.actorId,
      type: 'reply',
      fromActorId: authorActorId,
      postId: id,
    });
  }
  await emit(ctx, { type: 'post.created', postId: id, actorId: authorActorId });

  const [created] = await ctx.db.select().from(posts).where(eq(posts.id, id));
  if (!created) throw new Error('Post vanished after insert');
  const [status] = await hydrateStatuses(ctx, authorActorId, [created]);
  if (!status) throw new Error('Serialization failed');
  return status;
}

/**
 * Edits the text of your own post. Audience, mentions-based recipients and attachments stay as
 * they were; newly mentioned people are linked but not added to a private audience.
 */
export async function editPost(
  ctx: CoreContext,
  actorId: string,
  postId: string,
  request: EditPostRequest,
): Promise<Status> {
  const input = editPostRequestSchema.parse(request);
  const [post] = await ctx.db.select().from(posts).where(eq(posts.id, postId));
  if (!post || post.actorId !== actorId || !post.local || post.reblogOfId) {
    throw new DomainError('not_found', 'Post not found');
  }
  const [hasMedia] = await ctx.db
    .select({ id: mediaAttachments.id })
    .from(mediaAttachments)
    .where(eq(mediaAttachments.postId, post.id))
    .limit(1);
  if (!input.content.trim() && !hasMedia) {
    throw new DomainError('validation_failed', 'A post needs text or media', [
      { path: 'content', message: 'A post needs text or media' },
    ]);
  }
  const mentioned = await resolveMentions(ctx, input.content);
  const base = ctx.config.PUBLIC_URL;
  const contentHtml = renderMarkdown(input.content, {
    resolveMention: (username, domain) =>
      mentioned.get(`${username.toLowerCase()}@${domain ?? ''}`)?.apUrl ?? null,
    tagUrl: (tag) => `${base}/tags/${encodeURIComponent(tag)}`,
    localOrigin: new URL(base).origin,
  });
  const tagNames = extractTags(input.content);
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(posts)
      .set({
        source: input.content,
        contentHtml,
        summary: input.summary,
        sensitive: input.sensitive || input.summary.length > 0,
        editedAt: new Date(),
      })
      .where(eq(posts.id, post.id));
    await tx.delete(postTags).where(eq(postTags.postId, post.id));
    if (tagNames.length > 0) {
      await tx
        .insert(tags)
        .values(tagNames.map((name) => ({ id: uuidv7(), name })))
        .onConflictDoNothing();
      const tagRows = await tx
        .select({ id: tags.id })
        .from(tags)
        .where(inArray(tags.name, tagNames));
      await tx.insert(postTags).values(tagRows.map((t) => ({ postId: post.id, tagId: t.id })));
    }
    const newMentions = [...mentioned.values()].map((a) => a.id).filter((id) => id !== actorId);
    if (newMentions.length > 0) {
      await tx
        .insert(mentions)
        .values(newMentions.map((id) => ({ postId: post.id, actorId: id })))
        .onConflictDoNothing();
    }
  });
  await emit(ctx, { type: 'post.updated', postId: post.id, actorId });
  return getStatus(ctx, actorId, post.id);
}

/** Deletes a post (and reblogs of it). Moderators may delete any post with `asModerator`. */
export async function deletePost(
  ctx: CoreContext,
  actorId: string,
  postId: string,
  options: { asModerator?: boolean } = {},
): Promise<void> {
  const [post] = await ctx.db.select().from(posts).where(eq(posts.id, postId));
  if (!post || (post.actorId !== actorId && !options.asModerator)) {
    throw new DomainError('not_found', 'Post not found');
  }
  const audience = await ctx.db
    .select({ actorId: postAudiences.actorId })
    .from(postAudiences)
    .where(eq(postAudiences.postId, post.id));
  await ctx.db.transaction(async (tx) => {
    await tx.delete(posts).where(eq(posts.reblogOfId, post.id));
    await tx.delete(posts).where(eq(posts.id, post.id));
    if (post.inReplyToId) {
      await tx
        .update(posts)
        .set({ repliesCount: sql`greatest(${posts.repliesCount} - 1, 0)` })
        .where(eq(posts.id, post.inReplyToId));
    }
    if (post.reblogOfId) {
      await tx
        .update(posts)
        .set({ reblogsCount: sql`greatest(${posts.reblogsCount} - 1, 0)` })
        .where(eq(posts.id, post.reblogOfId));
    }
    if (post.apUri && post.local) {
      await tx
        .insert(tombstones)
        .values({ id: uuidv7(), uri: post.apUri, actorId: post.actorId })
        .onConflictDoNothing();
    }
  });
  await emit(ctx, {
    type: 'post.deleted',
    postId: post.id,
    actorId: post.actorId,
    apUri: post.apUri,
    diasporaGuid: post.diasporaGuid,
    audienceActorIds: audience.map((a) => a.actorId),
    visibility: post.visibility,
    reblogOfId: post.reblogOfId,
    threadRootId: post.threadRootId,
    inReplyToActorId: post.inReplyToActorId,
  });
}

export async function getStatus(
  ctx: CoreContext,
  viewerActorId: string | null,
  postId: string,
): Promise<Status> {
  const post = await getVisiblePost(ctx, viewerActorId, postId);
  const [status] = await hydrateStatuses(ctx, viewerActorId, [post]);
  if (!status) throw new DomainError('not_found', 'Post not found');
  return status;
}

/** Ancestors (oldest first) and descendants (depth-first, oldest first) visible to the viewer. */
export async function getStatusContext(
  ctx: CoreContext,
  viewerActorId: string | null,
  postId: string,
): Promise<StatusContext> {
  const post = await getVisiblePost(ctx, viewerActorId, postId);
  const rootId = post.threadRootId ?? post.id;
  const thread = await ctx.db
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.threadRootId, rootId),
        visibleTo(viewerActorId),
        isNull(posts.reblogOfId),
        or(eq(posts.id, post.id), notFilteredFor(viewerActorId, 'thread')),
      ),
    )
    .orderBy(posts.id)
    .limit(1000);
  const byId = new Map(thread.map((p) => [p.id, p]));

  const ancestors: PostRow[] = [];
  let cursor = post.inReplyToId ? byId.get(post.inReplyToId) : undefined;
  while (cursor && ancestors.length < 100) {
    ancestors.unshift(cursor);
    cursor = cursor.inReplyToId ? byId.get(cursor.inReplyToId) : undefined;
  }

  const children = new Map<string, PostRow[]>();
  for (const p of thread) {
    if (!p.inReplyToId) continue;
    const list = children.get(p.inReplyToId) ?? [];
    list.push(p);
    children.set(p.inReplyToId, list);
  }
  const descendants: PostRow[] = [];
  const walk = (id: string) => {
    for (const child of children.get(id) ?? []) {
      descendants.push(child);
      walk(child.id);
    }
  };
  walk(post.id);

  return {
    ancestors: await hydrateStatuses(ctx, viewerActorId, ancestors),
    descendants: await hydrateStatuses(ctx, viewerActorId, descendants),
  };
}

export async function reblog(ctx: CoreContext, actorId: string, postId: string): Promise<Status> {
  const actor = await getLocalActor(ctx, actorId);
  let target = await getVisiblePost(ctx, actorId, postId);
  if (target.reblogOfId) target = await getVisiblePost(ctx, actorId, target.reblogOfId);
  if (target.visibility !== 'public' && target.visibility !== 'unlisted') {
    throw new DomainError('forbidden', 'Only public posts can be reshared');
  }
  const id = uuidv7();
  const inserted = await ctx.db
    .insert(posts)
    .values({
      id,
      actorId,
      local: true,
      visibility: target.visibility,
      reblogOfId: target.id,
      threadRootId: id,
      apUri: `${actor.apUri}/statuses/${id}/activity`,
      diasporaGuid: randomBytes(16).toString('hex'),
    })
    .onConflictDoNothing()
    .returning({ id: posts.id });
  if (inserted.length > 0) {
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
  return getStatus(ctx, actorId, target.id);
}

export async function unreblog(ctx: CoreContext, actorId: string, postId: string): Promise<Status> {
  const removed = await ctx.db
    .delete(posts)
    .where(and(eq(posts.actorId, actorId), eq(posts.reblogOfId, postId)))
    .returning({
      id: posts.id,
      apUri: posts.apUri,
      diasporaGuid: posts.diasporaGuid,
      visibility: posts.visibility,
    });
  for (const row of removed) {
    await ctx.db
      .update(posts)
      .set({ reblogsCount: sql`greatest(${posts.reblogsCount} - 1, 0)` })
      .where(eq(posts.id, postId));
    await emit(ctx, {
      type: 'post.deleted',
      postId: row.id,
      actorId,
      apUri: row.apUri,
      diasporaGuid: row.diasporaGuid,
      audienceActorIds: [],
      visibility: row.visibility,
      reblogOfId: postId,
      threadRootId: null,
    });
  }
  return getStatus(ctx, actorId, postId);
}

/** Likes a post. `options.apUri` is the id of an incoming Like activity (remote actor). */
export async function like(
  ctx: CoreContext,
  actorId: string,
  postId: string,
  options: { apUri?: string; diasporaGuid?: string } = {},
): Promise<Status> {
  const post = await getVisiblePost(ctx, actorId, postId);
  if (post.reblogOfId) return like(ctx, actorId, post.reblogOfId, options);
  const [actor] = await ctx.db.select().from(actors).where(eq(actors.id, actorId));
  if (!actor) throw new DomainError('not_found', 'Account not found');
  const id = uuidv7();
  const apUri = options.apUri ?? (actor.domain === null ? `${actor.apUri}#likes/${id}` : null);
  const inserted = await ctx.db
    .insert(likes)
    .values({
      id,
      actorId,
      postId: post.id,
      apUri,
      diasporaGuid: options.diasporaGuid ?? randomBytes(16).toString('hex'),
    })
    .onConflictDoNothing()
    .returning({ id: likes.id });
  if (inserted.length > 0) {
    await ctx.db
      .update(posts)
      .set({ likesCount: sql`${posts.likesCount} + 1` })
      .where(eq(posts.id, post.id));
    await createNotification(ctx, {
      actorId: post.actorId,
      type: 'like',
      fromActorId: actorId,
      postId: post.id,
    });
    await emit(ctx, { type: 'like.created', likeId: id, actorId, postId: post.id, apUri });
  }
  return getStatus(ctx, actorId, post.id);
}

export async function unlike(ctx: CoreContext, actorId: string, postId: string): Promise<Status> {
  const removed = await ctx.db
    .delete(likes)
    .where(and(eq(likes.actorId, actorId), eq(likes.postId, postId)))
    .returning({ id: likes.id, apUri: likes.apUri, diasporaGuid: likes.diasporaGuid });
  const row = removed[0];
  if (row) {
    await ctx.db
      .update(posts)
      .set({ likesCount: sql`greatest(${posts.likesCount} - 1, 0)` })
      .where(eq(posts.id, postId));
    await emit(ctx, {
      type: 'like.removed',
      actorId,
      postId,
      apUri: row.apUri,
      diasporaGuid: row.diasporaGuid,
    });
  }
  return getStatus(ctx, actorId, postId);
}

export async function bookmark(ctx: CoreContext, actorId: string, postId: string): Promise<Status> {
  await getVisiblePost(ctx, actorId, postId);
  await ctx.db.insert(bookmarks).values({ actorId, postId }).onConflictDoNothing();
  return getStatus(ctx, actorId, postId);
}

export async function unbookmark(
  ctx: CoreContext,
  actorId: string,
  postId: string,
): Promise<Status> {
  await ctx.db
    .delete(bookmarks)
    .where(and(eq(bookmarks.actorId, actorId), eq(bookmarks.postId, postId)));
  return getStatus(ctx, actorId, postId);
}
