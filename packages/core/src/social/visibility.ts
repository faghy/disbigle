import { schema } from '@disbigle/db';
import { and, eq, type SQL, sql } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';

const { posts, postAudiences, follows, blocks } = schema;

/**
 * SQL condition: the post is visible to `viewerActorId` (null = signed out).
 * This is the single source of truth for read access; `canView` uses the same rule.
 *
 * - public / unlisted: everyone, unless the author blocks the viewer
 * - followers: the author, current followers, and explicit recipients (mentions)
 * - limited / direct: the author and explicit recipients only
 */
export function visibleTo(viewerActorId: string | null): SQL {
  if (!viewerActorId) return sql`${posts.visibility} in ('public', 'unlisted')`;
  return sql`(
    (
      ${posts.visibility} in ('public', 'unlisted')
      or ${posts.actorId} = ${viewerActorId}
      or exists (
        select 1 from ${postAudiences}
        where ${postAudiences.postId} = ${posts.id} and ${postAudiences.actorId} = ${viewerActorId}
      )
      or (
        ${posts.visibility} = 'followers' and exists (
          select 1 from ${follows}
          where ${follows.actorId} = ${viewerActorId} and ${follows.targetActorId} = ${posts.actorId}
        )
      )
    )
    and not exists (
      select 1 from ${blocks}
      where ${blocks.actorId} = ${posts.actorId} and ${blocks.targetActorId} = ${viewerActorId}
    )
  )`;
}

export async function canView(
  ctx: CoreContext,
  viewerActorId: string | null,
  postId: string,
): Promise<boolean> {
  const [row] = await ctx.db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.id, postId), visibleTo(viewerActorId)));
  return Boolean(row);
}
