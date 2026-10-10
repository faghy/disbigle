import {
  type CoreContext,
  createAspect,
  deleteAspect,
  listAspectMembers,
  listAspects,
  renameAspect,
  serializeAccount,
} from '@disbigle/core';
import { aspectRequestSchema } from '@disbigle/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http.ts';
import { requireUser } from '../plugins/auth.ts';

const idParams = z.object({ id: z.uuid() });

export async function aspectRoutes(app: FastifyInstance, { ctx }: { ctx: CoreContext }) {
  app.get('/', async (request) => listAspects(ctx, requireUser(request).actorId));

  app.post('/', async (request, reply) => {
    const { name } = parse(aspectRequestSchema, request.body);
    return reply.status(201).send(await createAspect(ctx, requireUser(request).actorId, name));
  });

  app.patch('/:id', async (request) => {
    const { name } = parse(aspectRequestSchema, request.body);
    return renameAspect(
      ctx,
      requireUser(request).actorId,
      parse(idParams, request.params).id,
      name,
    );
  });

  app.delete('/:id', async (request) => {
    await deleteAspect(ctx, requireUser(request).actorId, parse(idParams, request.params).id);
    return { status: 'ok' };
  });

  app.get('/:id/members', async (request) =>
    (
      await listAspectMembers(ctx, requireUser(request).actorId, parse(idParams, request.params).id)
    ).map(serializeAccount),
  );
}
