import {
  acceptFollowRequest,
  accountTimeline,
  block,
  type CoreContext,
  DomainError,
  follow,
  getRelationships,
  listFollowers,
  listFollowing,
  listFollowRequests,
  mute,
  rejectFollowRequest,
  serializeAccount,
  setAspectMemberships,
  unblock,
  unfollow,
  unmute,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import { aspectMembershipsRequestSchema, paginationQuerySchema } from '@disbigle/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http.ts';
import { requireUser } from '../plugins/auth.ts';

const idParams = z.object({ id: z.uuid() });

export async function accountRoutes(app: FastifyInstance, { ctx }: { ctx: CoreContext }) {
  const loadActor = async (id: string) => {
    const [actor] = await ctx.db.select().from(schema.actors).where(eq(schema.actors.id, id));
    if (!actor || actor.suspendedAt) throw new DomainError('not_found', 'Account not found');
    return actor;
  };

  app.get('/relationships', async (request) => {
    const session = requireUser(request);
    const query = request.query as Record<string, string | string[] | undefined>;
    const raw = query['id[]'] ?? query.id ?? [];
    const ids = parse(z.array(z.uuid()).max(40), Array.isArray(raw) ? raw : [raw]);
    return getRelationships(ctx, session.actorId, ids);
  });

  app.get('/:id', async (request) =>
    serializeAccount(await loadActor(parse(idParams, request.params).id)),
  );

  app.get('/:id/statuses', async (request) => {
    const { id } = parse(idParams, request.params);
    await loadActor(id);
    const query = parse(
      paginationQuerySchema.extend({
        excludeReplies: z
          .enum(['true', 'false'])
          .optional()
          .transform((v) => v === 'true'),
      }),
      request.query,
    );
    const viewer = request.session?.stage === 'active' ? request.session.actorId : null;
    return accountTimeline(ctx, viewer, id, query);
  });

  app.get('/:id/followers', async (request) => {
    const { id } = parse(idParams, request.params);
    return (await listFollowers(ctx, (await loadActor(id)).id)).map(serializeAccount);
  });

  app.get('/:id/following', async (request) => {
    const { id } = parse(idParams, request.params);
    return (await listFollowing(ctx, (await loadActor(id)).id)).map(serializeAccount);
  });

  const actions = { follow, unfollow, block, unblock, mute, unmute } as const;
  for (const [name, action] of Object.entries(actions)) {
    app.post(`/:id/${name}`, async (request) => {
      const session = requireUser(request);
      return action(ctx, session.actorId, parse(idParams, request.params).id);
    });
  }

  app.put('/:id/aspects', async (request) => {
    const session = requireUser(request);
    const { id } = parse(idParams, request.params);
    const { aspectIds } = parse(aspectMembershipsRequestSchema, request.body);
    await setAspectMemberships(ctx, session.actorId, id, aspectIds);
    const [relationship] = await getRelationships(ctx, session.actorId, [id]);
    return relationship;
  });
}

export async function followRequestRoutes(app: FastifyInstance, { ctx }: { ctx: CoreContext }) {
  app.get('/', async (request) =>
    (await listFollowRequests(ctx, requireUser(request).actorId)).map(serializeAccount),
  );
  app.post('/:id/authorize', async (request) =>
    acceptFollowRequest(ctx, requireUser(request).actorId, parse(idParams, request.params).id),
  );
  app.post('/:id/reject', async (request) =>
    rejectFollowRequest(ctx, requireUser(request).actorId, parse(idParams, request.params).id),
  );
}
