import { schema } from '@disbigle/db';
import type { PaginationQuery, Status } from '@disbigle/shared';
import { paginationQuerySchema } from '@disbigle/shared';
import { and, eq, gt, isNull, lt, type SQL, sql } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';
import { DomainError } from '../errors.ts';
import { type FilterContext, notFilteredFor } from './filters.ts';
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
  tagFollows,
  groupMembers,
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

/**
 * Whether a new post may go to a viewer's live stream: the timelines' rules (visibility, mutes,
 * blocks, suspended authors, keyword filters, and blocked servers on public streams).
 */
export async function streamableTo(
  ctx: CoreContext,
  viewerActorId: string | null,
  postId: string,
  context: 'home' | 'public',
): Promise<boolean> {
  const [row] = await ctx.db
    .select({ id: posts.id })
    .from(posts)
    .where(
      and(
        eq(posts.id, postId),
        visibleTo(viewerActorId),
        notSilenced(viewerActorId),
        notFilteredFor(viewerActorId, context),
        context === 'public' ? notFromBlockedDomain : undefined,
      ),
    );
  return Boolean(row);
}

async function page(
  ctx: CoreContext,
  viewerActorId: string | null,
  where: SQL | undefined,
  query: PaginationQuery,
  filterContext?: FilterContext,
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
        filterContext ? notFilteredFor(viewerActorId, filterContext) : undefined,
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
 * Home: your own posts, posts of accounts you follow, posts shared with you (diaspora-style
 * limited posts and mentions), public posts with hashtags you follow and new posts in your
 * groups, newest first. What people you follow write in groups stays in those groups.
 */
export function homeTimeline(ctx: CoreContext, viewerActorId: string, query: PaginationQuery = {}) {
  return page(
    ctx,
    viewerActorId,
    sql`(
      ${posts.actorId} = ${viewerActorId}
      or (${posts.groupId} is not null and ${posts.inReplyToId} is null and not ${posts.pendingApproval} and exists (
        select 1 from ${groupMembers} where ${groupMembers.groupId} = ${posts.groupId}
          and ${groupMembers.actorId} = ${viewerActorId} and ${groupMembers.state} = 'member'
      ))
      or (${posts.groupId} is null and exists (select 1 from ${follows} where ${follows.actorId} = ${viewerActorId} and ${follows.targetActorId} = ${posts.actorId}))
      or exists (select 1 from ${postAudiences} where ${postAudiences.postId} = ${posts.id} and ${postAudiences.actorId} = ${viewerActorId})
      or (${posts.visibility} = 'public' and exists (
        select 1 from ${postTags} inner join ${tagFollows} on ${tagFollows.tagId} = ${postTags.tagId}
        where ${postTags.postId} = ${posts.id} and ${tagFollows.actorId} = ${viewerActorId}
      ))
    )`,
    query,
    'home',
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
      isNull(posts.groupId),
      query.local ? eq(posts.local, true) : notFromBlockedDomain,
      sql`(${posts.inReplyToActorId} is null or ${posts.inReplyToActorId} = ${posts.actorId})`,
    ),
    query,
    'public',
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
    'public',
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
    and(
      isNull(posts.groupId),
      sql`exists (select 1 from ${aspectMemberships} where ${aspectMemberships.aspectId} = ${aspectId} and ${aspectMemberships.actorId} = ${posts.actorId})`,
    ),
    query,
    'home',
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
      // Group posts belong to their group, not to the profile.
      isNull(posts.groupId),
      query.excludeReplies
        ? sql`(${posts.inReplyToActorId} is null or ${posts.inReplyToActorId} = ${posts.actorId})`
        : undefined,
    ),
    query,
  );
}

/** Posts started or shared in a group (replies stay in their threads), newest first. */
export function groupTimeline(
  ctx: CoreContext,
  viewerActorId: string | null,
  groupId: string,
  query: PaginationQuery = {},
) {
  return page(
    ctx,
    viewerActorId,
    and(
      eq(posts.groupId, groupId),
      isNull(posts.inReplyToId),
      // Waiting posts are listed apart for moderators; their authors still see their own.
      viewerActorId
        ? sql`(not ${posts.pendingApproval} or ${posts.actorId} = ${viewerActorId})`
        : eq(posts.pendingApproval, false),
    ),
    query,
    'home',
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

/**
 * Full-text search in posts the viewer may see (signed out: public posts only). Words are matched
 * as prefixes, all of them required. Newest first.
 */
export function searchStatuses(
  ctx: CoreContext,
  viewerActorId: string | null,
  text: string,
  query: PaginationQuery = {},
) {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((w) => w.length > 0)
    .slice(0, 8);
  if (words.length === 0) return Promise.resolve([]);
  const tsquery = words.map((w) => `${w}:*`).join(' & ');
  return page(
    ctx,
    viewerActorId,
    and(
      isNull(posts.reblogOfId),
      viewerActorId ? undefined : eq(posts.visibility, 'public'),
      sql`to_tsvector('simple', regexp_replace(${posts.contentHtml} || ' ' || ${posts.summary}, '<[^>]+>', ' ', 'g')) @@ to_tsquery('simple', ${tsquery})`,
    ),
    query,
    'public',
  );
}
