import {
  aspectTimeline,
  bookmarksTimeline,
  type CoreContext,
  homeTimeline,
  listActivity,
  listConversations,
  publicTimeline,
  tagTimeline,
} from '@disbigle/core';
import { activityKinds, paginationQuerySchema } from '@disbigle/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parse } from '../http.ts';
import { requireUser } from '../plugins/auth.ts';

const viewer = (request: FastifyRequest) =>
  request.session?.stage === 'active' ? request.session.actorId : null;
const publicQuery = paginationQuerySchema.extend({
  local: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export async function timelineRoutes(app: FastifyInstance, { ctx }: { ctx: CoreContext }) {
  app.get('/home', async (request) =>
    homeTimeline(ctx, requireUser(request).actorId, parse(paginationQuerySchema, request.query)),
  );

  app.get('/public', async (request) =>
    publicTimeline(ctx, viewer(request), parse(publicQuery, request.query)),
  );

  app.get<{ Params: { tag: string } }>('/tag/:tag', async (request) =>
    tagTimeline(
      ctx,
      viewer(request),
      request.params.tag,
      parse(paginationQuerySchema, request.query),
    ),
  );

  app.get('/aspect/:id', async (request) => {
    const { id } = parse(z.object({ id: z.uuid() }), request.params);
    return aspectTimeline(
      ctx,
      requireUser(request).actorId,
      id,
      parse(paginationQuerySchema, request.query),
    );
  });

  app.get('/bookmarks', async (request) =>
    bookmarksTimeline(
      ctx,
      requireUser(request).actorId,
      parse(paginationQuerySchema, request.query),
    ),
  );

  // Your own activity: likes, replies, reshares and saved posts, by the time you did them.
  const activityQuery = z.object({
    type: z.enum(activityKinds).optional(),
    maxId: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(40).default(20),
  });
  app.get('/activity', async (request) =>
    listActivity(ctx, requireUser(request).actorId, parse(activityQuery, request.query)),
  );

  app.get('/conversations', async (request) => {
    const { maxId, limit } = parse(paginationQuerySchema, request.query);
    return listConversations(ctx, requireUser(request).actorId, {
      ...(maxId ? { maxId } : {}),
      limit,
    });
  });
}
