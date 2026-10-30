import {
  approveGroupPost,
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
  rejectGroupPost,
  shareToGroup,
  translatePost,
  unbookmark,
  unlike,
  unpinPost,
  unreblog,
  unshareFromGroup,
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

  // Sharing a post into one of your groups, and taking it back.
  const groupBody = z.object({ groupId: z.uuid() });
  app.post('/:id/share_to_group', async (request) => {
    const session = requireUser(request);
    const { id } = parse(idParams, request.params);
    const { groupId } = parse(groupBody, request.body);
    return shareToGroup(ctx, session.actorId, id, groupId);
  });
  app.post('/:id/unshare_from_group', async (request) => {
    const session = requireUser(request);
    const { id } = parse(idParams, request.params);
    const { groupId } = parse(groupBody, request.body);
    await unshareFromGroup(ctx, session.actorId, id, groupId);
    return { status: 'ok' };
  });

  // Moderators of a group with post approval let posts in, or turn them down.
  app.post('/:id/approve', async (request) => {
    const session = requireUser(request);
    const { id } = parse(idParams, request.params);
    await approveGroupPost(ctx, session.actorId, id);
    return { status: 'ok' };
  });
  app.post('/:id/reject', async (request) => {
    const session = requireUser(request);
    const { id } = parse(idParams, request.params);
    await rejectGroupPost(ctx, session.actorId, id);
    return { status: 'ok' };
  });

  // Machine translation into the reader's language (only with a translation service).
  const translateBody = z.object({ lang: z.string().min(2).max(16) });
  app.post(
    '/:id/translate',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      const session = requireUser(request);
      const { id } = parse(idParams, request.params);
      const { lang } = parse(translateBody, request.body);
      return translatePost(ctx, session.actorId, id, lang);
    },
  );
}
