// Account moves proven by diaspora* signatures rather than ActivityPub aliases.
import * as core from '@disbigle/core';
import { type CoreContext, follow, unfollow } from '@disbigle/core';
import { schema } from '@disbigle/db';
import { eq } from 'drizzle-orm';

type MoveFn = (ctx: CoreContext, originActorId: string, targetActorId: string) => Promise<number>;

/**
 * Marks `originId` as moved to `targetId` and moves its local followers. Uses the core's
 * `applyVerifiedMove` when available; otherwise does the same here.
 */
export async function moveVerified(
  ctx: CoreContext,
  originId: string,
  targetId: string,
): Promise<number> {
  const fromCore = (core as Record<string, unknown>).applyVerifiedMove as MoveFn | undefined;
  if (typeof fromCore === 'function') return fromCore(ctx, originId, targetId);

  const { actors, follows } = schema;
  await ctx.db
    .update(actors)
    .set({ movedToActorId: targetId, updatedAt: new Date() })
    .where(eq(actors.id, originId));
  const followers = await ctx.db
    .select({ actor: actors })
    .from(follows)
    .innerJoin(actors, eq(actors.id, follows.actorId))
    .where(eq(follows.targetActorId, originId));
  let moved = 0;
  for (const { actor } of followers) {
    if (actor.domain !== null || actor.id === targetId) continue;
    try {
      await follow(ctx, actor.id, targetId);
      await unfollow(ctx, actor.id, originId);
      moved += 1;
    } catch {
      // Blocked or not allowed: leave this follower alone.
    }
  }
  return moved;
}
