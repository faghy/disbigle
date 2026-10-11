import { type CoreContext, createInvite, deleteInvite, listInvites } from '@disbigle/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http.ts';
import { requireUser } from '../plugins/auth.ts';

/** Personal invitation links (useful in invite-only mode, as on diaspora). */
export async function inviteRoutes(app: FastifyInstance, { ctx }: { ctx: CoreContext }) {
  app.get('/', async (request) => listInvites(ctx, requireUser(request).userId));

  app.post(
    '/',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const input = parse(
        z.object({
          maxUses: z.number().int().min(1).max(1000).nullable().default(null),
          expiresIn: z
            .number()
            .int()
            .min(3600)
            .max(365 * 24 * 3600)
            .nullable()
            .default(7 * 24 * 3600),
        }),
        request.body,
      );
      return reply.status(201).send(await createInvite(ctx, requireUser(request).userId, input));
    },
  );

  app.delete('/:id', async (request) => {
    await deleteInvite(
      ctx,
      requireUser(request).userId,
      parse(z.object({ id: z.uuid() }), request.params).id,
    );
    return { status: 'ok' };
  });
}
