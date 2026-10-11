import {
  getStatus,
  publicTagUses,
  searchStatuses,
  serializeAccount,
  visibleTo,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import type { Status } from '@disbigle/shared';
import { and, eq, gt, ilike, inArray, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { optionalUser } from '../auth.ts';
import { mapTag } from '../entities/mappers.ts';
import { Presenter } from '../entities/presenter.ts';
import type { MTag } from '../entities/types.ts';
import { bool, int, parseQuery, str } from '../http.ts';
import type { Deps } from '../options.ts';
import { searchAccounts } from './accounts.ts';

const { posts, tags, tagFollows } = schema;

/**
 * `GET /api/v2/search`: accounts by name or handle, hashtags by prefix, statuses by URL or text.
 * A URL finds that status (fetched from its server with `resolve=true`, when a resolver is
 * configured); other text is a full-text search in the posts the viewer can see.
 */
export async function searchRoutes(app: FastifyInstance, deps: Deps) {
  const { ctx, options } = deps;

  app.get(
    '/api/v2/search',
    { config: { anyFlavour: true, rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const user = optionalUser(request, 'read:search');
      const viewer = user?.actorId ?? null;
      const query = parseQuery(request);
      const q = (str(query.q) ?? '').trim();
      const type = str(query.type);
      const limit = Math.min(Math.max(int(query.limit) ?? 20, 1), 40);
      const offset = Math.max(int(query.offset) ?? 0, 0);
      // Remote lookups only for signed-in users, so we don't become an open proxy.
      const resolve = (bool(query.resolve) ?? false) && viewer !== null;
      const presenter = new Presenter(ctx, viewer);
      const empty = { accounts: [], statuses: [], hashtags: [] };
      if (!q) return empty;

      const wants = (t: string) => !type || type === t;

      const accounts =
        wants('accounts') && (viewer || offset === 0)
          ? await searchAccounts(deps, viewer, {
              q,
              resolve,
              following: bool(query.following) ?? false,
              limit,
              offset,
            })
          : [];

      let hashtags: MTag[] = [];
      if (wants('hashtags')) {
        const term = q.replace(/^#/, '').toLowerCase();
        if (/^[\p{L}\p{N}_]+$/u.test(term)) {
          const rows = await ctx.db
            .select({ name: tags.name, id: tags.id })
            .from(tags)
            .where(
              and(
                ilike(tags.name, `${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`),
                gt(publicTagUses(), 0),
              ),
            )
            .orderBy(tags.name)
            .limit(limit)
            .offset(offset);
          const followed = new Set(
            viewer && rows.length > 0
              ? (
                  await ctx.db
                    .select({ id: tagFollows.tagId })
                    .from(tagFollows)
                    .where(
                      and(
                        eq(tagFollows.actorId, viewer),
                        inArray(
                          tagFollows.tagId,
                          rows.map((r) => r.id),
                        ),
                      ),
                    )
                ).map((r) => r.id)
              : [],
          );
          hashtags = rows.map((r) =>
            mapTag(presenter.map, r.name, viewer ? followed.has(r.id) : undefined),
          );
        }
      }

      const statuses: Status[] = [];
      if (wants('statuses') && /^https?:\/\/\S+$/.test(q) && offset === 0) {
        const [row] = await ctx.db
          .select({ id: posts.id })
          .from(posts)
          .where(and(or(eq(posts.apUri, q), eq(posts.apUrl, q)), visibleTo(viewer)));
        let id = row?.id ?? null;
        if (!id && resolve && options.resolveStatus)
          id = await options.resolveStatus(q).catch(() => null);
        const status = id ? await getStatus(ctx, viewer, id).catch(() => null) : null;
        if (status) statuses.push(status);
      } else if (wants('statuses') && offset === 0) {
        // Full-text search in posts the viewer can see.
        const maxId = str(query.max_id);
        statuses.push(
          ...(await searchStatuses(ctx, viewer, q, { limit, ...(maxId ? { maxId } : {}) })),
        );
      }

      return {
        accounts: await presenter.accounts(accounts.map(serializeAccount)),
        statuses: await presenter.statuses(statuses),
        hashtags,
      };
    },
  );
}
