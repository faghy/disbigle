import { schema } from '@disbigle/db';
import { and, desc, eq, gte, ilike, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { type CoreContext, lastDays } from './context.ts';

const { users, actors, sessions, oauthAccessTokens, webauthnCredentials, follows, posts, groups } =
  schema;

/** Federation traffic metrics kept in `ctx.counters`: activities received and failed deliveries. */
export const federationMetrics = {
  /** Activities POSTed to our inboxes, by sending server. */
  inbound: 'federation:inbound',
  /** Of those, the ones we refused (bad signature, blocked, malformed…). */
  rejected: 'federation:rejected',
  /** Deliveries to other servers that failed, by receiving server. */
  failed: 'federation:failed',
} as const;

/** Counts a delivery to our inboxes; `domain` is the sender when it is known. */
export async function recordInboundActivity(
  ctx: CoreContext,
  domain: string,
  accepted: boolean,
): Promise<void> {
  await ctx.counters?.hit(federationMetrics.inbound, domain);
  if (!accepted) await ctx.counters?.hit(federationMetrics.rejected, domain);
}

/** Counts a failed delivery to another server. */
export async function recordFailedDelivery(ctx: CoreContext, domain: string): Promise<void> {
  await ctx.counters?.hit(federationMetrics.failed, domain);
}

const DAYS = 30;

/** When the user last did something: signed in, used a session, or used an app token. */
const lastActiveAt = sql<Date | null>`greatest(
  ${users.lastSignInAt},
  (select max(${sessions.lastUsedAt}) from ${sessions} where ${sessions.userId} = ${users.id}),
  (select max(${oauthAccessTokens.lastUsedAt}) from ${oauthAccessTokens}
    where ${oauthAccessTokens.userId} = ${users.id})
)`;

/** Rows per UTC day over the last DAYS days, zero-filled, oldest first. */
async function perDay(
  ctx: CoreContext,
  column: typeof users.createdAt | typeof posts.createdAt,
  table: typeof users | typeof posts,
  where?: ReturnType<typeof and>,
) {
  const since = new Date(Date.now() - DAYS * 86_400_000);
  const day = sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD')`;
  const rows = await ctx.db
    .select({ day, n: sql<number>`count(*)::int` })
    .from(table)
    .where(and(gte(column, since), where))
    .groupBy(day);
  const byDay = new Map(rows.map((r) => [r.day, r.n]));
  return lastDays(DAYS).map((d) => ({ day: d, count: byDay.get(d) ?? 0 }));
}

async function count(query: Promise<{ n: number }[]>): Promise<number> {
  const [row] = await query;
  return row?.n ?? 0;
}

/** Totals and daily series about people, content and federation for the admin dashboard. */
export async function adminDashboardStats(ctx: CoreContext) {
  const n = sql<number>`count(*)::int`;
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
  const localUser = and(eq(actors.isGroup, false), isNull(users.deletionRequestedAt));
  const usersFrom = () =>
    ctx.db.select({ n }).from(users).innerJoin(actors, eq(actors.id, users.actorId));
  const activeSince = (days: number) =>
    count(
      usersFrom().where(
        and(localUser, sql`${lastActiveAt} >= ${ago(days).toISOString()}::timestamptz`),
      ),
    );

  const [
    total,
    pending,
    suspended,
    active1,
    active7,
    active30,
    new7,
    new30,
    localPosts,
    remotePosts,
    groupCount,
    remoteAccounts,
    instances,
    remoteFollowers,
    remoteFollowing,
    signups,
    localPostsDaily,
    remotePostsDaily,
  ] = await Promise.all([
    count(usersFrom().where(localUser)),
    count(usersFrom().where(and(localUser, eq(users.approved, false)))),
    count(usersFrom().where(and(localUser, isNotNull(actors.suspendedAt)))),
    activeSince(1),
    activeSince(7),
    activeSince(30),
    count(usersFrom().where(and(localUser, gte(users.createdAt, ago(7))))),
    count(usersFrom().where(and(localUser, gte(users.createdAt, ago(30))))),
    count(ctx.db.select({ n }).from(posts).where(eq(posts.local, true))),
    count(ctx.db.select({ n }).from(posts).where(eq(posts.local, false))),
    count(ctx.db.select({ n }).from(groups)),
    count(ctx.db.select({ n }).from(actors).where(isNotNull(actors.domain))),
    count(
      ctx.db
        .select({ n: sql<number>`count(distinct lower(${actors.domain}))::int` })
        .from(actors)
        .where(isNotNull(actors.domain)),
    ),
    count(
      ctx.db
        .select({ n })
        .from(follows)
        .where(
          sql`exists (select 1 from ${actors} a where a.id = ${follows.actorId} and a.domain is not null)
            and exists (select 1 from ${actors} t where t.id = ${follows.targetActorId} and t.domain is null)`,
        ),
    ),
    count(
      ctx.db
        .select({ n })
        .from(follows)
        .where(
          sql`exists (select 1 from ${actors} a where a.id = ${follows.actorId} and a.domain is null)
            and exists (select 1 from ${actors} t where t.id = ${follows.targetActorId} and t.domain is not null)`,
        ),
    ),
    perDay(ctx, users.createdAt, users),
    perDay(ctx, posts.createdAt, posts, and(eq(posts.local, true))),
    perDay(ctx, posts.createdAt, posts, and(eq(posts.local, false))),
  ]);

  return {
    users: {
      total,
      pending,
      suspended,
      active: { day: active1, week: active7, month: active30 },
      new: { week: new7, month: new30 },
    },
    content: { localPosts, remotePosts, groups: groupCount },
    federation: { remoteAccounts, instances, remoteFollowers, remoteFollowing },
    daily: { signups, localPosts: localPostsDaily, remotePosts: remotePostsDaily },
  };
}

/** Federation traffic of the last 30 days: per day, and the busiest servers of the last week. */
export async function federationTraffic(ctx: CoreContext) {
  const [inbound, rejected, failed] = await Promise.all([
    ctx.counters?.read(federationMetrics.inbound, DAYS) ?? [],
    ctx.counters?.read(federationMetrics.rejected, DAYS) ?? [],
    ctx.counters?.read(federationMetrics.failed, DAYS) ?? [],
  ]);
  const sum = (counts: Record<string, number>) =>
    Object.values(counts).reduce((total, value) => total + value, 0);
  const days = lastDays(DAYS);
  const series = (buckets: { day: string; counts: Record<string, number> }[]) => {
    const byDay = new Map(buckets.map((b) => [b.day, sum(b.counts)]));
    return days.map((day) => ({ day, count: byDay.get(day) ?? 0 }));
  };
  const lastWeek = (buckets: { day: string; counts: Record<string, number> }[]) => {
    const totals = new Map<string, number>();
    for (const bucket of buckets.slice(-7))
      for (const [domain, value] of Object.entries(bucket.counts))
        totals.set(domain, (totals.get(domain) ?? 0) + value);
    return totals;
  };
  const received = lastWeek(inbound);
  const refused = lastWeek(rejected);
  const failures = lastWeek(failed);
  const domains = [...new Set([...received.keys(), ...failures.keys()])];
  const servers = domains
    .map((domain) => ({
      domain,
      received: received.get(domain) ?? 0,
      rejected: refused.get(domain) ?? 0,
      failedDeliveries: failures.get(domain) ?? 0,
    }))
    .sort((a, b) => b.received + b.failedDeliveries - (a.received + a.failedDeliveries))
    .slice(0, 25);
  return {
    counting: ctx.counters !== undefined,
    daily: { received: series(inbound), rejected: series(rejected), failed: series(failed) },
    servers,
  };
}

/** Local people with what an administrator needs to look after them. */
export async function listUsersForAdmin(
  ctx: CoreContext,
  options: { query?: string; limit?: number; offset?: number } = {},
) {
  const term = options.query ? `%${options.query.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const rows = await ctx.db
    .select({
      userId: users.id,
      actorId: actors.id,
      username: actors.username,
      displayName: actors.displayName,
      avatarUrl: actors.avatarUrl,
      email: users.email,
      role: users.role,
      approved: users.approved,
      locale: users.locale,
      createdAt: users.createdAt,
      lastSignInAt: users.lastSignInAt,
      lastActiveAt,
      lastIp: sql<string | null>`(select ${sessions.ip} from ${sessions}
        where ${sessions.userId} = ${users.id} order by ${sessions.lastUsedAt} desc limit 1)`,
      posts: sql<number>`(select count(*)::int from ${posts}
        where ${posts.actorId} = ${actors.id} and ${posts.reblogOfId} is null)`,
      followers: sql<number>`(select count(*)::int from ${follows}
        where ${follows.targetActorId} = ${actors.id})`,
      following: sql<number>`(select count(*)::int from ${follows}
        where ${follows.actorId} = ${actors.id})`,
      twoFactor: sql<boolean>`(${users.totpEnabledAt} is not null or exists (
        select 1 from ${webauthnCredentials} where ${webauthnCredentials.userId} = ${users.id}))`,
      suspendedAt: actors.suspendedAt,
      disabledAt: users.disabledAt,
      deletionRequestedAt: users.deletionRequestedAt,
    })
    .from(users)
    .innerJoin(actors, eq(actors.id, users.actorId))
    .where(
      and(
        eq(actors.isGroup, false),
        term
          ? or(
              ilike(actors.username, term),
              ilike(actors.displayName, term),
              ilike(users.email, term),
            )
          : undefined,
      ),
    )
    .orderBy(desc(users.createdAt))
    .limit(Math.min(options.limit ?? 100, 500))
    .offset(options.offset ?? 0);
  const iso = (value: Date | string | null) => (value ? new Date(value).toISOString() : null);
  return rows.map(({ suspendedAt, disabledAt, deletionRequestedAt, ...row }) => ({
    ...row,
    createdAt: iso(row.createdAt) as string,
    lastSignInAt: iso(row.lastSignInAt),
    lastActiveAt: iso(row.lastActiveAt),
    suspended: suspendedAt !== null,
    disabled: disabledAt !== null,
    deletionRequested: deletionRequestedAt !== null,
  }));
}
