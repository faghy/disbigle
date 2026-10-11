import {
  bookmark,
  type CoreContext,
  createPost,
  deletePost,
  editPost,
  getStatus,
  getStatusContext,
  like,
  pinPost,
  reblog,
  unbookmark,
  unlike,
  unpinPost,
  unreblog,
} from '@disbigle/core';
import { createPostRequestSchema, editPostRequestSchema } from '@disbigle/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http.ts';
import { requireUser } from '../plugins/auth.ts';

const idParams = z.object({ id: z.uuid() });

export async function statusRoutes(app: FastifyInstance, { ctx }: { ctx: CoreContext }) {
  app.post(
    '/',
    { config: { rateLimit: { max: 60, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      const session = requireUser(request);
      const status = await createPost(
        ctx,
        session.actorId,
        parse(createPostRequestSchema, request.body),
      );
      return reply.status(201).send(status);
    },
  );

  app.get('/:id', async (request) => {
    const { id } = parse(idParams, request.params);
    return getStatus(ctx, request.session?.stage === 'active' ? request.session.actorId : null, id);
  });

  app.put('/:id', async (request) => {
    const session = requireUser(request);
    const { id } = parse(idParams, request.params);
    return editPost(ctx, session.actorId, id, parse(editPostRequestSchema, request.body));
  });

  app.get('/:id/context', async (request) => {
    const { id } = parse(idParams, request.params);
    return getStatusContext(
      ctx,
      request.session?.stage === 'active' ? request.session.actorId : null,
      id,
    );
  });

  app.delete('/:id', async (request) => {
    const session = requireUser(request);
    const { id } = parse(idParams, request.params);
    await deletePost(ctx, session.actorId, id, { asModerator: session.role !== 'user' });
    return { status: 'ok' };
  });

  const actions = {
    like,
    unlike,
    reblog,
    unreblog,
    bookmark,
    unbookmark,
    pin: pinPost,
    unpin: unpinPost,
  } as const;
  for (const [name, action] of Object.entries(actions)) {
    app.post(`/:id/${name}`, async (request) => {
      const session = requireUser(request);
      const { id } = parse(idParams, request.params);
      return action(ctx, session.actorId, id);
    });
  }
}
