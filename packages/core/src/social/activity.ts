import { schema } from '@disbigle/db';
import type { ActivityItem, ActivityKind, ActivityPage } from '@disbigle/shared';
import { and, inArray, type SQL, sql } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';
import { DomainError } from '../errors.ts';
import { hydrateStatuses } from './statuses.ts';
import { visibleTo } from './visibility.ts';

const { posts, likes, bookmarks } = schema;

export interface ActivityQuery {
  /** Only one kind of activity; all of them when missing. */
  type?: ActivityKind | undefined;
  /** Cursor from a previous page: items older than it. */
  maxId?: string | undefined;
  limit?: number | undefined;
}

interface Cursor {
  at: string;
  type: ActivityKind;
  postId: string;
}

const encode = (c: Cursor) => Buffer.from(`${c.at}|${c.type}|${c.postId}`).toString('base64url');

function decode(value: string): Cursor {
  const [at, type, postId] = Buffer.from(value, 'base64url').toString().split('|');
  if (
    !at ||
    Number.isNaN(Date.parse(at)) ||
    !['like', 'reply', 'reblog', 'bookmark'].includes(type ?? '') ||
    !/^[0-9a-f-]{36}$/i.test(postId ?? '')
  )
    throw new DomainError('validation_failed', 'Invalid cursor');
  return { at, type: type as ActivityKind, postId: postId as string };
}

/**
 * Everything you did, newest first: posts you liked, your replies, posts you reshared and posts
 * you saved. Each item is dated by the action, not by the post. Posts you can no longer see are
 * left out (the page may then be shorter; follow `next`).
 */
export async function listActivity(
  ctx: CoreContext,
  actorId: string,
  query: ActivityQuery = {},
): Promise<ActivityPage> {
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 40);
  const parts: Record<ActivityKind, SQL> = {
    like: sql`select 'like' as type, ${likes.postId} as post_id, ${likes.createdAt} as at
      from ${likes} where ${likes.actorId} = ${actorId}`,
    reply: sql`select 'reply' as type, ${posts.id} as post_id, ${posts.createdAt} as at
      from ${posts} where ${posts.actorId} = ${actorId}
        and ${posts.inReplyToId} is not null and ${posts.reblogOfId} is null`,
    reblog: sql`select 'reblog' as type, ${posts.reblogOfId} as post_id, ${posts.createdAt} as at
      from ${posts} where ${posts.actorId} = ${actorId}
        and ${posts.reblogOfId} is not null and ${posts.groupId} is null`,
    bookmark: sql`select 'bookmark' as type, ${bookmarks.postId} as post_id, ${bookmarks.createdAt} as at
      from ${bookmarks} where ${bookmarks.actorId} = ${actorId}`,
  };
  const chosen = query.type ? [parts[query.type]] : Object.values(parts);
  const union = sql.join(chosen, sql` union all `);
  const cursor = query.maxId ? decode(query.maxId) : null;
  const older = cursor
    ? sql`where (a.at, a.type, a.post_id) < (${cursor.at}::timestamptz, ${cursor.type}, ${cursor.postId}::uuid)`
    : sql``;
  const rows = (await ctx.db.execute(sql`
    select a.type, a.post_id, a.at::text as at, to_json(a.at) #>> '{}' as iso
    from (${union}) a ${older}
    order by a.at desc, a.type desc, a.post_id desc
    limit ${limit}`)) as unknown as {
    type: ActivityKind;
    post_id: string;
    at: string;
    iso: string;
  }[];
  if (rows.length === 0) return { items: [], next: null };

  const ids = [...new Set(rows.map((r) => r.post_id))];
  const postRows = await ctx.db
    .select()
    .from(posts)
    .where(and(inArray(posts.id, ids), visibleTo(actorId)));
  const statuses = new Map(
    (await hydrateStatuses(ctx, actorId, postRows)).map((status) => [status.id, status]),
  );
  const items: ActivityItem[] = [];
  for (const row of rows) {
    const status = statuses.get(row.post_id);
    if (!status) continue;
    items.push({
      id: encode({ at: row.at, type: row.type, postId: row.post_id }),
      type: row.type,
      createdAt: new Date(row.iso).toISOString(),
      status,
    });
  }
  const last = rows[rows.length - 1] as (typeof rows)[number];
  return {
    items,
    next:
      rows.length < limit ? null : encode({ at: last.at, type: last.type, postId: last.post_id }),
  };
}
