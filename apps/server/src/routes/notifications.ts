import {
  type CoreContext,
  countUnreadNotifications,
  listNotifications,
  markNotificationsRead,
} from '@disbigle/core';
import { paginationQuerySchema } from '@disbigle/shared';
import type { FastifyInstance } from 'fastify';
import { parse } from '../http.ts';
import { requireUser } from '../plugins/auth.ts';

export async function notificationRoutes(app: FastifyInstance, { ctx }: { ctx: CoreContext }) {
  app.get('/', async (request) =>
    listNotifications(
      ctx,
      requireUser(request).actorId,
      parse(paginationQuerySchema, request.query),
    ),
  );
  app.get('/unread_count', async (request) => ({
    count: await countUnreadNotifications(ctx, requireUser(request).actorId),
  }));
  app.post('/read', async (request) => {
    await markNotificationsRead(ctx, requireUser(request).actorId);
    return { status: 'ok' };
  });
}
