import { schema } from '@disbigle/db';
import { eq } from 'drizzle-orm';
import { type CoreContext, emit } from '../context.ts';
import { verifyPassword } from '../crypto/passwords.ts';
import { DomainError } from '../errors.ts';
import { follow, unfollow } from '../social/relationships.ts';

const { actors, users, follows } = schema;

async function getActor(ctx: CoreContext, id: string) {
  const [actor] = await ctx.db.select().from(actors).where(eq(actors.id, id));
  if (!actor) throw new DomainError('not_found', 'Account not found');
  return actor;
}

/**
 * Declares other accounts as former identities of this one (`alsoKnownAs`). Required on the
 * destination before an account elsewhere can move here.
 */
export async function setAccountAliases(
  ctx: CoreContext,
  actorId: string,
  aliasActorIds: string[],
) {
  const aliases = await Promise.all(
    [...new Set(aliasActorIds)].slice(0, 10).map((id) => getActor(ctx, id)),
  );
  if (aliases.some((a) => a.id === actorId))
    throw new DomainError('bad_request', 'An account cannot alias itself');
  const uris = aliases.map((a) => a.apUri).filter((u): u is string => !!u);
  await ctx.db
    .update(actors)
    .set({ alsoKnownAs: uris, updatedAt: new Date() })
    .where(eq(actors.id, actorId));
  await emit(ctx, { type: 'profile.updated', actorId });
  return uris;
}

/** Moves followers from one account to another (both already verified). */
async function transferLocalFollowers(ctx: CoreContext, originId: string, targetId: string) {
  const followers = await ctx.db
    .select({ id: actors.id })
    .from(follows)
    .innerJoin(actors, eq(actors.id, follows.actorId))
    .where(eq(follows.targetActorId, originId));
  let moved = 0;
  for (const follower of followers) {
    const [local] = await ctx.db.select().from(actors).where(eq(actors.id, follower.id));
    if (!local || local.domain !== null || local.id === targetId) continue;
    try {
      await follow(ctx, local.id, targetId);
      await unfollow(ctx, local.id, originId);
      moved += 1;
    } catch {
      // Blocked or otherwise not allowed: leave this follower alone.
    }
  }
  return moved;
}

/**
 * Moves a local account to another account (here or on another server). The target must list
 * this account in its `alsoKnownAs` (refresh the target before calling). Followers on this server
 * are moved immediately; other servers are told with a Move activity.
 */
export async function moveAccount(
  ctx: CoreContext,
  userId: string,
  targetActorId: string,
  password: string,
): Promise<void> {
  const [user] = await ctx.db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new DomainError('not_found', 'User not found');
  if (!(await verifyPassword(user.passwordHash, password)))
    throw new DomainError('wrong_password', 'Wrong password');
  const [origin, target] = await Promise.all([
    getActor(ctx, user.actorId),
    getActor(ctx, targetActorId),
  ]);
  if (origin.id === target.id) throw new DomainError('bad_request', 'Choose another account');
  if (!origin.apUri || !target.alsoKnownAs.includes(origin.apUri)) {
    throw new DomainError(
      'validation_failed',
      'The new account must list this one as an alias first',
      [{ path: 'target', message: 'Add this account as an alias on the new account first' }],
    );
  }
  await ctx.db
    .update(actors)
    .set({ movedToActorId: target.id, updatedAt: new Date() })
    .where(eq(actors.id, origin.id));
  await emit(ctx, { type: 'account.moved', actorId: origin.id, targetActorId: target.id });
  await transferLocalFollowers(ctx, origin.id, target.id);
}

/** Applies a Move announced by another server, after checking the target really claims the origin. */
export async function applyRemoteMove(
  ctx: CoreContext,
  originActorId: string,
  targetActorId: string,
) {
  const [origin, target] = await Promise.all([
    getActor(ctx, originActorId),
    getActor(ctx, targetActorId),
  ]);
  if (!origin.apUri || !target.alsoKnownAs.includes(origin.apUri)) return 0;
  await ctx.db.update(actors).set({ movedToActorId: target.id }).where(eq(actors.id, origin.id));
  return transferLocalFollowers(ctx, origin.id, target.id);
}

/** Applies a move proven by other means than aliases (a diaspora* AccountMigration, verified by signature). */
export async function applyVerifiedMove(
  ctx: CoreContext,
  originActorId: string,
  targetActorId: string,
) {
  const [origin, target] = await Promise.all([
    getActor(ctx, originActorId),
    getActor(ctx, targetActorId),
  ]);
  if (origin.id === target.id) return 0;
  await ctx.db
    .update(actors)
    .set({ movedToActorId: target.id, updatedAt: new Date() })
    .where(eq(actors.id, origin.id));
  return transferLocalFollowers(ctx, origin.id, target.id);
}
