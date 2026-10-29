import { schema, uuidv7 } from '@disbigle/db';
import type { NotificationType } from '@disbigle/shared';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { type CoreContext, emit } from '../context.ts';
import { notFilteredFor } from './filters.ts';

const { notifications, actors, mutes, blocks } = schema;

/**
 * Creates a notification for a local actor. Skips self-notifications, remote recipients,
 * and senders the recipient muted or blocked.
 */
export async function createNotification(
  ctx: CoreContext,
  input: {
    actorId: string;
    type: NotificationType;
    fromActorId: string;
    postId?: string | null;
    groupId?: string | null;
  },
): Promise<string | null> {
  // The only notification about yourself: your poll has ended.
  if (input.actorId === input.fromActorId && input.type !== 'poll') return null;
  const [recipient] = await ctx.db
    .select({ domain: actors.domain })
    .from(actors)
    .where(eq(actors.id, input.actorId));
  if (!recipient || recipient.domain !== null) return null;

  const [silenced] = await ctx.db
    .select({ one: sql`1` })
    .from(mutes)
    .where(and(eq(mutes.actorId, input.actorId), eq(mutes.targetActorId, input.fromActorId)))
    .union(
      ctx.db
        .select({ one: sql`1` })
        .from(blocks)
        .where(and(eq(blocks.actorId, input.actorId), eq(blocks.targetActorId, input.fromActorId))),
    )
    .limit(1);
  if (silenced) return null;

  const id = uuidv7();
  await ctx.db.insert(notifications).values({
    id,
    actorId: input.actorId,
    type: input.type,
    fromActorId: input.fromActorId,
    postId: input.postId ?? null,
    groupId: input.groupId ?? null,
  });
  await emit(ctx, {
    type: 'notification.created',
    notificationId: id,
    recipientActorId: input.actorId,
  });
  return id;
}

export async function listNotificationRows(
  ctx: CoreContext,
  actorId: string,
  options: { maxId?: string | undefined; minId?: string | undefined; limit: number },
) {
  const rows = await ctx.db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.actorId, actorId),
        options.maxId ? lt(notifications.id, options.maxId) : undefined,
        options.minId ? gt(notifications.id, options.minId) : undefined,
        sql`(${notifications.postId} is null or exists (
          select 1 from ${schema.posts} where ${schema.posts.id} = ${notifications.postId}
          and ${notFilteredFor(actorId, 'notifications')}
        ))`,
      ),
    )
    .orderBy(options.minId ? notifications.id : sql`${notifications.id} desc`)
    .limit(options.limit);
  if (options.minId) rows.reverse();
  return rows;
}

export async function countUnreadNotifications(ctx: CoreContext, actorId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.actorId, actorId), isNull(notifications.readAt)));
  return row?.count ?? 0;
}

export async function markNotificationsRead(ctx: CoreContext, actorId: string): Promise<void> {
  await ctx.db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.actorId, actorId), isNull(notifications.readAt)));
}

/** Removes the follow-request notification once the request has been answered. */
export async function clearFollowRequestNotification(
  ctx: CoreContext,
  targetActorId: string,
  requesterId: string,
) {
  await ctx.db
    .delete(notifications)
    .where(
      and(
        eq(notifications.actorId, targetActorId),
        eq(notifications.fromActorId, requesterId),
        eq(notifications.type, 'follow_request'),
      ),
    );
}
