import { schema, uuidv7 } from '@disbigle/db';
import {
  type Album,
  type AlbumRequest,
  type AlbumWithMedia,
  albumRequestSchema,
  MAX_ALBUM_ITEMS,
  MAX_ALBUMS,
  type PaginationQuery,
  type ProfileMedia,
} from '@disbigle/shared';
import { and, count, desc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { serializeAccount } from '../accounts/serialize.ts';
import type { CoreContext } from '../context.ts';
import { DomainError } from '../errors.ts';
import { serializeMedia } from './statuses.ts';
import { visibleTo } from './visibility.ts';

const { actors, albums, albumItems, mediaAttachments, posts } = schema;

type MediaRow = typeof mediaAttachments.$inferSelect;
type AlbumRow = typeof albums.$inferSelect;

/** Photos and videos only: audio has nothing to show in a gallery. */
const pictures = inArray(mediaAttachments.type, ['image', 'video']);

const toProfileMedia = (
  ctx: CoreContext,
  row: { media: MediaRow; sensitive: boolean; createdAt: Date },
): ProfileMedia => ({
  media: serializeMedia(ctx, row.media),
  statusId: row.media.postId ?? '',
  sensitive: row.sensitive,
  createdAt: row.createdAt.toISOString(),
});

/**
 * Photos and videos of an account's posts the viewer may see, newest first. Like the profile,
 * it leaves out reshares and what was written in groups.
 */
export async function accountMedia(
  ctx: CoreContext,
  viewerActorId: string | null,
  accountId: string,
  query: PaginationQuery = {},
): Promise<ProfileMedia[]> {
  const rows = await ctx.db
    .select({ media: mediaAttachments, sensitive: posts.sensitive, createdAt: posts.createdAt })
    .from(mediaAttachments)
    .innerJoin(posts, eq(posts.id, mediaAttachments.postId))
    .where(
      and(
        eq(posts.actorId, accountId),
        isNull(posts.groupId),
        isNull(posts.reblogOfId),
        pictures,
        visibleTo(viewerActorId),
        query.maxId ? lt(mediaAttachments.id, query.maxId) : undefined,
      ),
    )
    .orderBy(desc(mediaAttachments.id))
    .limit(Math.min(Number(query.limit ?? 20) || 20, 40));
  return rows.map((row) => toProfileMedia(ctx, row));
}

/** Count and cover (the latest addition) of each album, among what the viewer may see. */
async function albumSummaries(
  ctx: CoreContext,
  viewerActorId: string | null,
  rows: AlbumRow[],
): Promise<Album[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((a) => a.id);
  const visible = and(inArray(albumItems.albumId, ids), visibleTo(viewerActorId));
  const counts = await ctx.db
    .select({ albumId: albumItems.albumId, n: count() })
    .from(albumItems)
    .innerJoin(mediaAttachments, eq(mediaAttachments.id, albumItems.mediaId))
    .innerJoin(posts, eq(posts.id, mediaAttachments.postId))
    .where(visible)
    .groupBy(albumItems.albumId);
  const covers = await ctx.db
    .selectDistinctOn([albumItems.albumId], {
      albumId: albumItems.albumId,
      media: mediaAttachments,
    })
    .from(albumItems)
    .innerJoin(mediaAttachments, eq(mediaAttachments.id, albumItems.mediaId))
    .innerJoin(posts, eq(posts.id, mediaAttachments.postId))
    .where(and(visible, eq(posts.sensitive, false)))
    .orderBy(albumItems.albumId, desc(albumItems.createdAt));
  const countOf = new Map(counts.map((c) => [c.albumId, c.n]));
  const coverOf = new Map(covers.map((c) => [c.albumId, c.media]));
  return rows.map((album) => {
    const cover = coverOf.get(album.id);
    return {
      id: album.id,
      accountId: album.ownerActorId,
      name: album.name,
      description: album.description,
      mediaCount: countOf.get(album.id) ?? 0,
      cover: cover ? serializeMedia(ctx, cover) : null,
      updatedAt: album.updatedAt.toISOString(),
    };
  });
}

/**
 * The albums of an account, last changed first. Others don't see the albums in which they
 * can see nothing. With `mediaId`, the owner learns which albums hold that attachment.
 */
export async function listAlbums(
  ctx: CoreContext,
  viewerActorId: string | null,
  accountId: string,
  mediaId?: string,
): Promise<Album[]> {
  const rows = await ctx.db
    .select()
    .from(albums)
    .where(eq(albums.ownerActorId, accountId))
    .orderBy(desc(albums.updatedAt));
  const own = viewerActorId === accountId;
  const list = (await albumSummaries(ctx, viewerActorId, rows)).filter(
    (album) => own || album.mediaCount > 0,
  );
  if (!own || !mediaId) return list;
  const holding = await ctx.db
    .select({ albumId: albumItems.albumId })
    .from(albumItems)
    .where(eq(albumItems.mediaId, mediaId));
  const ids = new Set(holding.map((h) => h.albumId));
  return list.map((album) => ({ ...album, includes: ids.has(album.id) }));
}

async function ownedAlbum(ctx: CoreContext, ownerActorId: string, albumId: string) {
  const [album] = await ctx.db
    .select()
    .from(albums)
    .where(and(eq(albums.id, albumId), eq(albums.ownerActorId, ownerActorId)));
  if (!album) throw new DomainError('not_found', 'Album not found');
  return album;
}

/** An album with the photos the viewer may see, latest addition first. */
export async function getAlbum(
  ctx: CoreContext,
  viewerActorId: string | null,
  albumId: string,
): Promise<AlbumWithMedia> {
  const [album] = await ctx.db.select().from(albums).where(eq(albums.id, albumId));
  if (!album) throw new DomainError('not_found', 'Album not found');
  const [summary] = await albumSummaries(ctx, viewerActorId, [album]);
  if (!summary || (summary.mediaCount === 0 && viewerActorId !== album.ownerActorId)) {
    throw new DomainError('not_found', 'Album not found');
  }
  const rows = await ctx.db
    .select({ media: mediaAttachments, sensitive: posts.sensitive, createdAt: posts.createdAt })
    .from(albumItems)
    .innerJoin(mediaAttachments, eq(mediaAttachments.id, albumItems.mediaId))
    .innerJoin(posts, eq(posts.id, mediaAttachments.postId))
    .where(and(eq(albumItems.albumId, albumId), visibleTo(viewerActorId)))
    .orderBy(desc(albumItems.createdAt))
    .limit(MAX_ALBUM_ITEMS);
  const [owner] = await ctx.db.select().from(actors).where(eq(actors.id, album.ownerActorId));
  if (!owner || owner.suspendedAt) throw new DomainError('not_found', 'Album not found');
  return {
    ...summary,
    account: serializeAccount(owner),
    items: rows.map((row) => toProfileMedia(ctx, row)),
  };
}

export async function createAlbum(
  ctx: CoreContext,
  ownerActorId: string,
  request: AlbumRequest,
): Promise<Album> {
  const { name, description } = albumRequestSchema.parse(request);
  const [{ n } = { n: 0 }] = await ctx.db
    .select({ n: count() })
    .from(albums)
    .where(eq(albums.ownerActorId, ownerActorId));
  if (n >= MAX_ALBUMS) {
    throw new DomainError('bad_request', `You can have up to ${MAX_ALBUMS} albums`);
  }
  const [album] = await ctx.db
    .insert(albums)
    .values({ id: uuidv7(), ownerActorId, name, description })
    .returning();
  if (!album) throw new Error('Insert failed');
  const [summary] = await albumSummaries(ctx, ownerActorId, [album]);
  if (!summary) throw new Error('Insert failed');
  return summary;
}

export async function updateAlbum(
  ctx: CoreContext,
  ownerActorId: string,
  albumId: string,
  request: AlbumRequest,
): Promise<Album> {
  await ownedAlbum(ctx, ownerActorId, albumId);
  const { name, description } = albumRequestSchema.parse(request);
  const [album] = await ctx.db
    .update(albums)
    .set({ name, description, updatedAt: new Date() })
    .where(eq(albums.id, albumId))
    .returning();
  if (!album) throw new DomainError('not_found', 'Album not found');
  const [summary] = await albumSummaries(ctx, ownerActorId, [album]);
  if (!summary) throw new DomainError('not_found', 'Album not found');
  return summary;
}

/** Deletes the album; the photos stay in their posts. */
export async function deleteAlbum(ctx: CoreContext, ownerActorId: string, albumId: string) {
  await ownedAlbum(ctx, ownerActorId, albumId);
  await ctx.db.delete(albums).where(eq(albums.id, albumId));
}

/** Adds a photo or video of one of the owner's own posts. */
export async function addToAlbum(
  ctx: CoreContext,
  ownerActorId: string,
  albumId: string,
  mediaId: string,
) {
  await ownedAlbum(ctx, ownerActorId, albumId);
  const [media] = await ctx.db
    .select({ id: mediaAttachments.id })
    .from(mediaAttachments)
    .innerJoin(posts, eq(posts.id, mediaAttachments.postId))
    .where(
      and(
        eq(mediaAttachments.id, mediaId),
        eq(posts.actorId, ownerActorId),
        isNotNull(mediaAttachments.postId),
        pictures,
      ),
    );
  if (!media) throw new DomainError('not_found', 'Media not found');
  const [{ n } = { n: 0 }] = await ctx.db
    .select({ n: count() })
    .from(albumItems)
    .where(eq(albumItems.albumId, albumId));
  if (n >= MAX_ALBUM_ITEMS) {
    throw new DomainError('bad_request', `An album holds up to ${MAX_ALBUM_ITEMS} items`);
  }
  await ctx.db.insert(albumItems).values({ albumId, mediaId }).onConflictDoNothing();
  await ctx.db.update(albums).set({ updatedAt: sql`now()` }).where(eq(albums.id, albumId));
}

export async function removeFromAlbum(
  ctx: CoreContext,
  ownerActorId: string,
  albumId: string,
  mediaId: string,
) {
  await ownedAlbum(ctx, ownerActorId, albumId);
  await ctx.db
    .delete(albumItems)
    .where(and(eq(albumItems.albumId, albumId), eq(albumItems.mediaId, mediaId)));
}
