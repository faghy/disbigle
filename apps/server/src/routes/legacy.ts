import type { CoreContext } from '@disbigle/core';
import { findLocalActorByUsername, visibleTo } from '@disbigle/core';
import { schema } from '@disbigle/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

/**
 * Old diaspora* URLs keep working after a pod is migrated in place: links shared over the years
 * (profiles, posts) are redirected to their new pages.
 */
export async function legacyDiasporaRoutes(app: FastifyInstance, { ctx }: { ctx: CoreContext }) {
  const notFound = { error: 'not_found', message: 'Not found' };

  app.get<{ Params: { username: string } }>('/u/:username', async (request, reply) => {
    const actor = await findLocalActorByUsername(ctx, request.params.username);
    return actor && !actor.suspendedAt
      ? reply.redirect(`/@${actor.username}`, 301)
      : reply.status(404).send(notFound);
  });

  app.get<{ Params: { guid: string } }>('/people/:guid', async (request, reply) => {
    const [actor] = await ctx.db
      .select()
      .from(schema.actors)
      .where(
        and(eq(schema.actors.diasporaGuid, request.params.guid), isNull(schema.actors.suspendedAt)),
      );
    if (!actor) return reply.status(404).send(notFound);
    return reply.redirect(
      actor.domain ? `/@${actor.username}@${actor.domain}` : `/@${actor.username}`,
      301,
    );
  });

  app.get<{ Params: { guid: string } }>('/posts/:guid', async (request, reply) => {
    const [row] = await ctx.db
      .select({ post: schema.posts, actor: schema.actors })
      .from(schema.posts)
      .innerJoin(schema.actors, eq(schema.actors.id, schema.posts.actorId))
      // Same rule as everywhere else: the redirect must not reveal posts the viewer can't see.
      .where(
        and(
          eq(schema.posts.diasporaGuid, request.params.guid),
          visibleTo(request.session?.stage === 'active' ? request.session.actorId : null),
        ),
      );
    if (!row) return reply.status(404).send(notFound);
    const handle = row.actor.domain
      ? `${row.actor.username}@${row.actor.domain}`
      : row.actor.username;
    return reply.redirect(`/@${handle}/${row.post.id}`, 301);
  });
}
