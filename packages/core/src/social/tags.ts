import { schema, uuidv7 } from '@disbigle/db';
import { and, eq, sql } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';
import { DomainError } from '../errors.ts';

const { tags, tagFollows, postTags } = schema;

export interface TagInfo {
  name: string;
  following: boolean;
  postsCount: number;
}

const normalize = (name: string) => {
  const tag = name.replace(/^#/, '').toLowerCase();
  if (!/^[\p{L}\p{N}_]{1,100}$/u.test(tag) || /^\d+$/.test(tag)) {
    throw new DomainError('validation_failed', 'Invalid hashtag', [
      { path: 'name', message: 'Invalid hashtag' },
    ]);
  }
  return tag;
};

export async function getTag(
  ctx: CoreContext,
  viewerActorId: string | null,
  name: string,
): Promise<TagInfo> {
  const tag = normalize(name);
  const [row] = await ctx.db.select().from(tags).where(eq(tags.name, tag));
  if (!row) return { name: tag, following: false, postsCount: 0 };
  const [[count], following] = await Promise.all([
    ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(postTags)
      .where(eq(postTags.tagId, row.id)),
    viewerActorId
      ? ctx.db
          .select({ id: tagFollows.tagId })
          .from(tagFollows)
          .where(and(eq(tagFollows.tagId, row.id), eq(tagFollows.actorId, viewerActorId)))
      : Promise.resolve([]),
  ]);
  return { name: tag, following: following.length > 0, postsCount: count?.n ?? 0 };
}

export async function followTag(ctx: CoreContext, actorId: string, name: string): Promise<TagInfo> {
  const tag = normalize(name);
  await ctx.db.insert(tags).values({ id: uuidv7(), name: tag }).onConflictDoNothing();
  const [row] = await ctx.db.select().from(tags).where(eq(tags.name, tag));
  if (!row) throw new Error('Tag insert failed');
  await ctx.db.insert(tagFollows).values({ actorId, tagId: row.id }).onConflictDoNothing();
  return getTag(ctx, actorId, tag);
}

export async function unfollowTag(
  ctx: CoreContext,
  actorId: string,
  name: string,
): Promise<TagInfo> {
  const tag = normalize(name);
  const [row] = await ctx.db.select().from(tags).where(eq(tags.name, tag));
  if (row) {
    await ctx.db
      .delete(tagFollows)
      .where(and(eq(tagFollows.actorId, actorId), eq(tagFollows.tagId, row.id)));
  }
  return getTag(ctx, actorId, tag);
}

export async function listFollowedTags(ctx: CoreContext, actorId: string): Promise<string[]> {
  const rows = await ctx.db
    .select({ name: tags.name })
    .from(tagFollows)
    .innerJoin(tags, eq(tags.id, tagFollows.tagId))
    .where(eq(tagFollows.actorId, actorId))
    .orderBy(tags.name);
  return rows.map((r) => r.name);
}

/** Hashtags starting with `prefix`, most used first, with whether the viewer follows them. */
export async function searchTags(
  ctx: CoreContext,
  viewerActorId: string | null,
  prefix: string,
  limit = 20,
): Promise<TagInfo[]> {
  const term = prefix.replace(/^#/, '').toLowerCase();
  if (!/^[\p{L}\p{N}_]{1,100}$/u.test(term)) return [];
  const rows = await ctx.db
    .select({
      id: tags.id,
      name: tags.name,
      postsCount: sql<number>`(select count(*)::int from ${postTags} where ${postTags.tagId} = ${tags.id})`,
    })
    .from(tags)
    .where(sql`${tags.name} like ${`${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`}`)
    .orderBy(sql`3 desc`, tags.name)
    .limit(Math.min(limit, 40));
  const followed = viewerActorId
    ? new Set(
        (
          await ctx.db
            .select({ id: tagFollows.tagId })
            .from(tagFollows)
            .where(eq(tagFollows.actorId, viewerActorId))
        ).map((r) => r.id),
      )
    : new Set<string>();
  return rows.map((r) => ({
    name: r.name,
    postsCount: r.postsCount,
    following: followed.has(r.id),
  }));
}
