import { schema } from '@disbigle/db';
import type { PresenceState } from '@disbigle/shared';
import { and, inArray, ne } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';

/** A heartbeat counts this long: closing the app makes you offline within it. */
const PRESENCE_TTL_SECONDS = 90;

const key = (actorId: string) => `presence:${actorId}`;

/**
 * Notes that someone has the app open, active (`online`) or in the background (`away`). Only
 * the current state is kept, for a minute and a half: there is no history.
 */
export async function recordPresence(
  ctx: CoreContext,
  actorId: string,
  active: boolean,
): Promise<void> {
  await ctx.kv.set(key(actorId), active ? 'online' : 'away', PRESENCE_TTL_SECONDS);
}

/** Forgets it at once (signing out, or hiding it). */
export async function clearPresence(ctx: CoreContext, actorId: string): Promise<void> {
  await ctx.kv.del(key(actorId));
}

/**
 * The state of these people, for those who chose to share it and have the app open now; the
 * others are left out (offline, hidden, or on another server).
 */
export async function presenceOf(
  ctx: CoreContext,
  actorIds: string[],
): Promise<Record<string, PresenceState>> {
  if (actorIds.length === 0) return {};
  const sharing = await ctx.db
    .select({ actorId: schema.users.actorId, presence: schema.users.presence })
    .from(schema.users)
    .where(and(inArray(schema.users.actorId, actorIds), ne(schema.users.presence, 'hidden')));
  const result: Record<string, PresenceState> = {};
  for (const { actorId, presence } of sharing) {
    const current = await ctx.kv.get(key(actorId));
    if (current !== 'online' && current !== 'away') continue;
    result[actorId] = presence === 'busy' ? 'busy' : current;
  }
  return result;
}
