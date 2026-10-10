import { schema, uuidv7 } from '@disbigle/db';
import type { Relationship } from '@disbigle/shared';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { type CoreContext, emit } from '../context.ts';
import { DomainError } from '../errors.ts';
import { clearFollowRequestNotification, createNotification } from './notifications.ts';

const { actors, follows, followRequests, blocks, mutes, aspects, aspectMemberships } = schema;

async function getActor(ctx: CoreContext, actorId: string) {
  const [actor] = await ctx.db.select().from(actors).where(eq(actors.id, actorId));
  if (!actor || actor.suspendedAt) throw new DomainError('not_found', 'Account not found');
  return actor;
}

async function isBlockedEitherWay(ctx: CoreContext, a: string, b: string): Promise<boolean> {
  const [row] = await ctx.db
    .select({ id: blocks.id })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.actorId, a), eq(blocks.targetActorId, b)),
        and(eq(blocks.actorId, b), eq(blocks.targetActorId, a)),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Follows an account. Locked accounts and every remote account get a follow request first:
 * a remote follow only becomes a follow when the other server accepts it.
 * `options.apUri` is the id of an incoming Follow activity (remote follower).
 */
export async function follow(
  ctx: CoreContext,
  actorId: string,
  targetActorId: string,
  options: { apUri?: string } = {},
): Promise<Relationship> {
  if (actorId === targetActorId) throw new DomainError('bad_request', 'You cannot follow yourself');
  const [actor, target] = await Promise.all([getActor(ctx, actorId), getActor(ctx, targetActorId)]);
  if (await isBlockedEitherWay(ctx, actorId, targetActorId)) {
    throw new DomainError('forbidden', 'You cannot follow this account');
  }

  const [existing] = await ctx.db
    .select({ id: follows.id })
    .from(follows)
    .where(and(eq(follows.actorId, actorId), eq(follows.targetActorId, targetActorId)));
  if (!existing) {
    const id = uuidv7();
    const apUri = options.apUri ?? (actor.domain === null ? `${actor.apUri}#follows/${id}` : null);
    // diaspora* has no accept step: following someone there takes effect at once.
    const awaitsAccept =
      target.locked || (target.domain !== null && target.preferredProtocol !== 'diaspora');
    if (awaitsAccept) {
      const inserted = await ctx.db
        .insert(followRequests)
        .values({ id, actorId, targetActorId, apUri })
        .onConflictDoNothing()
        .returning({ id: followRequests.id });
      if (inserted.length > 0) {
        await createNotification(ctx, {
          actorId: targetActorId,
          type: 'follow_request',
          fromActorId: actorId,
        });
        await emit(ctx, { type: 'follow.requested', actorId, targetActorId, apUri });
      }
    } else {
      await insertFollow(ctx, actorId, targetActorId, apUri);
    }
  }
  return getRelationship(ctx, actorId, targetActorId);
}

async function insertFollow(
  ctx: CoreContext,
  actorId: string,
  targetActorId: string,
  apUri: string | null,
) {
  const id = uuidv7();
  const inserted = await ctx.db
    .insert(follows)
    .values({ id, actorId, targetActorId, apUri })
    .onConflictDoNothing()
    .returning({ id: follows.id });
  if (inserted.length === 0) return;
  await createNotification(ctx, { actorId: targetActorId, type: 'follow', fromActorId: actorId });
  await emit(ctx, { type: 'follow.created', followId: id, actorId, targetActorId, apUri });
}

/** Stops following (or cancels a pending request). */
export async function unfollow(
  ctx: CoreContext,
  actorId: string,
  targetActorId: string,
): Promise<Relationship> {
  const removed = await ctx.db
    .delete(follows)
    .where(and(eq(follows.actorId, actorId), eq(follows.targetActorId, targetActorId)))
    .returning({ apUri: follows.apUri });
  const cancelled = await ctx.db
    .delete(followRequests)
    .where(
      and(eq(followRequests.actorId, actorId), eq(followRequests.targetActorId, targetActorId)),
    )
    .returning({ apUri: followRequests.apUri });
  const row = removed[0] ?? cancelled[0];
  if (row) await emit(ctx, { type: 'follow.removed', actorId, targetActorId, apUri: row.apUri });
  return getRelationship(ctx, actorId, targetActorId);
}

