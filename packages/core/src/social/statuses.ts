import { schema } from '@disbigle/db';
import type { MediaAttachment, Status } from '@disbigle/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { serializeAccount } from '../accounts/serialize.ts';
import type { CoreContext } from '../context.ts';

export type PostRow = typeof schema.posts.$inferSelect;
type MediaRow = typeof schema.mediaAttachments.$inferSelect;

const { posts, actors, mentions, tags, postTags, mediaAttachments, likes, bookmarks, postAspects } =
  schema;

export function mediaUrl(ctx: CoreContext, path: string): string {
  return `${ctx.config.PUBLIC_URL}/media/${path}`;
}

export function serializeMedia(ctx: CoreContext, media: MediaRow): MediaAttachment {
  return {
    id: media.id,
    type: media.type,
    url: media.filePath ? mediaUrl(ctx, media.filePath) : (media.remoteUrl ?? ''),
    previewUrl: media.previewPath ? mediaUrl(ctx, media.previewPath) : (media.remoteUrl ?? null),
    description: media.description,
    width: media.width,
    height: media.height,
    blurhash: media.blurhash,
  };
}

/** Turns post rows into API statuses, loading related data in a fixed number of queries. */
export async function hydrateStatuses(
  ctx: CoreContext,
  viewerActorId: string | null,
  rows: PostRow[],
): Promise<Status[]> {
  if (rows.length === 0) return [];
  const { db } = ctx;

  const reblogIds = [
    ...new Set(rows.map((r) => r.reblogOfId).filter((id): id is string => id !== null)),
  ];
  const originals =
    reblogIds.length > 0 ? await db.select().from(posts).where(inArray(posts.id, reblogIds)) : [];
  const all = [...rows, ...originals];
  const postIds = [...new Set(all.map((p) => p.id))];
  const actorIds = [...new Set(all.map((p) => p.actorId))];

  const [
    actorRows,
    mentionRows,
    tagRows,
    mediaRows,
    likedRows,
    rebloggedRows,
    bookmarkedRows,
    aspectRows,
  ] = await Promise.all([
    db.select().from(actors).where(inArray(actors.id, actorIds)),
    db
      .select({ postId: mentions.postId, actor: actors })
      .from(mentions)
      .innerJoin(actors, eq(actors.id, mentions.actorId))
      .where(inArray(mentions.postId, postIds)),
    db
      .select({ postId: postTags.postId, name: tags.name })
      .from(postTags)
      .innerJoin(tags, eq(tags.id, postTags.tagId))
      .where(inArray(postTags.postId, postIds)),
    db
      .select()
      .from(mediaAttachments)
      .where(inArray(mediaAttachments.postId, postIds))
      .orderBy(mediaAttachments.position),
    viewerActorId
      ? db
          .select({ postId: likes.postId })
          .from(likes)
          .where(and(eq(likes.actorId, viewerActorId), inArray(likes.postId, postIds)))
      : [],
    viewerActorId
      ? db
          .select({ postId: posts.reblogOfId })
          .from(posts)
          .where(and(eq(posts.actorId, viewerActorId), inArray(posts.reblogOfId, postIds)))
      : [],
    viewerActorId
      ? db
          .select({ postId: bookmarks.postId })
          .from(bookmarks)
          .where(and(eq(bookmarks.actorId, viewerActorId), inArray(bookmarks.postId, postIds)))
      : [],
    viewerActorId
      ? db
          .select({ postId: postAspects.postId, aspectId: postAspects.aspectId })
          .from(postAspects)
          .innerJoin(posts, eq(posts.id, postAspects.postId))
          .where(and(eq(posts.actorId, viewerActorId), inArray(postAspects.postId, postIds)))
      : [],
  ]);

  const actorsById = new Map(actorRows.map((a) => [a.id, serializeAccount(a)]));
  const liked = new Set(likedRows.map((r) => r.postId));
  const reblogged = new Set(rebloggedRows.map((r) => r.postId));
  const bookmarked = new Set(bookmarkedRows.map((r) => r.postId));
  const originalsById = new Map(originals.map((p) => [p.id, p]));

  const serialize = (post: PostRow): Status => {
    const account = actorsById.get(post.actorId);
    if (!account) throw new Error(`Missing actor ${post.actorId}`);
    const original = post.reblogOfId ? originalsById.get(post.reblogOfId) : undefined;
    const status: Status = {
      id: post.id,
      uri: post.apUri,
      url: post.apUrl,
      createdAt: post.createdAt.toISOString(),
      editedAt: post.editedAt?.toISOString() ?? null,
      account,
      content: post.contentHtml,
      summary: post.summary,
      sensitive: post.sensitive,
      visibility: post.visibility,
      language: post.language,
      inReplyToId: post.inReplyToId,
      inReplyToAccountId: post.inReplyToActorId,
      reblog: original ? serialize(original) : null,
      repliesCount: post.repliesCount,
      reblogsCount: post.reblogsCount,
      likesCount: post.likesCount,
      mentions: mentionRows
        .filter((m) => m.postId === post.id)
        .map((m) => {
          const a = serializeAccount(m.actor);
          return { id: a.id, username: a.username, acct: a.acct, url: a.url };
        }),
      tags: tagRows.filter((t) => t.postId === post.id).map((t) => ({ name: t.name })),
      media: mediaRows.filter((m) => m.postId === post.id).map((m) => serializeMedia(ctx, m)),
      liked: liked.has(post.id),
      reblogged: reblogged.has(post.id),
      bookmarked: bookmarked.has(post.id),
    };
    if (post.actorId === viewerActorId && post.visibility === 'limited') {
      status.aspectIds = aspectRows.filter((r) => r.postId === post.id).map((r) => r.aspectId);
    }
    return status;
  };

  return rows.map(serialize);
}
