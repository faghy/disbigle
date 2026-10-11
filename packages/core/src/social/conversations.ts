import { schema } from '@disbigle/db';
import type { Account, Conversation } from '@disbigle/shared';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { serializeAccount } from '../accounts/serialize.ts';
import type { CoreContext } from '../context.ts';
import { hydrateStatuses } from './statuses.ts';
import { visibleTo } from './visibility.ts';

const { posts, postAudiences, actors } = schema;

export type { Conversation };

/**
 * Private conversations of the viewer: threads of direct posts they wrote or received, newest
 * activity first. Paginate with `maxId` = the `lastStatus.id` of the last item.
 */
export async function listConversations(
  ctx: CoreContext,
  viewerActorId: string,
  options: { maxId?: string; limit?: number } = {},
): Promise<Conversation[]> {
  const limit = Math.min(options.limit ?? 20, 40);
  const latest = await ctx.db
    .select({ threadRootId: posts.threadRootId, lastId: sql<string>`max(${posts.id}::text)` })
    .from(posts)
    .where(
      and(
        eq(posts.visibility, 'direct'),
        visibleTo(viewerActorId),
        options.maxId ? lt(posts.id, options.maxId) : undefined,
      ),
    )
    .groupBy(posts.threadRootId)
    .orderBy(desc(sql`max(${posts.id}::text)`))
    .limit(limit);
  if (latest.length === 0) return [];

  const lastRows = await ctx.db
    .select()
    .from(posts)
    .where(
      inArray(
        posts.id,
        latest.map((l) => l.lastId),
      ),
    );
  const statuses = new Map(
    (await hydrateStatuses(ctx, viewerActorId, lastRows)).map((s) => [s.id, s]),
  );

  const rootIds = latest.map((l) => l.threadRootId).filter((id): id is string => !!id);
  const threadPosts = await ctx.db
    .select({ id: posts.id, actorId: posts.actorId, threadRootId: posts.threadRootId })
    .from(posts)
    .where(and(inArray(posts.threadRootId, rootIds), eq(posts.visibility, 'direct')));
  const audience = await ctx.db
    .select({ postId: postAudiences.postId, actorId: postAudiences.actorId })
    .from(postAudiences)
    .where(
      inArray(
        postAudiences.postId,
        threadPosts.map((p) => p.id),
      ),
    );
  const participantIds = new Map<string, Set<string>>();
  for (const post of threadPosts) {
    const set = participantIds.get(post.threadRootId ?? post.id) ?? new Set<string>();
    set.add(post.actorId);
    for (const a of audience) if (a.postId === post.id) set.add(a.actorId);
    participantIds.set(post.threadRootId ?? post.id, set);
  }
  const everyone = [...new Set([...participantIds.values()].flatMap((s) => [...s]))];
  const accountRows =
    everyone.length > 0
      ? await ctx.db.select().from(actors).where(inArray(actors.id, everyone))
      : [];
  const accounts = new Map(accountRows.map((a) => [a.id, serializeAccount(a)]));

  return latest.flatMap((l) => {
    const lastStatus = statuses.get(l.lastId);
    if (!lastStatus || !l.threadRootId) return [];
    const others = [...(participantIds.get(l.threadRootId) ?? [])]
      .filter((id) => id !== viewerActorId)
      .map((id) => accounts.get(id))
      .filter((a): a is Account => !!a);
    return [{ id: l.threadRootId, accounts: others, lastStatus }];
  });
}
