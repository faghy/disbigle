import {
  approveUser,
  blockDomain,
  type CoreContext,
  countOpenModerationItems,
  createReport,
  getInstanceSettings,
  instanceSettingsPatchSchema,
  listAccountsForAdmin,
  listDomainBlocks,
  listKnownInstances,
  listPendingUsers,
  listReports,
  rejectUser,
  resolveReport,
  setUserRole,
  suspendAccount,
  unblockDomain,
  unsuspendAccount,
  updateInstanceSettings,
} from '@disbigle/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http.ts';
import { requireAdmin, requireModerator, requireUser } from '../plugins/auth.ts';

const idParams = z.object({ id: z.uuid() });
const reportCategories = ['spam', 'illegal', 'harassment', 'violation', 'other'] as const;

/** `POST /api/v1/reports`: any signed-in user can report an account and some of its posts. */
export async function reportRoutes(app: FastifyInstance, { ctx }: { ctx: CoreContext }) {
  app.post(
    '/',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const session = requireUser(request);
      const input = parse(
        z.object({
          accountId: z.uuid(),
          statusIds: z.array(z.uuid()).max(20).default([]),
          category: z.enum(reportCategories).default('other'),
          comment: z.string().trim().max(1000).default(''),
        }),
        request.body,
      );
      return reply.status(201).send(await createReport(ctx, session.actorId, input));
    },
  );
}

/** Moderation API under `/api/v1/admin`. */
export async function adminRoutes(app: FastifyInstance, { ctx }: { ctx: CoreContext }) {
  app.get('/summary', async (request) => {
    requireModerator(request);
    return countOpenModerationItems(ctx);
  });

  app.get('/pending', async (request) => {
    requireModerator(request);
    return listPendingUsers(ctx);
  });
  app.post('/pending/:id/approve', async (request) => {
    await approveUser(ctx, requireModerator(request).userId, parse(idParams, request.params).id);
    return { status: 'ok' };
  });
  app.post('/pending/:id/reject', async (request) => {
    await rejectUser(ctx, requireModerator(request).userId, parse(idParams, request.params).id);
    return { status: 'ok' };
  });

  app.get('/accounts', async (request) => {
    requireModerator(request);
    const query = parse(
      z.object({
        q: z.string().trim().max(200).optional(),
        origin: z.enum(['local', 'remote']).optional(),
        status: z.enum(['active', 'suspended']).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
      }),
      request.query,
    );
    return listAccountsForAdmin(ctx, { ...query, ...(query.q ? { query: query.q } : {}) });
  });
  app.post('/accounts/:id/suspend', async (request) => {
    const { reason } = parse(z.object({ reason: z.string().max(1000).default('') }), request.body);
    await suspendAccount(
      ctx,
      requireModerator(request).userId,
      parse(idParams, request.params).id,
      reason,
    );
    return { status: 'ok' };
  });
  app.post('/accounts/:id/unsuspend', async (request) => {
    await unsuspendAccount(
      ctx,
      requireModerator(request).userId,
      parse(idParams, request.params).id,
    );
    return { status: 'ok' };
  });
  app.post('/users/:id/role', async (request) => {
    const { role } = parse(
      z.object({ role: z.enum(['user', 'moderator', 'admin']) }),
      request.body,
    );
    await setUserRole(ctx, requireAdmin(request).userId, parse(idParams, request.params).id, role);
    return { status: 'ok' };
  });

  app.get('/settings', async (request) => {
    requireAdmin(request);
    return getInstanceSettings(ctx);
  });
  app.put('/settings', async (request) =>
    updateInstanceSettings(
      ctx,
      requireAdmin(request).userId,
      parse(instanceSettingsPatchSchema, request.body),
    ),
  );

  app.get('/instances', async (request) => {
    requireModerator(request);
    const { q, limit } = parse(
      z.object({
        q: z.string().trim().max(200).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      }),
      request.query,
    );
    return listKnownInstances(ctx, { ...(q ? { query: q } : {}), limit });
  });

  app.get('/domain_blocks', async (request) => {
    requireModerator(request);
    return listDomainBlocks(ctx);
  });
  app.post('/domain_blocks', async (request, reply) => {
    const input = parse(
      z.object({
        domain: z.string().trim().min(3).max(253),
        severity: z.enum(['silence', 'suspend']),
        publicComment: z.string().max(1000).default(''),
        privateComment: z.string().max(1000).default(''),
      }),
      request.body,
    );
    await blockDomain(ctx, requireAdmin(request).userId, input);
    return reply.status(201).send({ status: 'ok' });
  });
  app.delete<{ Params: { domain: string } }>('/domain_blocks/:domain', async (request) => {
    await unblockDomain(ctx, requireAdmin(request).userId, request.params.domain);
    return { status: 'ok' };
  });

  app.get('/reports', async (request) => {
    requireModerator(request);
    const { resolved } = parse(
      z.object({
        resolved: z
          .enum(['true', 'false'])
          .optional()
          .transform((v) => v === 'true'),
      }),
      request.query,
    );
    return listReports(ctx, { resolved });
  });
  app.post('/reports/:id/resolve', async (request) => {
    await resolveReport(ctx, requireModerator(request).userId, parse(idParams, request.params).id);
    return { status: 'ok' };
  });
}
