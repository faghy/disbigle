import { randomBytes } from 'node:crypto';
import { schema, uuidv7 } from '@disbigle/db';
import { eq, sql } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';
import { generateActorKeyPair } from '../crypto/keys.ts';
import type { ActorRow } from './remote.ts';

const { bridgeIdentities, actors } = schema;

export type BridgeIdentity = typeof bridgeIdentities.$inferSelect;

/**
 * Local username of the bridge identity of a remote account: `user_at_domain`, e.g.
 * `faghy_at_diaspora-fr.org`. Local usernames have no dots, so the two can never clash.
 */
export function bridgeUsername(actor: Pick<ActorRow, 'username' | 'domain'>): string {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]/g, '_');
  return `${clean(actor.username)}_at_${clean(actor.domain ?? '')}`;
}

/** True when `username` has the shape of a bridge identity (and so is never a local account). */
export const isBridgeUsername = (username: string) => /_at_.+\./.test(username);

export async function bridgeIdentityOf(
  ctx: CoreContext,
  actorId: string,
): Promise<BridgeIdentity | null> {
  const [row] = await ctx.db
    .select()
    .from(bridgeIdentities)
    .where(eq(bridgeIdentities.actorId, actorId));
  return row ?? null;
}

/** The bridge identity of a remote account, created (with its own key pair) on first use. */
export async function ensureBridgeIdentity(
  ctx: CoreContext,
  actor: ActorRow,
): Promise<BridgeIdentity> {
  if (actor.domain === null) throw new Error('Local accounts need no bridge identity');
  const existing = await bridgeIdentityOf(ctx, actor.id);
  if (existing) return existing;
  const keys = await generateActorKeyPair(ctx.rsaKeyBits ?? 4096);
  await ctx.db
    .insert(bridgeIdentities)
    .values({
      id: uuidv7(),
      actorId: actor.id,
      username: bridgeUsername(actor),
      diasporaGuid: randomBytes(16).toString('hex'),
      ...keys,
    })
    .onConflictDoNothing();
  const created = await bridgeIdentityOf(ctx, actor.id);
  if (!created) throw new Error('Bridge identity could not be created');
  return created;
}

/** A bridge identity with the remote account it stands for. */
export interface BridgedAccount {
  bridge: BridgeIdentity;
  actor: ActorRow;
}

async function bridgedBy(ctx: CoreContext, where: ReturnType<typeof eq>) {
  const [row] = await ctx.db
    .select({ bridge: bridgeIdentities, actor: actors })
    .from(bridgeIdentities)
    .innerJoin(actors, eq(actors.id, bridgeIdentities.actorId))
    .where(where);
  return row && !row.actor.suspendedAt ? row : null;
}

export function bridgedAccountByUsername(
  ctx: CoreContext,
  username: string,
): Promise<BridgedAccount | null> {
  return bridgedBy(ctx, sql`lower(${bridgeIdentities.username}) = lower(${username})`);
}

export function bridgedAccountByGuid(
  ctx: CoreContext,
  guid: string,
): Promise<BridgedAccount | null> {
  return bridgedBy(ctx, eq(bridgeIdentities.diasporaGuid, guid));
}
