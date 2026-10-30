import { backfillRemoteOutbox } from '@disbigle/activitypub';
import {
  acceptFollowRequest,
  accountMedia,
  accountTimeline,
  block,
  type CoreContext,
  DomainError,
  follow,
  getAccountWithCounts,
  getRelationships,
  listAlbums,
  listFollowers,
  listFollowing,
  listFollowRequests,
  mute,
  pinnedStatuses,
  rejectFollowRequest,
  serializeAccount,
  setAspectMemberships,
  unblock,
  unfollow,
  unmute,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import { aspectMembershipsRequestSchema, paginationQuerySchema } from '@disbigle/shared';
import type { Federation } from '@fedify/fedify';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http.ts';
import { requireUser } from '../plugins/auth.ts';

const idParams = z.object({ id: z.uuid() });
const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(80).default(40),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export async function accountRoutes(
  app: FastifyInstance,
  { ctx, federation }: { ctx: CoreContext; federation?: Federation<CoreContext> },
) {
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
    getAccountWithCounts(ctx, await loadActor(parse(idParams, request.params).id)),
  );

  app.get('/:id/statuses', async (request) => {
    const { id } = parse(idParams, request.params);
    const actor = await loadActor(id);
    const query = parse(
      paginationQuerySchema.extend({
        excludeReplies: z
          .enum(['true', 'false'])
          .optional()
          .transform((v) => v === 'true'),
        pinned: z
          .enum(['true', 'false'])
          .optional()
          .transform((v) => v === 'true'),
      }),
      request.query,
    );
    const viewer = request.session?.stage === 'active' ? request.session.actorId : null;
    if (query.pinned) return pinnedStatuses(ctx, viewer, id);
    // Opening a remote profile fetches its recent public posts (every 10 minutes at most, bounded wait).
    if (federation && actor.domain !== null && !query.maxId && !query.minId) {
      const backfill = backfillRemoteOutbox(federation, ctx, actor).catch((error) => {
        request.log.warn({ err: error }, 'outbox backfill failed');
        return 0;
      });
      await Promise.race([backfill, new Promise((resolve) => setTimeout(resolve, 5000))]);
    }
    return accountTimeline(ctx, viewer, id, query);
  });

  app.get('/:id/media', async (request) => {
    const { id } = parse(idParams, request.params);
    await loadActor(id);
    const viewer = request.session?.stage === 'active' ? request.session.actorId : null;
    return accountMedia(ctx, viewer, id, parse(paginationQuerySchema, request.query));
  });

  app.get('/:id/albums', async (request) => {
    const { id } = parse(idParams, request.params);
    await loadActor(id);
    const { mediaId } = parse(z.object({ mediaId: z.uuid().optional() }), request.query);
    const viewer = request.session?.stage === 'active' ? request.session.actorId : null;
    return listAlbums(ctx, viewer, id, mediaId);
  });

  app.get('/:id/followers', async (request) => {
    const { id } = parse(idParams, request.params);
    const page = parse(pageQuery, request.query);
    return (await listFollowers(ctx, (await loadActor(id)).id, page)).map(serializeAccount);
  });

  app.get('/:id/following', async (request) => {
    const { id } = parse(idParams, request.params);
    const page = parse(pageQuery, request.query);
    return (await listFollowing(ctx, (await loadActor(id)).id, page)).map(serializeAccount);
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
