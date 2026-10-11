import { schema } from '@disbigle/db';
import type { Status } from '@disbigle/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';
import { emit } from '../context.ts';
import { DomainError } from '../errors.ts';
import { getStatus } from './posts.ts';
import { hydrateStatuses } from './statuses.ts';
import { visibleTo } from './visibility.ts';

const { pins, posts } = schema;
export const MAX_PINS = 5;

/** Pins one of your public or unlisted posts to your profile. */
export async function pinPost(ctx: CoreContext, actorId: string, postId: string): Promise<Status> {
  const [post] = await ctx.db.select().from(posts).where(eq(posts.id, postId));
  if (!post || post.actorId !== actorId || post.reblogOfId)
    throw new DomainError('not_found', 'Post not found');
  if (post.visibility !== 'public' && post.visibility !== 'unlisted') {
    throw new DomainError('bad_request', 'Only public posts can be pinned');
  }
  const current = await ctx.db
    .select({ postId: pins.postId })
    .from(pins)
    .where(eq(pins.actorId, actorId));
  if (current.length >= MAX_PINS && !current.some((p) => p.postId === postId)) {
    throw new DomainError('bad_request', `You can pin up to ${MAX_PINS} posts`);
  }
  await ctx.db.insert(pins).values({ actorId, postId }).onConflictDoNothing();
  await emit(ctx, { type: 'profile.updated', actorId });
  return getStatus(ctx, actorId, postId);
}

export async function unpinPost(
  ctx: CoreContext,
  actorId: string,
  postId: string,
): Promise<Status> {
  await ctx.db.delete(pins).where(and(eq(pins.actorId, actorId), eq(pins.postId, postId)));
  await emit(ctx, { type: 'profile.updated', actorId });
  return getStatus(ctx, actorId, postId);
}

/** Pinned posts of an account, newest pin first, as the viewer may see them. */
export async function pinnedStatuses(
  ctx: CoreContext,
  viewerActorId: string | null,
  actorId: string,
) {
  const pinned = await ctx.db
    .select({ postId: pins.postId })
    .from(pins)
    .where(eq(pins.actorId, actorId))
    .orderBy(desc(pins.createdAt));
  if (pinned.length === 0) return [];
  const rows = await ctx.db
    .select()
    .from(posts)
    .where(
      and(
        inArray(
          posts.id,
          pinned.map((p) => p.postId),
        ),
        visibleTo(viewerActorId),
      ),
    );
  const order = new Map(pinned.map((p, i) => [p.postId, i]));
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const statuses = await hydrateStatuses(ctx, viewerActorId, rows);
  return statuses.map((s) => ({ ...s, pinned: true }));
}
