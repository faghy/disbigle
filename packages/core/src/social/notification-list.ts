import { schema } from '@disbigle/db';
import type { Notification, PaginationQuery } from '@disbigle/shared';
import { paginationQuerySchema } from '@disbigle/shared';
import { and, inArray } from 'drizzle-orm';
import { serializeAccount } from '../accounts/serialize.ts';
import type { CoreContext } from '../context.ts';
import { listNotificationRows } from './notifications.ts';
import { hydrateStatuses } from './statuses.ts';
import { visibleTo } from './visibility.ts';

const { actors, posts } = schema;

export async function listNotifications(
  ctx: CoreContext,
  actorId: string,
  query: PaginationQuery = {},
): Promise<Notification[]> {
  const { maxId, limit } = paginationQuerySchema.parse(query);
  const rows = await listNotificationRows(ctx, actorId, { maxId, limit });
  return serializeNotifications(ctx, actorId, rows);
}

export async function serializeNotifications(
  ctx: CoreContext,
  actorId: string,
  rows: Awaited<ReturnType<typeof listNotificationRows>>,
): Promise<Notification[]> {
  if (rows.length === 0) return [];
  const fromIds = [...new Set(rows.map((r) => r.fromActorId))];
  const postIds = [...new Set(rows.map((r) => r.postId).filter((id): id is string => id !== null))];
  const [fromActors, postRows] = await Promise.all([
    ctx.db.select().from(actors).where(inArray(actors.id, fromIds)),
    // Only posts the recipient may still see.
    postIds.length > 0
      ? ctx.db
          .select()
          .from(posts)
          .where(and(inArray(posts.id, postIds), visibleTo(actorId)))
      : [],
  ]);
  const statuses = await hydrateStatuses(ctx, actorId, postRows);
  const statusById = new Map(statuses.map((s) => [s.id, s]));
  const accountById = new Map(fromActors.map((a) => [a.id, serializeAccount(a)]));

  return rows.flatMap((row) => {
    const account = accountById.get(row.fromActorId);
    if (!account) return [];
    const status = row.postId ? (statusById.get(row.postId) ?? null) : null;
    if (row.postId && !status) return [];
    return [
      {
        id: row.id,
        type: row.type,
        createdAt: row.createdAt.toISOString(),
        read: row.readAt !== null,
        account,
        status,
      },
    ];
  });
}