export async function listFollowRequests(ctx: CoreContext, targetActorId: string) {
  return ctx.db
    .select({ actor: actors })
    .from(followRequests)
    .innerJoin(actors, eq(actors.id, followRequests.actorId))
    .where(eq(followRequests.targetActorId, targetActorId))
    .orderBy(followRequests.createdAt)
    .then((rows) => rows.map((r) => r.actor));
}

/** Accepts a pending request (the target accepts the requester). */
export async function acceptFollowRequest(
  ctx: CoreContext,
  targetActorId: string,
  requesterId: string,
) {
  const removed = await ctx.db
    .delete(followRequests)
    .where(
      and(eq(followRequests.actorId, requesterId), eq(followRequests.targetActorId, targetActorId)),
    )
    .returning({ apUri: followRequests.apUri });
  const request = removed[0];
  if (!request) throw new DomainError('not_found', 'Follow request not found');
  await clearFollowRequestNotification(ctx, targetActorId, requesterId);
  await insertFollow(ctx, requesterId, targetActorId, request.apUri);
  return getRelationship(ctx, targetActorId, requesterId);
}

/** Rejects a pending request, or removes an existing follower. */
export async function rejectFollowRequest(
  ctx: CoreContext,
  targetActorId: string,
  requesterId: string,
) {
  const removed = await ctx.db
    .delete(followRequests)
    .where(
      and(eq(followRequests.actorId, requesterId), eq(followRequests.targetActorId, targetActorId)),
    )
    .returning({ apUri: followRequests.apUri });
  const unfollowed = await ctx.db
    .delete(follows)
    .where(and(eq(follows.actorId, requesterId), eq(follows.targetActorId, targetActorId)))
    .returning({ apUri: follows.apUri });
  const row = removed[0] ?? unfollowed[0];
  await clearFollowRequestNotification(ctx, targetActorId, requesterId);
  if (row)
    await emit(ctx, {
      type: 'follow.rejected',
      actorId: requesterId,
      targetActorId,
      apUri: row.apUri,
    });
  return getRelationship(ctx, targetActorId, requesterId);
}

/** Blocking removes follows in both directions and takes the account out of your aspects. */
export async function block(
  ctx: CoreContext,
  actorId: string,
  targetActorId: string,
): Promise<Relationship> {
  if (actorId === targetActorId) throw new DomainError('bad_request', 'You cannot block yourself');
  await getActor(ctx, targetActorId);
  await ctx.db.transaction(async (tx) => {
    await tx.insert(blocks).values({ id: uuidv7(), actorId, targetActorId }).onConflictDoNothing();
    await tx
      .delete(follows)
      .where(
        or(
          and(eq(follows.actorId, actorId), eq(follows.targetActorId, targetActorId)),
          and(eq(follows.actorId, targetActorId), eq(follows.targetActorId, actorId)),
        ),
      );
    await tx
      .delete(followRequests)
      .where(
        or(
          and(eq(followRequests.actorId, actorId), eq(followRequests.targetActorId, targetActorId)),
          and(eq(followRequests.actorId, targetActorId), eq(followRequests.targetActorId, actorId)),
        ),
      );
    const owned = tx
      .select({ id: aspects.id })
      .from(aspects)
      .where(eq(aspects.ownerActorId, actorId));
    await tx
      .delete(aspectMemberships)
      .where(
        and(
          eq(aspectMemberships.actorId, targetActorId),
          inArray(aspectMemberships.aspectId, owned),
        ),
      );
  });
  await emit(ctx, { type: 'block.created', actorId, targetActorId });
  return getRelationship(ctx, actorId, targetActorId);
}

export async function unblock(
  ctx: CoreContext,
  actorId: string,
  targetActorId: string,
): Promise<Relationship> {
  await ctx.db
    .delete(blocks)
    .where(and(eq(blocks.actorId, actorId), eq(blocks.targetActorId, targetActorId)));
  return getRelationship(ctx, actorId, targetActorId);
}

export async function mute(
  ctx: CoreContext,
  actorId: string,
  targetActorId: string,
): Promise<Relationship> {
  if (actorId === targetActorId) throw new DomainError('bad_request', 'You cannot mute yourself');
  await getActor(ctx, targetActorId);
  await ctx.db.insert(mutes).values({ id: uuidv7(), actorId, targetActorId }).onConflictDoNothing();
  return getRelationship(ctx, actorId, targetActorId);
}

