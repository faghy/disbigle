import {
  addToAlbum,
  type CoreContext,
  createAlbum,
  deleteAlbum,
  getAlbum,
  removeFromAlbum,
  updateAlbum,
} from '@disbigle/core';
import { albumRequestSchema } from '@disbigle/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http.ts';
import { requireUser } from '../plugins/auth.ts';

const idParams = z.object({ id: z.uuid() });
const itemParams = z.object({ id: z.uuid(), mediaId: z.uuid() });

export async function albumRoutes(app: FastifyInstance, { ctx }: { ctx: CoreContext }) {
  app.get('/:id', async (request) => {
    const viewer = request.session?.stage === 'active' ? request.session.actorId : null;
    return getAlbum(ctx, viewer, parse(idParams, request.params).id);
  });

  app.post('/', async (request, reply) => {
    const body = parse(albumRequestSchema, request.body);
    return reply.status(201).send(await createAlbum(ctx, requireUser(request).actorId, body));
  });

  app.patch('/:id', async (request) =>
    updateAlbum(
      ctx,
      requireUser(request).actorId,
      parse(idParams, request.params).id,
      parse(albumRequestSchema, request.body),
    ),
  );

  app.delete('/:id', async (request) => {
    await deleteAlbum(ctx, requireUser(request).actorId, parse(idParams, request.params).id);
    return { status: 'ok' };
  });

  app.put('/:id/media/:mediaId', async (request) => {
    const { id, mediaId } = parse(itemParams, request.params);
    await addToAlbum(ctx, requireUser(request).actorId, id, mediaId);
    return { status: 'ok' };
  });

  app.delete('/:id/media/:mediaId', async (request) => {
    const { id, mediaId } = parse(itemParams, request.params);
    await removeFromAlbum(ctx, requireUser(request).actorId, id, mediaId);
    return { status: 'ok' };
  });
}
