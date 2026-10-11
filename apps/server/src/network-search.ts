import { type ActorRow, type CoreContext, domainBlockSeverity } from '@disbigle/core';
import { schema } from '@disbigle/db';
import { and, count, desc, isNotNull, isNull, sql } from 'drizzle-orm';

/** Servers asked at most per search, the busiest first. */
export const NETWORK_SEARCH_SERVERS = 40;
const CONCURRENCY = 6;
const PER_SERVER_MS = 6_000;
const MISS_TTL_SECONDS = 60 * 60;

export const NICK_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;

const timeout = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

/**
 * Looks for people called `nick` on the servers this one already talks to. The fediverse has
 * no global directory, so a bare nickname can only be tried as `nick@server` on servers we know
 * of: those of the accounts we have met. Nothing goes to a third-party search service.
 */
export async function searchNetwork(
  ctx: CoreContext,
  nick: string,
  resolve: (handle: string) => Promise<ActorRow | null>,
): Promise<{ accounts: ActorRow[]; servers: number }> {
  if (!NICK_PATTERN.test(nick)) return { accounts: [], servers: 0 };
  const { actors } = schema;
  const known = await ctx.db
    .select({ domain: actors.domain, n: count() })
    .from(actors)
    .where(and(isNotNull(actors.domain), isNull(actors.suspendedAt)))
    .groupBy(actors.domain)
    .orderBy(desc(count()))
    .limit(NETWORK_SEARCH_SERVERS);
  const domains: string[] = [];
  for (const { domain } of known) {
    if (domain && (await domainBlockSeverity(ctx, domain)) !== 'suspend') domains.push(domain);
  }

  // People with that name we already know: no request needed.
  const already = await ctx.db
    .select()
    .from(actors)
    .where(
      and(
        isNotNull(actors.domain),
        isNull(actors.suspendedAt),
        sql`lower(${actors.username}) = lower(${nick})`,
      ),
    );
  const found = new Map(already.map((a) => [a.id, a]));
  const knownDomains = new Set(already.map((a) => a.domain?.toLowerCase()));

  const queue = domains.filter((d) => !knownDomains.has(d.toLowerCase()));
  const worker = async () => {
    for (let domain = queue.shift(); domain; domain = queue.shift()) {
      const handle = `${nick}@${domain}`.toLowerCase();
      const missKey = `network-search-miss:${handle}`;
      if (await ctx.kv.get(missKey)) continue;
      const actor = await timeout(
        resolve(handle).catch(() => null),
        PER_SERVER_MS,
      );
      if (actor && !actor.suspendedAt && actor.domain !== null) found.set(actor.id, actor);
      else await ctx.kv.set(missKey, '1', MISS_TTL_SECONDS);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { accounts: [...found.values()], servers: domains.length };
}