export async function unmute(
  ctx: CoreContext,
  actorId: string,
  targetActorId: string,
): Promise<Relationship> {
  await ctx.db
    .delete(mutes)
    .where(and(eq(mutes.actorId, actorId), eq(mutes.targetActorId, targetActorId)));
  return getRelationship(ctx, actorId, targetActorId);
}

export async function getRelationship(ctx: CoreContext, actorId: string, targetActorId: string) {
  const [result] = await getRelationships(ctx, actorId, [targetActorId]);
  if (!result) throw new DomainError('not_found', 'Account not found');
  return result;
}

/** Relationships between `actorId` and each target, in the order of `targetIds`. */
export async function getRelationships(
  ctx: CoreContext,
  actorId: string,
  targetIds: string[],
): Promise<Relationship[]> {
  if (targetIds.length === 0) return [];
  const [following, followedBy, requested, blocking, blockedBy, muting, memberships] =
    await Promise.all([
      ctx.db
        .select({ id: follows.targetActorId })
        .from(follows)
        .where(and(eq(follows.actorId, actorId), inArray(follows.targetActorId, targetIds))),
      ctx.db
        .select({ id: follows.actorId })
        .from(follows)
        .where(and(eq(follows.targetActorId, actorId), inArray(follows.actorId, targetIds))),
      ctx.db
        .select({ id: followRequests.targetActorId })
        .from(followRequests)
        .where(
          and(
            eq(followRequests.actorId, actorId),
            inArray(followRequests.targetActorId, targetIds),
          ),
        ),
      ctx.db
        .select({ id: blocks.targetActorId })
        .from(blocks)
        .where(and(eq(blocks.actorId, actorId), inArray(blocks.targetActorId, targetIds))),
      ctx.db
        .select({ id: blocks.actorId })
        .from(blocks)
        .where(and(eq(blocks.targetActorId, actorId), inArray(blocks.actorId, targetIds))),
      ctx.db
        .select({ id: mutes.targetActorId })
        .from(mutes)
        .where(and(eq(mutes.actorId, actorId), inArray(mutes.targetActorId, targetIds))),
      ctx.db
        .select({ actorId: aspectMemberships.actorId, aspectId: aspectMemberships.aspectId })
        .from(aspectMemberships)
        .innerJoin(aspects, eq(aspects.id, aspectMemberships.aspectId))
        .where(
          and(eq(aspects.ownerActorId, actorId), inArray(aspectMemberships.actorId, targetIds)),
        ),
    ]);
  const set = (rows: { id: string }[]) => new Set(rows.map((r) => r.id));
  const [fo, fb, rq, bl, bb, mu] = [
    following,
    followedBy,
    requested,
    blocking,
    blockedBy,
    muting,
  ].map(set);
  return targetIds.map((id) => ({
    id,
    following: fo?.has(id) ?? false,
    requested: rq?.has(id) ?? false,
    followedBy: fb?.has(id) ?? false,
    blocking: bl?.has(id) ?? false,
    blockedBy: bb?.has(id) ?? false,
    muting: mu?.has(id) ?? false,
    aspectIds: memberships.filter((m) => m.actorId === id).map((m) => m.aspectId),
  }));
}

/** Newest first; `offset` pages through the list. */
export async function listFollowers(
  ctx: CoreContext,
  actorId: string,
  options: { limit?: number; offset?: number } = {},
) {
  return ctx.db
    .select({ actor: actors })
    .from(follows)
    .innerJoin(actors, eq(actors.id, follows.actorId))
    .where(and(eq(follows.targetActorId, actorId), isNull(actors.suspendedAt)))
    .orderBy(sql`${follows.id} desc`)
    .limit(Math.min(options.limit ?? 40, 80))
    .offset(options.offset ?? 0)
    .then((rows) => rows.map((r) => r.actor));
}

/** Newest first; `offset` pages through the list. */
export async function listFollowing(
  ctx: CoreContext,
  actorId: string,
  options: { limit?: number; offset?: number } = {},
) {
  return ctx.db
    .select({ actor: actors })
    .from(follows)
    .innerJoin(actors, eq(actors.id, follows.targetActorId))
    .where(and(eq(follows.actorId, actorId), isNull(actors.suspendedAt)))
    .orderBy(sql`${follows.id} desc`)
    .limit(Math.min(options.limit ?? 40, 80))
    .offset(options.offset ?? 0)
    .then((rows) => rows.map((r) => r.actor));
}
