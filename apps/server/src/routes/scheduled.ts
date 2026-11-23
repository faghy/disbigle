import {
  type CoreContext,
  deleteScheduledPost,
  getScheduledPost,
  listScheduledPosts,
  rescheduleScheduledPost,
  schedulePost,
} from '@disbigle/core';
import { createPostRequestSchema, scheduleRequestSchema } from '@disbigle/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http.ts';
import { requireUser } from '../plugins/auth.ts';

const idParams = z.object({ id: z.uuid() });

/** Posts written now and published later (issue #28); each person sees only their own. */
export async function scheduledRoutes(app: FastifyInstance, { ctx }: { ctx: CoreContext }) {
  app.get('/', async (request) => listScheduledPosts(ctx, requireUser(request).actorId));

  /** The fields of a new post, plus `scheduledAt`. */
  app.post(
    '/',
    { config: { rateLimit: { max: 60, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      const { scheduledAt } = parse(scheduleRequestSchema, request.body);
      const post = await schedulePost(
        ctx,
        requireUser(request).actorId,
        parse(createPostRequestSchema, request.body),
        new Date(scheduledAt),
      );
      return reply.status(201).send(post);
    },
  );

  app.get('/:id', async (request) =>
    getScheduledPost(ctx, requireUser(request).actorId, parse(idParams, request.params).id),
  );

  /** A new time (a failed post is tried again then). */
  app.patch('/:id', async (request) => {
    const { scheduledAt } = parse(scheduleRequestSchema, request.body);
    return rescheduleScheduledPost(
      ctx,
      requireUser(request).actorId,
      parse(idParams, request.params).id,
      new Date(scheduledAt),
    );
  });

  app.delete('/:id', async (request) => {
    await deleteScheduledPost(
      ctx,
      requireUser(request).actorId,
      parse(idParams, request.params).id,
    );
    return { status: 'ok' };
  });
}
