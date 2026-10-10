// Small helpers around actor rows: diaspora* IDs, protocol choice, endpoints and keys.
import type { CoreContext } from '@disbigle/core';
import { schema } from '@disbigle/db';
import { eq } from 'drizzle-orm';

export type ActorRow = typeof schema.actors.$inferSelect;
export type PostRow = typeof schema.posts.$inferSelect;

/** The diaspora* ID (`user@host`) of a local or remote actor. */
export function diasporaIdOf(
  ctx: CoreContext,
  actor: Pick<ActorRow, 'username' | 'domain'>,
): string {
  return `${actor.username}@${actor.domain ?? ctx.config.LOCAL_DOMAIN}`.toLowerCase();
}

/**
 * True for remote actors that should be reached over diaspora*: they speak it, it is their
 * preferred protocol (ActivityPub wins when both are available) and we know their receive URL.
 */
export function deliversViaDiaspora(actor: ActorRow | undefined | null): actor is ActorRow {
  return (
    !!actor &&
    actor.domain !== null &&
    !actor.suspendedAt &&
    actor.protocols.includes('diaspora') &&
    (actor.preferredProtocol === 'diaspora' || !actor.protocols.includes('activitypub')) &&
    !!actor.diasporaReceiveUrl &&
    !!actor.diasporaGuid
  );
}

/** Base URL of a remote diaspora* server, derived from the private receive URL of one of its people. */
export function podBaseUrl(actor: Pick<ActorRow, 'diasporaReceiveUrl'>): string | null {
  if (!actor.diasporaReceiveUrl) return null;
  const match = /^(.*\/)receive\/users\/[^/]+\/?$/.exec(actor.diasporaReceiveUrl);
  return match?.[1] ?? null;
}

/** `/receive/public` of the server hosting `actor`. */
export function publicReceiveUrl(actor: Pick<ActorRow, 'diasporaReceiveUrl'>): string | null {
  const base = podBaseUrl(actor);
  return base ? `${base}receive/public` : null;
}

/** The RSA private key (PKCS#8 PEM) of a local actor, shared with ActivityPub. */
export async function localPrivateKey(ctx: CoreContext, actorId: string): Promise<string | null> {
  const [row] = await ctx.db
    .select({ key: schema.users.privateKeyPem })
    .from(schema.users)
    .where(eq(schema.users.actorId, actorId));
  return row?.key ?? null;
}

export async function actorById(ctx: CoreContext, id: string): Promise<ActorRow | null> {
  const [row] = await ctx.db.select().from(schema.actors).where(eq(schema.actors.id, id));
  return row ?? null;
}

export async function postById(ctx: CoreContext, id: string): Promise<PostRow | null> {
  const [row] = await ctx.db.select().from(schema.posts).where(eq(schema.posts.id, id));
  return row ?? null;
}

/** Thread root of a post (the post itself for top-level posts). */
export async function threadRootOf(ctx: CoreContext, post: PostRow): Promise<PostRow> {
  if (!post.threadRootId || post.threadRootId === post.id) return post;
  return (await postById(ctx, post.threadRootId)) ?? post;
}

export const isPublicVisibility = (v: PostRow['visibility']) => v === 'public' || v === 'unlisted';
