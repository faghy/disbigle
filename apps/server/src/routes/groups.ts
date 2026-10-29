import {
  answerGroupRequest,
  type CoreContext,
  createGroup,
  DomainError,
  deleteGroup,
  discoverGroups,
  getGroup,
  groupTimeline,
  inviteToGroup,
  joinGroup,
  leaveGroup,
  listGroupMembers,
  listMyGroups,
  MAX_IMAGE_BYTES,
  type MediaStorage,
  removeGroupMember,
  removeProfileImage,
  requireGroupAdmin,
  requireReadableGroup,
  setGroupRole,
  updateGroup,
  updateProfileImage,
} from '@disbigle/core';
import {
  createGroupRequestSchema,
  groupRoles,
  paginationQuerySchema,
  updateGroupRequestSchema,
} from '@disbigle/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parse } from '../http.ts';
import { requireUser } from '../plugins/auth.ts';

const viewer = (request: FastifyRequest) =>
  request.session?.stage === 'active' ? request.session.actorId : null;

/** A group by id or by handle. */
const groupParams = z.object({ id: z.string().min(1).max(100) });
const memberParams = groupParams.extend({ accountId: z.uuid() });
const listQuery = z.object({
  scope: z.enum(['mine', 'invited', 'requested', 'discover']).default('discover'),
  q: z.string().trim().max(100).optional(),
});
const membersQuery = z.object({
  state: z.enum(['member', 'requested', 'invited']).default('member'),
});

export async function groupRoutes(
  app: FastifyInstance,
  { ctx, mediaCtx }: { ctx: CoreContext; mediaCtx: CoreContext & { storage: MediaStorage } },
) {
  app.get('/', async (request) => {
    const { scope, q } = parse(listQuery, request.query);
    if (scope === 'discover') return discoverGroups(ctx, viewer(request), { q });
    const actorId = requireUser(request).actorId;
    return listMyGroups(ctx, actorId, scope === 'mine' ? 'member' : scope);
  });

  app.post(
    '/',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const input = parse(createGroupRequestSchema, request.body);
      return reply.status(201).send(await createGroup(ctx, requireUser(request).actorId, input));
    },
  );

  app.get('/:id', async (request) =>
    getGroup(ctx, viewer(request), parse(groupParams, request.params).id),
  );

  app.patch('/:id', async (request) =>
    updateGroup(
      ctx,
      requireUser(request).actorId,
      parse(groupParams, request.params).id,
      parse(updateGroupRequestSchema, request.body),
    ),
  );

  app.delete('/:id', async (request) => {
    await deleteGroup(ctx, requireUser(request).actorId, parse(groupParams, request.params).id);
    return { status: 'ok' };
  });

  app.get('/:id/timeline', async (request) => {
    const { group } = await requireReadableGroup(
      ctx,
      viewer(request),
      parse(groupParams, request.params).id,
    );
    return groupTimeline(
      ctx,
      viewer(request),
      group.id,
      parse(paginationQuerySchema, request.query),
    );
  });

  app.post('/:id/join', async (request) =>
    joinGroup(ctx, requireUser(request).actorId, parse(groupParams, request.params).id),
  );

  app.post('/:id/leave', async (request) => {
    const actorId = requireUser(request).actorId;
    const { id } = parse(groupParams, request.params);
    await leaveGroup(ctx, actorId, id);
    return getGroup(ctx, actorId, id).catch(() => ({ status: 'ok' }));
  });

  app.get('/:id/members', async (request) =>
    listGroupMembers(
      ctx,
      viewer(request),
      parse(groupParams, request.params).id,
      parse(membersQuery, request.query).state,
    ),
  );

  app.post('/:id/members/:accountId/approve', async (request) => {
    const { id, accountId } = parse(memberParams, request.params);
    await answerGroupRequest(ctx, requireUser(request).actorId, id, accountId, true);
    return { status: 'ok' };
  });

  app.post('/:id/members/:accountId/reject', async (request) => {
    const { id, accountId } = parse(memberParams, request.params);
    await answerGroupRequest(ctx, requireUser(request).actorId, id, accountId, false);
    return { status: 'ok' };
  });

  app.post('/:id/members/:accountId/invite', async (request) => {
    const { id, accountId } = parse(memberParams, request.params);
    await inviteToGroup(ctx, requireUser(request).actorId, id, accountId);
    return { status: 'ok' };
  });

  app.patch('/:id/members/:accountId', async (request) => {
    const { id, accountId } = parse(memberParams, request.params);
    const { role } = parse(z.object({ role: z.enum(groupRoles) }), request.body);
    await setGroupRole(ctx, requireUser(request).actorId, id, accountId, role);
    return { status: 'ok' };
  });

  app.delete('/:id/members/:accountId', async (request) => {
    const { id, accountId } = parse(memberParams, request.params);
    await removeGroupMember(ctx, requireUser(request).actorId, id, accountId);
    return { status: 'ok' };
  });

  for (const kind of ['avatar', 'header'] as const) {
    app.post(
      `/:id/${kind}`,
      { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
      async (request) => {
        const actorId = requireUser(request).actorId;
        const { actor, group } = await requireGroupAdmin(
          ctx,
          actorId,
          parse(groupParams, request.params).id,
        );
        const file = await request.file({ limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });
        if (!file) throw new DomainError('bad_request', 'No file uploaded');
        const data = await file.toBuffer();
        if (file.file.truncated) throw new DomainError('bad_request', 'Image is too large');
        await updateProfileImage(mediaCtx, actor.id, kind, { data, mimeType: file.mimetype });
        return getGroup(ctx, actorId, group.id);
      },
    );
    app.delete(`/:id/${kind}`, async (request) => {
      const actorId = requireUser(request).actorId;
      const { actor, group } = await requireGroupAdmin(
        ctx,
        actorId,
        parse(groupParams, request.params).id,
      );
      await removeProfileImage(mediaCtx, actor.id, kind);
      return getGroup(ctx, actorId, group.id);
    });
  }
}
