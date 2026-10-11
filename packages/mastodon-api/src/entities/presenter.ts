import { type CoreContext, getRelationships, serializeAccount } from '@disbigle/core';
import { schema } from '@disbigle/db';
import type { Account, Notification, Status } from '@disbigle/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  type AccountExtras,
  type MapContext,
  mapAccount,
  mapContext,
  mapNotification,
  mapRelationship,
  mapStatus,
} from './mappers.ts';
import type { MAccount, MNotification, MRelationship, MStatus } from './types.ts';

const { follows, posts, actors, followRequests } = schema;

/** Follower/following/post counts and last post date, for many accounts in three queries. */
export async function loadAccountExtras(
  ctx: CoreContext,
  ids: string[],
): Promise<Map<string, AccountExtras>> {
  const result = new Map<string, AccountExtras>();
  if (ids.length === 0) return result;
  const [followers, following, statuses] = await Promise.all([
    ctx.db
      .select({ id: follows.targetActorId, n: sql<number>`count(*)::int` })
      .from(follows)
      .where(inArray(follows.targetActorId, ids))
      .groupBy(follows.targetActorId),
    ctx.db
      .select({ id: follows.actorId, n: sql<number>`count(*)::int` })
      .from(follows)
      .where(inArray(follows.actorId, ids))
      .groupBy(follows.actorId),
    ctx.db
      .select({
        id: posts.actorId,
        n: sql<number>`count(*)::int`,
        last: sql<Date | null>`max(${posts.createdAt})`.mapWith(posts.createdAt),
      })
      .from(posts)
      .where(and(inArray(posts.actorId, ids), inArray(posts.visibility, ['public', 'unlisted'])))
      .groupBy(posts.actorId),
  ]);
  for (const id of ids) {
    const s = statuses.find((r) => r.id === id);
    result.set(id, {
      followersCount: followers.find((r) => r.id === id)?.n ?? 0,
      followingCount: following.find((r) => r.id === id)?.n ?? 0,
      statusesCount: s?.n ?? 0,
      lastStatusAt: s?.last ?? null,
    });
  }
  return result;
}

function collectAccounts(statuses: (Status | null | undefined)[], into: Map<string, Account>) {
  for (const status of statuses) {
    if (!status) continue;
    into.set(status.account.id, status.account);
    if (status.reblog) into.set(status.reblog.account.id, status.reblog.account);
  }
}

/**
 * Turns our API objects into Mastodon entities for one viewer, loading what Mastodon shows on
 * every account (counts, last post date, the account it moved to) in a few batched queries.
 */
export class Presenter {
  readonly map: MapContext;

  constructor(
    private readonly ctx: CoreContext,
    private readonly viewerActorId: string | null,
  ) {
    this.map = mapContext(ctx.config.PUBLIC_URL);
  }

  private async enrich(accounts: Iterable<Account>): Promise<void> {
    const list = [...accounts];
    const ids = [...new Set(list.map((a) => a.id))].filter((id) => !this.map.extras?.has(id));
    const movedIds = [
      ...new Set(list.map((a) => a.movedToId).filter((id): id is string => !!id)),
    ].filter((id) => !this.map.moved?.has(id));
    const [extras, movedRows] = await Promise.all([
      loadAccountExtras(this.ctx, ids),
      movedIds.length > 0
        ? this.ctx.db.select().from(actors).where(inArray(actors.id, movedIds))
        : [],
    ]);
    this.map.extras = new Map([...(this.map.extras ?? []), ...extras]);
    this.map.moved = new Map([
      ...(this.map.moved ?? []),
      ...movedRows.map((row) => [row.id, serializeAccount(row)] as const),
    ]);
  }

  async accounts(accounts: Account[]): Promise<MAccount[]> {
    await this.enrich(accounts);
    return accounts.map((a) => mapAccount(this.map, a));
  }

  async account(account: Account): Promise<MAccount> {
    const [result] = await this.accounts([account]);
    if (!result) throw new Error('Account mapping failed');
    return result;
  }

  async statuses(statuses: Status[], options: { includeSource?: boolean } = {}) {
    const accounts = new Map<string, Account>();
    collectAccounts(statuses, accounts);
    await this.enrich(accounts.values());
    return statuses.map((s) =>
      mapStatus(this.map, s, {
        signedIn: this.viewerActorId !== null,
        ...(options.includeSource ? { includeSource: true } : {}),
      }),
    );
  }

  async status(status: Status, options: { includeSource?: boolean } = {}): Promise<MStatus> {
    const [result] = await this.statuses([status], options);
    if (!result) throw new Error('Status mapping failed');
    return result;
  }

  async notifications(notifications: Notification[]): Promise<MNotification[]> {
    const accounts = new Map<string, Account>();
    for (const n of notifications) accounts.set(n.account.id, n.account);
    collectAccounts(
      notifications.map((n) => n.status),
      accounts,
    );
    await this.enrich(accounts.values());
    return notifications.map((n) => mapNotification(this.map, n));
  }

  async relationships(targetIds: string[]): Promise<MRelationship[]> {
    if (!this.viewerActorId || targetIds.length === 0) return [];
    const viewer = this.viewerActorId;
    const [relationships, requestedBy] = await Promise.all([
      getRelationships(this.ctx, viewer, targetIds),
      this.ctx.db
        .select({ id: followRequests.actorId })
        .from(followRequests)
        .where(
          and(eq(followRequests.targetActorId, viewer), inArray(followRequests.actorId, targetIds)),
        ),
    ]);
    const incoming = new Set(requestedBy.map((r) => r.id));
    return relationships.map((rel) => mapRelationship(rel, incoming.has(rel.id)));
  }

  async relationship(targetId: string): Promise<MRelationship> {
    const [result] = await this.relationships([targetId]);
    if (!result) throw new Error('Relationship mapping failed');
    return result;
  }
}
