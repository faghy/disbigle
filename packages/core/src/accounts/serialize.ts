import { schema } from '@disbigle/db';
import type { Account } from '@disbigle/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';

type ActorRow = typeof schema.actors.$inferSelect;

export function serializeAccount(actor: ActorRow): Account {
  return {
    id: actor.id,
    username: actor.username,
    acct: actor.domain ? `${actor.username}@${actor.domain}` : actor.username,
    displayName: actor.displayName,
    note: actor.summary,
    avatarUrl: actor.avatarUrl,
    headerUrl: actor.headerUrl,
    fields: actor.fields,
    locked: actor.locked,
    bot: actor.bot,
    discoverable: actor.discoverable,
    local: actor.domain === null,
    url: actor.apUrl,
    createdAt: actor.createdAt.toISOString(),
    movedToId: actor.movedToActorId,
    ...(actor.isGroup ? { group: true } : {}),
  };
}

/** Account with follower, following and post counts, for profile pages. */
export async function getAccountWithCounts(ctx: CoreContext, actor: ActorRow): Promise<Account> {
  const { follows, posts } = schema;
  const [[followers], [following], [statuses]] = await Promise.all([
    ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(follows)
      .where(eq(follows.targetActorId, actor.id)),
    ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(follows)
      .where(eq(follows.actorId, actor.id)),
    ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(posts)
      .where(
        and(
          eq(posts.actorId, actor.id),
          inArray(posts.visibility, ['public', 'unlisted']),
          isNull(posts.groupId),
        ),
      ),
  ]);
  return {
    ...serializeAccount(actor),
    followersCount: followers?.n ?? 0,
    followingCount: following?.n ?? 0,
    statusesCount: statuses?.n ?? 0,
  };
}
