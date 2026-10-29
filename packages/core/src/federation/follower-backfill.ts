import { schema } from '@disbigle/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';

const { posts } = schema;

/** How many recent posts a new remote follower receives. */
export const FOLLOWER_BACKFILL_POSTS = 5;
const AGAIN_AFTER_SECONDS = 7 * 24 * 60 * 60;

/**
 * The latest public posts of a local account, oldest first, for someone on another server who
 * just started following it: without them the profile looks empty there until the next post.
 * Returns nothing when the same follower got them in the last week (follow, unfollow, follow…).
 */
export async function postsForNewFollower(
  ctx: CoreContext,
  protocol: 'activitypub' | 'diaspora',
  followerId: string,
  localActorId: string,
): Promise<(typeof posts.$inferSelect)[]> {
  const key = `follower-backfill:${protocol}:${followerId}:${localActorId}`;
  if (await ctx.kv.get(key)) return [];
  await ctx.kv.set(key, '1', AGAIN_AFTER_SECONDS);
  const rows = await ctx.db
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.actorId, localActorId),
        eq(posts.local, true),
        eq(posts.visibility, 'public'),
        isNull(posts.inReplyToId),
        isNull(posts.reblogOfId),
        isNull(posts.groupId),
      ),
    )
    .orderBy(desc(posts.id))
    .limit(FOLLOWER_BACKFILL_POSTS);
  return rows.reverse();
}
