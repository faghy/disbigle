import type { CoreContext } from '@disbigle/core';
import { findLocalActorByUsername } from '@disbigle/core';
import { schema } from '@disbigle/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

/**
 * Old diaspora* URLs keep working after a pod is migrated in place: links shared over the years
 * (profiles, posts) are redirected to their new pages.
 */
export async function legacyDiasporaRoutes(app: FastifyInstance, { ctx }: { ctx: CoreContext }) {
  const notFound = { error: 'not_found', message: 'Not found' };

  app.get<{ Params: { username: string } }>('/u/:username', async (request, reply) => {
    const actor = await findLocalActorByUsername(ctx, request.params.username);
    return actor ? reply.redirect(`/@${actor.username}`, 301) : reply.status(404).send(notFound);
  });

  app.get<{ Params: { guid: string } }>('/people/:guid', async (request, reply) => {
    const [actor] = await ctx.db
      .select()
      .from(schema.actors)
      .where(eq(schema.actors.diasporaGuid, request.params.guid));
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
      .where(eq(schema.posts.diasporaGuid, request.params.guid));
    if (!row) return reply.status(404).send(notFound);
    const handle = row.actor.domain
      ? `${row.actor.username}@${row.actor.domain}`
      : row.actor.username;
    return reply.redirect(`/@${handle}/${row.post.id}`, 301);
  });
}
