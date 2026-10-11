import { resolveRemoteAccount, resolveRemoteStatus } from '@disbigle/activitypub';
import {
  type CoreContext,
  findActorByHandle,
  getStatus,
  searchStatuses,
  searchTags,
  serializeAccount,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import { paginationQuerySchema } from '@disbigle/shared';
import type { Federation } from '@fedify/fedify';
import { and, ilike, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../http.ts';
import { requireUser } from '../plugins/auth.ts';

const searchQuery = z.object({
  q: z.string().trim().min(1).max(500),
  resolve: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export async function searchRoutes(
  app: FastifyInstance,
  { ctx, federation }: { ctx: CoreContext; federation: Federation<CoreContext> },
) {
  /** Account search: local name matches, plus remote lookup of `user@domain` handles or URLs. */
  app.get(
    '/accounts',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const { q, resolve } = parse(searchQuery, request.query);
      const results = new Map<string, ReturnType<typeof serializeAccount>>();

      const looksRemote = /^@?[^@\s]+@[^@\s]+$/.test(q) || /^https?:\/\//.test(q);
      if (looksRemote) {
        const [username, domain] = q.replace(/^@/, '').split('@');
        const known = username && domain ? await findActorByHandle(ctx, username, domain) : null;
        // Remote fetches only for signed-in users, to avoid becoming an open proxy.
        const actor =
          known ??
          (resolve && request.session?.stage === 'active'
            ? await resolveRemoteAccount(federation, ctx, q)
            : null);
        if (actor && !actor.suspendedAt) results.set(actor.id, serializeAccount(actor));
      }

      const term = `%${q.replace(/^@/, '').replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      const rows = await ctx.db
        .select()
        .from(schema.actors)
        .where(
          and(
            or(ilike(schema.actors.username, term), ilike(schema.actors.displayName, term)),
            isNull(schema.actors.suspendedAt),
            sql`(${schema.actors.discoverable} or ${schema.actors.domain} is null)`,
          ),
        )
        .orderBy(sql`${schema.actors.domain} is not null`, schema.actors.username)
        .limit(20);
      for (const actor of rows) results.set(actor.id, serializeAccount(actor));
      return [...results.values()];
    },
  );

  app.post('/resolve', async (request) => {
    requireUser(request);
    const { q } = parse(z.object({ q: z.string().trim().min(3).max(500) }), request.body);
    const actor = await resolveRemoteAccount(federation, ctx, q, { refresh: true });
    return actor ? serializeAccount(actor) : null;
  });

  /** Imports a remote post by URL so it can be read and interacted with here. */
  app.post('/resolve_status', async (request) => {
    const session = requireUser(request);
    const { q } = parse(z.object({ q: z.string().trim().url().max(2000) }), request.body);
    const id = await resolveRemoteStatus(federation, ctx, q);
    return id ? getStatus(ctx, session.actorId, id) : null;
  });

  /** Full-text search in the posts the viewer can see. */
  app.get(
    '/statuses',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const query = parse(
        paginationQuerySchema.extend({ q: z.string().trim().min(1).max(200) }),
        request.query,
      );
      const viewer = request.session?.stage === 'active' ? request.session.actorId : null;
      return searchStatuses(ctx, viewer, query.q, query);
    },
  );

  /** Hashtags by prefix, most used first. */
  app.get('/tags', async (request) => {
    const { q, limit } = parse(
      z.object({
        q: z.string().trim().min(1).max(100),
        limit: z.coerce.number().int().min(1).max(40).default(20),
      }),
      request.query,
    );
    const viewer = request.session?.stage === 'active' ? request.session.actorId : null;
    return searchTags(ctx, viewer, q, limit);
  });
}
