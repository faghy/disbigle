import {
  acceptFollowRequest,
  countUnreadNotifications,
  notFilteredFor,
  rejectFollowRequest,
  serializeNotifications,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import { and, eq, inArray, isNull, lte, notInArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth.ts';
import { nativeNotificationTypes } from '../entities/mappers.ts';
import { Presenter } from '../entities/presenter.ts';
import {
  idParam,
  isUuid,
  MastodonError,
  obj,
  pageParams,
  parseQuery,
  setLinkHeader,
  str,
  strings,
} from '../http.ts';
import type { Deps } from '../options.ts';
import { cursorOrder, cursorsOf, cursorWhere, newestFirst } from '../paging.ts';
import { pagedActors, sendAccountPage } from './accounts.ts';

const { notifications, followRequests } = schema;
const MARKER_TTL_SECONDS = 365 * 24 * 3600;
const MARKER_TIMELINES = ['home', 'notifications'] as const;

interface StoredMarker {
  last_read_id: string;
  version: number;
  updated_at: string;
}

export async function notificationRoutes(app: FastifyInstance, deps: Deps) {
  const { ctx } = deps;

  app.get('/api/v1/notifications', async (request, reply) => {
    const user = requireUser(request, 'read:notifications');
    const query = parseQuery(request);
    const page = pageParams(query, 40, 80);
    const include = strings(query.types);
    const exclude = nativeNotificationTypes(strings(query.exclude_types));
    const types = include.length > 0 ? nativeNotificationTypes(include) : null;
    if (types && types.length === 0) return [];
    const accountId = str(query.account_id);
    if (accountId && !isUuid(accountId)) return [];
    const rows = await ctx.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.actorId, user.actorId),
          types ? inArray(notifications.type, types) : undefined,
          exclude.length > 0 ? notInArray(notifications.type, exclude) : undefined,
          accountId ? eq(notifications.fromActorId, accountId) : undefined,
          // Posts matching the user's filters for notifications are left out, as in core.
          sql`(${notifications.postId} is null or exists (
            select 1 from ${schema.posts} where ${schema.posts.id} = ${notifications.postId}
            and ${notFilteredFor(user.actorId, 'notifications')}
          ))`,
          cursorWhere(notifications.id, page),
        ),
      )
      .orderBy(cursorOrder(notifications.id, page))
      .limit(page.limit);
    const ordered = newestFirst(rows, page);
    const list = await serializeNotifications(ctx, user.actorId, ordered);
    // Cursors from the rows, not the serialised list (hidden posts drop a few notifications).
    setLinkHeader(request, reply, deps.baseUrl, cursorsOf(ordered.map((r) => r.id)), {
      hasNext: true,
    });
    return new Presenter(ctx, user.actorId).notifications(list);
  });

  app.get('/api/v1/notifications/unread_count', async (request) => {
    const user = requireUser(request, 'read:notifications');
    return { count: await countUnreadNotifications(ctx, user.actorId) };
  });

  app.post('/api/v1/notifications/clear', async (request) => {
    const user = requireUser(request, 'write:notifications');
    await ctx.db.delete(notifications).where(eq(notifications.actorId, user.actorId));
    return {};
  });

  app.get('/api/v1/notifications/:id', async (request) => {
    const user = requireUser(request, 'read:notifications');
    const rows = await ctx.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, idParam(request)), eq(notifications.actorId, user.actorId)));
    const [notification] = await serializeNotifications(ctx, user.actorId, rows);
    if (!notification) throw new MastodonError(404, 'Record not found');
    const [result] = await new Presenter(ctx, user.actorId).notifications([notification]);
    return result;
  });

  app.post('/api/v1/notifications/:id/dismiss', async (request) => {
    const user = requireUser(request, 'write:notifications');
    await ctx.db
      .delete(notifications)
      .where(and(eq(notifications.id, idParam(request)), eq(notifications.actorId, user.actorId)));
    return {};
  });

  // --- Follow requests ---

  app.get('/api/v1/follow_requests', async (request, reply) => {
    const user = requireUser(request, 'read:follows');
    const page = pageParams(parseQuery(request), 40, 80);
    const result = await pagedActors(
      ctx,
      {
        table: followRequests,
        join: 'actorId',
        where: eq(followRequests.targetActorId, user.actorId),
      },
      page,
    );
    return sendAccountPage(request, reply, deps, result, page);
  });

  app.post('/api/v1/follow_requests/:id/authorize', async (request) => {
    const user = requireUser(request, 'write:follows');
    const id = idParam(request);
    await acceptFollowRequest(ctx, user.actorId, id);
    return new Presenter(ctx, user.actorId).relationship(id);
  });

  app.post('/api/v1/follow_requests/:id/reject', async (request) => {
    const user = requireUser(request, 'write:follows');
    const id = idParam(request);
    await rejectFollowRequest(ctx, user.actorId, id);
    return new Presenter(ctx, user.actorId).relationship(id);
  });

  // --- Markers (read position), kept in the key-value store ---

  const markerKey = (userId: string, timeline: string) => `mastodon:marker:${userId}:${timeline}`;

  app.get('/api/v1/markers', async (request) => {
    const user = requireUser(request, 'read:statuses');
    const requested = strings(parseQuery(request).timeline);
    const result: Record<string, StoredMarker> = {};
    for (const timeline of MARKER_TIMELINES) {
      if (requested.length > 0 && !requested.includes(timeline)) continue;
      const stored = await ctx.kv.get(markerKey(user.userId, timeline));
      if (stored) result[timeline] = JSON.parse(stored) as StoredMarker;
    }
    return result;
  });

  app.post('/api/v1/markers', async (request) => {
    const user = requireUser(request, 'write:statuses');
    const input = { ...parseQuery(request), ...(request.body as object | undefined) };
    const result: Record<string, StoredMarker> = {};
    for (const timeline of MARKER_TIMELINES) {
      const lastReadId = str(obj((input as Record<string, never>)[timeline]).last_read_id);
      if (!lastReadId) continue;
      if (!isUuid(lastReadId))
        throw new MastodonError(422, 'Validation failed: invalid last_read_id');
      const key = markerKey(user.userId, timeline);
      const previous = await ctx.kv.get(key);
      const marker: StoredMarker = {
        last_read_id: lastReadId.toLowerCase(),
        version: previous ? (JSON.parse(previous) as StoredMarker).version + 1 : 1,
        updated_at: new Date().toISOString(),
      };
      await ctx.kv.set(key, JSON.stringify(marker), MARKER_TTL_SECONDS);
      result[timeline] = marker;
      if (timeline === 'notifications') {
        // Keeps the web client's unread badge in step with what was read in the app.
        await ctx.db
          .update(notifications)
          .set({ readAt: new Date() })
          .where(
            and(
              eq(notifications.actorId, user.actorId),
              isNull(notifications.readAt),
              lte(notifications.id, marker.last_read_id),
            ),
          );
      }
    }
    return result;
  });
}
