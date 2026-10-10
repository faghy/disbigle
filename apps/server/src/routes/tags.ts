import { type CoreContext, followTag, getTag, listFollowedTags, unfollowTag } from '@disbigle/core';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../plugins/auth.ts';

export async function tagRoutes(app: FastifyInstance, { ctx }: { ctx: CoreContext }) {
  app.get('/followed', async (request) => listFollowedTags(ctx, requireUser(request).actorId));

  app.get<{ Params: { name: string } }>('/:name', async (request) =>
    getTag(
      ctx,
      request.session?.stage === 'active' ? request.session.actorId : null,
      request.params.name,
    ),
  );
  app.post<{ Params: { name: string } }>('/:name/follow', async (request) =>
    followTag(ctx, requireUser(request).actorId, request.params.name),
  );
  app.post<{ Params: { name: string } }>('/:name/unfollow', async (request) =>
    unfollowTag(ctx, requireUser(request).actorId, request.params.name),
  );
}
