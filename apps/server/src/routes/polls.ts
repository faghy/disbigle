import { type CoreContext, votePoll } from '@disbigle/core';
import { pollVoteRequestSchema } from '@disbigle/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http.ts';
import { requireUser } from '../plugins/auth.ts';

export async function pollRoutes(app: FastifyInstance, { ctx }: { ctx: CoreContext }) {
  /** Votes and returns the updated status. */
  app.post('/:id/votes', async (request) => {
    const session = requireUser(request);
    const { id } = parse(z.object({ id: z.uuid() }), request.params);
    const { choices } = parse(pollVoteRequestSchema, request.body);
    return votePoll(ctx, session.actorId, id, choices);
  });
}
