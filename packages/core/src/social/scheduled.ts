import { schema, uuidv7 } from '@disbigle/db';
import {
  type CreatePostRequest,
  createPostRequestSchema,
  MAX_SCHEDULED_POSTS,
  MAX_SCHEDULED_POSTS_PER_DAY,
  SCHEDULE_MAX_DAYS,
  SCHEDULE_MIN_LEAD_SECONDS,
  type ScheduledPost,
} from '@disbigle/shared';
import { and, asc, eq, inArray, isNull, lt, lte, ne, sql } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';
import { DomainError } from '../errors.ts';
import { extractMentions } from './content.ts';
import { findGroup, isGroupMember } from './groups.ts';
import { createPost, getVisiblePost, previewPostContent } from './posts.ts';
import { serializeMedia } from './statuses.ts';

/**
 * Scheduled posts (issue #28). They live in their own table, so timelines, search and
 * `canView` never see them; the worker turns each into an ordinary post at its time, through
 * `createPost`, so federation, mentions and notifications work as for any post.
 */

const { scheduledPosts, mediaAttachments } = schema;
type Row = typeof scheduledPosts.$inferSelect;

/** How many due posts the worker publishes per run: a peak becomes a short delay, not a load. */
export const SCHEDULED_BATCH = 100;
/** A claim older than this was interrupted (the worker stopped): the post is marked failed. */
const STALE_CLAIM_MS = 10 * 60 * 1000;

const invalid = (path: string, message: string) =>
  new DomainError('validation_failed', message, [{ path, message }]);

function checkTime(scheduledAt: Date, now = new Date()) {
  if (Number.isNaN(scheduledAt.getTime())) throw invalid('scheduledAt', 'Invalid time');
  if (scheduledAt.getTime() < now.getTime() + SCHEDULE_MIN_LEAD_SECONDS * 1000) {
    throw invalid('scheduledAt', 'Choose a time at least 5 minutes from now');
  }
  if (scheduledAt.getTime() > now.getTime() + SCHEDULE_MAX_DAYS * 24 * 3600 * 1000) {
    throw invalid('scheduledAt', `Choose a time within ${SCHEDULE_MAX_DAYS} days`);
  }
}

/** The limits: posts waiting in all, and on the same (UTC) day. */
async function checkLimits(ctx: CoreContext, actorId: string, scheduledAt: Date, except?: string) {
  const mine = and(
    eq(scheduledPosts.actorId, actorId),
    except ? ne(scheduledPosts.id, except) : undefined,
  );
  const [all] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(scheduledPosts)
    .where(mine);
  if (!except && (all?.count ?? 0) >= MAX_SCHEDULED_POSTS) {
    throw invalid('scheduledAt', `You can have at most ${MAX_SCHEDULED_POSTS} scheduled posts`);
  }
  const day = scheduledAt.toISOString().slice(0, 10);
  const [sameDay] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(scheduledPosts)
    .where(and(mine, sql`(${scheduledPosts.scheduledAt} at time zone 'UTC')::date = ${day}::date`));
  if ((sameDay?.count ?? 0) >= MAX_SCHEDULED_POSTS_PER_DAY) {
    throw invalid(
      'scheduledAt',
      `You can schedule at most ${MAX_SCHEDULED_POSTS_PER_DAY} posts on the same day`,
    );
  }
}

/**
 * Media of a scheduled post: yours, not in a post yet and not kept by another scheduled post.
 * Kept media are skipped by the cleanup of unused uploads (see `reservedMedia`).
 */
async function checkMedia(ctx: CoreContext, actorId: string, mediaIds: string[]) {
  if (mediaIds.length === 0) return;
  const owned = await ctx.db
    .select({ id: mediaAttachments.id })
    .from(mediaAttachments)
    .where(
      and(
        inArray(mediaAttachments.id, mediaIds),
        eq(mediaAttachments.actorId, actorId),
        isNull(mediaAttachments.postId),
        sql`not ${reservedMedia(mediaAttachments.id)}`,
      ),
    );
  if (owned.length !== new Set(mediaIds).size)
    throw new DomainError('not_found', 'Media not found');
}

/** SQL: the media id is kept by a scheduled post. */
export function reservedMedia(mediaId: typeof mediaAttachments.id) {
  return sql`exists (select 1 from ${scheduledPosts}
    where jsonb_exists(${scheduledPosts.params}->'mediaIds', ${mediaId}::text))`;
}

/**
 * What can be checked now rather than at publishing time, so most mistakes show while writing:
 * the post being answered, the group, the aspects and the people of a private message.
 */
async function checkPost(ctx: CoreContext, actorId: string, params: ScheduledPost['params']) {
  const parent = params.inReplyToId ? await getVisiblePost(ctx, actorId, params.inReplyToId) : null;
  if (params.groupId) {
    const group = await findGroup(ctx, params.groupId);
    if (!group) throw new DomainError('not_found', 'Group not found');
    if (!(await isGroupMember(ctx, group.group.id, actorId)))
      throw new DomainError('forbidden', 'Join the group to write in it');
  }
  if (!parent && !params.groupId) {
    if (params.visibility === 'limited' && params.aspectIds.length === 0)
      throw invalid('aspectIds', 'Choose at least one aspect');
    if (params.visibility === 'direct' && extractMentions(params.content).length === 0)
      throw invalid('content', 'Mention at least one person');
  }
  await checkMedia(ctx, actorId, params.mediaIds);
  // Looks up people of other servers now: the worker publishing it cannot reach out for them.
  await previewPostContent(ctx, params.content);
}

