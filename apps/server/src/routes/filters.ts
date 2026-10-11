import {
  type CoreContext,
  createKeywordFilter,
  deleteKeywordFilter,
  keywordFilterRequestSchema,
  listKeywordFilters,
} from '@disbigle/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http.ts';
import { requireUser } from '../plugins/auth.ts';

/** Muted words and phrases. */
export async function filterRoutes(app: FastifyInstance, { ctx }: { ctx: CoreContext }) {
  app.get('/', async (request) => listKeywordFilters(ctx, requireUser(request).actorId));
  app.post('/', async (request, reply) =>
    reply
      .status(201)
      .send(
        await createKeywordFilter(
          ctx,
          requireUser(request).actorId,
          parse(keywordFilterRequestSchema, request.body),
        ),
      ),
  );
  app.delete('/:id', async (request) => {
    await deleteKeywordFilter(
      ctx,
      requireUser(request).actorId,
      parse(z.object({ id: z.uuid() }), request.params).id,
    );
    return { status: 'ok' };
  });
}
