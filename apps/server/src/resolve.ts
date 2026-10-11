import { parseHandle, resolveRemoteAccount } from '@disbigle/activitypub';
import type { ActorRow, CoreContext } from '@disbigle/core';
import { schema } from '@disbigle/db';
import type { Federation } from '@fedify/fedify';
import { eq } from 'drizzle-orm';

/**
 * Finds a remote account whatever it speaks: ActivityPub first, then (for `user@domain`
 * handles) the resolver chain, which reaches diaspora*-only people through WebFinger and hCard.
 */
export async function findRemoteAccount(
  federation: Federation<CoreContext>,
  ctx: CoreContext,
  query: string,
  options: { refresh?: boolean } = {},
): Promise<ActorRow | null> {
  const viaActivityPub = await resolveRemoteAccount(federation, ctx, query, options);
  if (viaActivityPub) return viaActivityPub;
  const handle = parseHandle(query);
  if (!handle || !ctx.resolveAccount) return null;
  const id = await ctx.resolveAccount(handle.username, handle.domain).catch(() => null);
  if (!id) return null;
  const [actor] = await ctx.db.select().from(schema.actors).where(eq(schema.actors.id, id));
  return actor ?? null;
}