async function serialize(ctx: CoreContext, rows: Row[]): Promise<ScheduledPost[]> {
  const mediaIds = rows.flatMap((row) => (row.params.mediaIds as string[] | undefined) ?? []);
  const media =
    mediaIds.length > 0
      ? await ctx.db.select().from(mediaAttachments).where(inArray(mediaAttachments.id, mediaIds))
      : [];
  const mediaById = new Map(media.map((m) => [m.id, serializeMedia(ctx, m)]));
  return rows.map((row) => {
    const params = createPostRequestSchema.parse(row.params);
    return {
      id: row.id,
      scheduledAt: row.scheduledAt.toISOString(),
      params,
      media: params.mediaIds.flatMap((id) => mediaById.get(id) ?? []),
      failed: row.failedAt !== null,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

async function findOwn(ctx: CoreContext, actorId: string, id: string): Promise<Row> {
  const [row] = await ctx.db
    .select()
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.id, id), eq(scheduledPosts.actorId, actorId)));
  if (!row) throw new DomainError('not_found', 'Scheduled post not found');
  return row;
}

/** Keeps a post to publish at `scheduledAt` (5 minutes to 90 days from now). */
export async function schedulePost(
  ctx: CoreContext,
  actorId: string,
  request: CreatePostRequest,
  scheduledAt: Date,
): Promise<ScheduledPost> {
  const params = createPostRequestSchema.parse(request);
  checkTime(scheduledAt);
  await checkLimits(ctx, actorId, scheduledAt);
  await checkPost(ctx, actorId, params);
  const [row] = await ctx.db
    .insert(scheduledPosts)
    .values({ id: uuidv7(), actorId, scheduledAt, params })
    .returning();
  if (!row) throw new Error('Scheduled post vanished after insert');
  const [post] = await serialize(ctx, [row]);
  if (!post) throw new Error('Serialization failed');
  return post;
}

/** Your scheduled posts, the next first (at most 300 exist). */
export async function listScheduledPosts(
  ctx: CoreContext,
  actorId: string,
): Promise<ScheduledPost[]> {
  const rows = await ctx.db
    .select()
    .from(scheduledPosts)
    .where(eq(scheduledPosts.actorId, actorId))
    .orderBy(asc(scheduledPosts.scheduledAt), asc(scheduledPosts.id));
  return serialize(ctx, rows);
}

export async function getScheduledPost(
  ctx: CoreContext,
  actorId: string,
  id: string,
): Promise<ScheduledPost> {
  const [post] = await serialize(ctx, [await findOwn(ctx, actorId, id)]);
  if (!post) throw new Error('Serialization failed');
  return post;
}

/** A new time; a post that had failed is tried again then. */
export async function rescheduleScheduledPost(
  ctx: CoreContext,
  actorId: string,
  id: string,
  scheduledAt: Date,
): Promise<ScheduledPost> {
  const row = await findOwn(ctx, actorId, id);
  if (row.claimedAt && !row.failedAt)
    throw new DomainError('conflict', 'The post is being published');
  checkTime(scheduledAt);
  await checkLimits(ctx, actorId, scheduledAt, id);
  await ctx.db
    .update(scheduledPosts)
    .set({ scheduledAt, failedAt: null, claimedAt: null, error: '' })
    .where(eq(scheduledPosts.id, id));
  return getScheduledPost(ctx, actorId, id);
}

/** Cancels it; its media go back to the unused uploads (removed after a day). */
export async function deleteScheduledPost(ctx: CoreContext, actorId: string, id: string) {
  const row = await findOwn(ctx, actorId, id);
  if (row.claimedAt && !row.failedAt)
    throw new DomainError('conflict', 'The post is being published');
  await ctx.db.delete(scheduledPosts).where(eq(scheduledPosts.id, id));
}

/**
 * The worker's job, every minute: publishes the posts whose time has come, at most `limit`
 * per run, the oldest first. Each is claimed before publishing, so a second worker skips it;
 * once published the row is deleted. A post that cannot be published (the group was left,
 * the post answered was deleted...) stays, marked failed with the reason, for its author.
 */
export async function publishDueScheduledPosts(
  ctx: CoreContext,
  { limit = SCHEDULED_BATCH, now = new Date() }: { limit?: number; now?: Date } = {},
): Promise<{ published: number; failed: number }> {
  // Claimed but never finished: the worker stopped halfway. Publishing again could make a
  // duplicate, so the author decides.
  await ctx.db
    .update(scheduledPosts)
    .set({ failedAt: now, claimedAt: null, error: 'interrupted' })
    .where(
      and(
        isNull(scheduledPosts.failedAt),
        lt(scheduledPosts.claimedAt, new Date(now.getTime() - STALE_CLAIM_MS)),
      ),
    );

  const claimed = await ctx.db
    .update(scheduledPosts)
    .set({ claimedAt: now })
    .where(
      inArray(
        scheduledPosts.id,
        ctx.db
          .select({ id: scheduledPosts.id })
          .from(scheduledPosts)
          .where(
            and(
              lte(scheduledPosts.scheduledAt, now),
              isNull(scheduledPosts.failedAt),
              isNull(scheduledPosts.claimedAt),
            ),
          )
          .orderBy(asc(scheduledPosts.scheduledAt))
          .limit(limit)
          .for('update', { skipLocked: true }),
      ),
    )
    .returning();
  claimed.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

  let published = 0;
  let failed = 0;
  for (const row of claimed) {
    try {
      await createPost(ctx, row.actorId, row.params as CreatePostRequest);
      await ctx.db.delete(scheduledPosts).where(eq(scheduledPosts.id, row.id));
      published++;
    } catch (error) {
      failed++;
      await ctx.db
        .update(scheduledPosts)
        .set({
          failedAt: new Date(),
          claimedAt: null,
          error: error instanceof Error ? error.message.slice(0, 500) : 'failed',
        })
        .where(eq(scheduledPosts.id, row.id));
    }
  }
  return { published, failed };
}
