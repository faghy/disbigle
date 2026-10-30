import { schema } from '@disbigle/db';
import { and, eq, type SQL, sql } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';

const { posts, postAudiences, follows, blocks, groups, groupMembers } = schema;

/**
 * SQL condition: the post is visible to `viewerActorId` (null = signed out).
 * This is the single source of truth for read access; `canView` uses the same rule.
 *
 * - public / unlisted: everyone, unless the author blocks the viewer
 * - followers: the author, current followers, and explicit recipients (mentions)
 * - limited / direct: the author and explicit recipients only
 * - in a group, the group decides: public groups are read by everyone, the others by their
 *   members (and the author) only, whatever the post's own visibility says
 * - a group post waiting for approval: its author and the group's moderators only
 */
export function visibleTo(viewerActorId: string | null): SQL {
  const publicGroup = sql`exists (select 1 from ${groups} where ${groups.id} = ${posts.groupId} and ${groups.privacy} = 'public')`;
  if (!viewerActorId)
    return sql`(
      (${posts.groupId} is null and ${posts.visibility} in ('public', 'unlisted'))
      or (${posts.groupId} is not null and not ${posts.pendingApproval} and ${publicGroup})
    )`;
  const moderator = sql`exists (
    select 1 from ${groupMembers}
    where ${groupMembers.groupId} = ${posts.groupId} and ${groupMembers.actorId} = ${viewerActorId}
      and ${groupMembers.state} = 'member' and ${groupMembers.role} in ('admin', 'moderator')
  )`;
  const inGroup = sql`(
    ${posts.actorId} = ${viewerActorId}
    or (${posts.pendingApproval} and ${moderator})
    or (not ${posts.pendingApproval} and ${publicGroup})
    or (not ${posts.pendingApproval} and exists (
      select 1 from ${groupMembers}
      where ${groupMembers.groupId} = ${posts.groupId} and ${groupMembers.actorId} = ${viewerActorId}
        and ${groupMembers.state} = 'member'
    ))
  )`;
  const outsideGroups = sql`(
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
  )`;
  return sql`(
    (
      (${posts.groupId} is not null and ${inGroup})
      or (${posts.groupId} is null and ${outsideGroups})
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
