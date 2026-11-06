import { type CoreContext, hideTag, listHiddenTags, unhideTag } from '@disbigle/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http.ts';
import { requireUser } from '../plugins/auth.ts';

const hideRequest = z.object({
  name: z.string().trim().min(1).max(101),
  accountId: z.uuid().nullable().default(null),
});

/** Hashtags hidden from your timelines: from everyone, or from one account. */
export async function hiddenTagRoutes(app: FastifyInstance, { ctx }: { ctx: CoreContext }) {
  app.get('/', async (request) => listHiddenTags(ctx, requireUser(request).actorId));
  app.post('/', async (request, reply) => {
    const { name, accountId } = parse(hideRequest, request.body);
    return reply
      .status(201)
      .send(await hideTag(ctx, requireUser(request).actorId, name, accountId));
  });
  app.delete('/:id', async (request) => {
    const { id } = parse(z.object({ id: z.uuid() }), request.params);
    await unhideTag(ctx, requireUser(request).actorId, id);
    return { status: 'ok' };
  });
}
