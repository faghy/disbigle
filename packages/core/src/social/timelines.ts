import { schema } from '@disbigle/db';
import type { PaginationQuery, Status } from '@disbigle/shared';
import { paginationQuerySchema } from '@disbigle/shared';
import { and, eq, gt, isNull, lt, type SQL, sql } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';
import { DomainError } from '../errors.ts';
import { hydrateStatuses } from './statuses.ts';
import { visibleTo } from './visibility.ts';

const {
  posts,
  follows,
  postAudiences,
  mutes,
  blocks,
  actors,
  postTags,
  tags,
  aspects,
  aspectMemberships,
  bookmarks,
  domainBlocks,
} = schema;

/** Excludes posts from servers the admins silenced or suspended (public and tag timelines). */
const notFromBlockedDomain = sql`not exists (
  select 1 from ${actors} inner join ${domainBlocks} on ${domainBlocks.domain} = lower(${actors.domain})
  where ${actors.id} = ${posts.actorId}
)`;

/** Hides posts from accounts the viewer muted or blocked, and from suspended accounts. */
function notSilenced(viewerActorId: string | null): SQL {
  const suspended = sql`not exists (select 1 from ${actors} where ${actors.id} = ${posts.actorId} and ${actors.suspendedAt} is not null)`;
  if (!viewerActorId) return suspended;
  return sql`(${suspended}
    and not exists (select 1 from ${mutes} where ${mutes.actorId} = ${viewerActorId} and ${mutes.targetActorId} = ${posts.actorId})
    and not exists (select 1 from ${blocks} where ${blocks.actorId} = ${viewerActorId} and ${blocks.targetActorId} = ${posts.actorId}))`;
}

async function page(
  ctx: CoreContext,
  viewerActorId: string | null,
  where: SQL | undefined,
  query: PaginationQuery,
): Promise<Status[]> {
  const { maxId, minId, limit } = paginationQuerySchema.parse(query);
  const rows = await ctx.db
    .select()
    .from(posts)
    .where(
      and(
        where,
        visibleTo(viewerActorId),
        notSilenced(viewerActorId),
        maxId ? lt(posts.id, maxId) : undefined,
        minId ? gt(posts.id, minId) : undefined,
      ),
    )
    .orderBy(minId ? posts.id : sql`${posts.id} desc`)
    .limit(limit);
  if (minId) rows.reverse();
  return hydrateStatuses(ctx, viewerActorId, rows);
}

/**
 * Home: your own posts, posts of accounts you follow, and posts shared with you
 * (diaspora-style limited posts and mentions), newest first.
 */
export function homeTimeline(ctx: CoreContext, viewerActorId: string, query: PaginationQuery = {}) {
  return page(
    ctx,
    viewerActorId,
    sql`(
      ${posts.actorId} = ${viewerActorId}
      or exists (select 1 from ${follows} where ${follows.actorId} = ${viewerActorId} and ${follows.targetActorId} = ${posts.actorId})
      or exists (select 1 from ${postAudiences} where ${postAudiences.postId} = ${posts.id} and ${postAudiences.actorId} = ${viewerActorId})
    )`,
    query,
  );
}

/** Public posts (not unlisted, not replies to others), optionally local only. */
export function publicTimeline(
  ctx: CoreContext,
  viewerActorId: string | null,
  query: PaginationQuery & { local?: boolean } = {},
) {
  return page(
    ctx,
    viewerActorId,
    and(
      eq(posts.visibility, 'public'),
      isNull(posts.reblogOfId),
      query.local ? eq(posts.local, true) : notFromBlockedDomain,
      sql`(${posts.inReplyToActorId} is null or ${posts.inReplyToActorId} = ${posts.actorId})`,
    ),
    query,
  );
}

export function tagTimeline(
  ctx: CoreContext,
  viewerActorId: string | null,
  tag: string,
  query: PaginationQuery = {},
) {
  return page(
    ctx,
    viewerActorId,
    and(
      eq(posts.visibility, 'public'),
      notFromBlockedDomain,
      sql`exists (select 1 from ${postTags} inner join ${tags} on ${tags.id} = ${postTags.tagId}
        where ${postTags.postId} = ${posts.id} and ${tags.name} = ${tag.toLowerCase()})`,
    ),
    query,
  );
}

/** Posts by the members of one of your aspects (what diaspora shows when you select an aspect). */
export async function aspectTimeline(
  ctx: CoreContext,
  ownerActorId: string,
  aspectId: string,
  query: PaginationQuery = {},
) {
  const [aspect] = await ctx.db
    .select({ id: aspects.id })
    .from(aspects)
    .where(and(eq(aspects.id, aspectId), eq(aspects.ownerActorId, ownerActorId)));
  if (!aspect) throw new DomainError('not_found', 'Aspect not found');
  return page(
    ctx,
    ownerActorId,
    sql`exists (select 1 from ${aspectMemberships} where ${aspectMemberships.aspectId} = ${aspectId} and ${aspectMemberships.actorId} = ${posts.actorId})`,
    query,
  );
}

export function accountTimeline(
  ctx: CoreContext,
  viewerActorId: string | null,
  accountId: string,
  query: PaginationQuery & { excludeReplies?: boolean } = {},
) {
  return page(
    ctx,
    viewerActorId,
    and(
      eq(posts.actorId, accountId),
      query.excludeReplies
        ? sql`(${posts.inReplyToActorId} is null or ${posts.inReplyToActorId} = ${posts.actorId})`
        : undefined,
    ),
    query,
  );
}

export function bookmarksTimeline(
  ctx: CoreContext,
  viewerActorId: string,
  query: PaginationQuery = {},
) {
  return page(
    ctx,
    viewerActorId,
    sql`exists (select 1 from ${bookmarks} where ${bookmarks.actorId} = ${viewerActorId} and ${bookmarks.postId} = ${posts.id})`,
    query,
  );
}
