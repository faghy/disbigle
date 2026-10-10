import { schema, uuidv7 } from '@disbigle/db';
import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { serializeAccount } from './accounts/serialize.ts';
import type { CoreContext } from './context.ts';
import { DomainError } from './errors.ts';

const { users, actors, sessions, follows, followRequests, domainBlocks, reports, adminActionLogs, posts } = schema;

export type ReportCategory = 'spam' | 'illegal' | 'harassment' | 'violation' | 'other';

export async function logAdminAction(
  ctx: CoreContext,
  userId: string,
  action: string,
  target: { type: string; id: string },
  details: Record<string, unknown> = {},
): Promise<void> {
  await ctx.db.insert(adminActionLogs).values({
    id: uuidv7(),
    userId,
    action,
    targetType: target.type,
    targetId: target.id,
    details,
  });
}

/** Accounts waiting for approval (registration mode `approval`), oldest first. */
export async function listPendingUsers(ctx: CoreContext) {
  const rows = await ctx.db
    .select({ user: users, actor: actors })
    .from(users)
    .innerJoin(actors, eq(actors.id, users.actorId))
    .where(eq(users.approved, false))
    .orderBy(users.createdAt);
  return rows.map(({ user, actor }) => ({
    userId: user.id,
    email: user.email,
    reason: user.registrationReason ?? '',
    createdAt: user.createdAt.toISOString(),
    account: serializeAccount(actor),
  }));
}

export async function approveUser(ctx: CoreContext, moderatorUserId: string, userId: string): Promise<void> {
  const updated = await ctx.db
    .update(users)
    .set({ approved: true, updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.approved, false)))
    .returning({ id: users.id });
  if (updated.length === 0) throw new DomainError('not_found', 'Pending account not found');
  await logAdminAction(ctx, moderatorUserId, 'approve_user', { type: 'user', id: userId });
}

/** Rejecting a pending registration deletes it entirely. */
export async function rejectUser(ctx: CoreContext, moderatorUserId: string, userId: string): Promise<void> {
  const [user] = await ctx.db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.approved, false)));
  if (!user) throw new DomainError('not_found', 'Pending account not found');
  await ctx.db.delete(actors).where(eq(actors.id, user.actorId));
  await logAdminAction(ctx, moderatorUserId, 'reject_user', { type: 'user', id: userId }, { email: user.email });
}

export async function listAccountsForAdmin(
  ctx: CoreContext,
  filter: { query?: string; origin?: 'local' | 'remote'; status?: 'active' | 'suspended'; limit?: number },
) {
  const term = filter.query ? `%${filter.query.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const rows = await ctx.db
    .select({ actor: actors, user: users })
    .from(actors)
    .leftJoin(users, eq(users.actorId, actors.id))
    .where(
      and(
        term ? or(ilike(actors.username, term), ilike(actors.displayName, term), ilike(actors.domain, term)) : undefined,
        filter.origin === 'local' ? isNull(actors.domain) : filter.origin === 'remote' ? isNotNull(actors.domain) : undefined,
        filter.status === 'suspended'
          ? isNotNull(actors.suspendedAt)
          : filter.status === 'active'
            ? isNull(actors.suspendedAt)
            : undefined,
      ),
    )
    .orderBy(desc(actors.id))
    .limit(Math.min(filter.limit ?? 50, 200));
  return rows.map(({ actor, user }) => ({
    account: serializeAccount(actor),
    domain: actor.domain,
    suspended: actor.suspendedAt !== null,
    user: user
      ? {
          id: user.id,
          email: user.email,
          role: user.role,
          approved: user.approved,
          lastSignInAt: user.lastSignInAt?.toISOString() ?? null,
        }
      : null,
  }));
}

/** Suspends an account: hidden everywhere, signed out, follows removed. Reversible. */
export async function suspendAccount(
  ctx: CoreContext,
  moderatorUserId: string,
  actorId: string,
  reason = '',
): Promise<void> {
  const [actor] = await ctx.db.select().from(actors).where(eq(actors.id, actorId));
  if (!actor) throw new DomainError('not_found', 'Account not found');
  const [moderator] = await ctx.db.select().from(users).where(eq(users.id, moderatorUserId));
  if (moderator?.actorId === actorId) throw new DomainError('bad_request', 'You cannot suspend yourself');
  const [target] = await ctx.db.select().from(users).where(eq(users.actorId, actorId));
  if (target?.role === 'admin') throw new DomainError('forbidden', 'Administrators cannot be suspended');

  await ctx.db.transaction(async (tx) => {
    await tx.update(actors).set({ suspendedAt: new Date() }).where(eq(actors.id, actorId));
    await tx.delete(follows).where(or(eq(follows.actorId, actorId), eq(follows.targetActorId, actorId)));
    await tx
      .delete(followRequests)
      .where(or(eq(followRequests.actorId, actorId), eq(followRequests.targetActorId, actorId)));
    if (target) await tx.delete(sessions).where(eq(sessions.userId, target.id));
  });
  await logAdminAction(ctx, moderatorUserId, 'suspend_account', { type: 'actor', id: actorId }, { reason });
}

export async function unsuspendAccount(ctx: CoreContext, moderatorUserId: string, actorId: string): Promise<void> {
  const updated = await ctx.db
    .update(actors)
    .set({ suspendedAt: null })
    .where(eq(actors.id, actorId))
    .returning({ id: actors.id });
  if (updated.length === 0) throw new DomainError('not_found', 'Account not found');
  await logAdminAction(ctx, moderatorUserId, 'unsuspend_account', { type: 'actor', id: actorId });
}

export async function setUserRole(
  ctx: CoreContext,
  adminUserId: string,
  userId: string,
  role: 'user' | 'moderator' | 'admin',
): Promise<void> {
  if (adminUserId === userId) throw new DomainError('bad_request', 'You cannot change your own role');
  const updated = await ctx.db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  if (updated.length === 0) throw new DomainError('not_found', 'User not found');
  await logAdminAction(ctx, adminUserId, 'set_role', { type: 'user', id: userId }, { role });
}

export const normalizeDomain = (domain: string) =>
  domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');

export async function listDomainBlocks(ctx: CoreContext) {
  const rows = await ctx.db.select().from(domainBlocks).orderBy(domainBlocks.domain);
  return rows.map((b) => ({
    id: b.id,
    domain: b.domain,
    severity: b.severity,
    publicComment: b.publicComment,
    privateComment: b.privateComment,
    createdAt: b.createdAt.toISOString(),
  }));
}

/**
 * Blocks a whole server. `silence` keeps it out of public timelines; `suspend` also stops
 * federation with it and suspends its accounts.
 */
export async function blockDomain(
  ctx: CoreContext,
  moderatorUserId: string,
  input: { domain: string; severity: 'silence' | 'suspend'; publicComment?: string; privateComment?: string },
) {
  const domain = normalizeDomain(input.domain);
  if (!domain || domain === ctx.config.LOCAL_DOMAIN.toLowerCase()) {
    throw new DomainError('validation_failed', 'Invalid domain', [{ path: 'domain', message: 'Invalid domain' }]);
  }
  await ctx.db
    .insert(domainBlocks)
    .values({
      id: uuidv7(),
      domain,
      severity: input.severity,
      publicComment: input.publicComment ?? '',
      privateComment: input.privateComment ?? '',
    })
    .onConflictDoUpdate({
      target: domainBlocks.domain,
      set: {
        severity: input.severity,
        publicComment: input.publicComment ?? '',
        privateComment: input.privateComment ?? '',
      },
    });
  if (input.severity === 'suspend') {
    const remote = ctx.db.select({ id: actors.id }).from(actors).where(sql`lower(${actors.domain}) = ${domain}`);
    await ctx.db.transaction(async (tx) => {
      await tx.update(actors).set({ suspendedAt: new Date() }).where(sql`lower(${actors.domain}) = ${domain}`);
      await tx.delete(follows).where(or(inArray(follows.actorId, remote), inArray(follows.targetActorId, remote)));
      await tx
        .delete(followRequests)
        .where(or(inArray(followRequests.actorId, remote), inArray(followRequests.targetActorId, remote)));
    });
  }
  await logAdminAction(ctx, moderatorUserId, 'block_domain', { type: 'domain', id: domain }, { severity: input.severity });
}

export async function unblockDomain(ctx: CoreContext, moderatorUserId: string, domain: string) {
  const normalized = normalizeDomain(domain);
  const [removed] = await ctx.db.delete(domainBlocks).where(eq(domainBlocks.domain, normalized)).returning();
  if (!removed) throw new DomainError('not_found', 'Domain block not found');
  if (removed.severity === 'suspend') {
    await ctx.db.update(actors).set({ suspendedAt: null }).where(sql`lower(${actors.domain}) = ${normalized}`);
  }
  await logAdminAction(ctx, moderatorUserId, 'unblock_domain', { type: 'domain', id: normalized });
}

/** Severity of the block on a domain (or a parent domain), if any. */
export async function domainBlockSeverity(ctx: CoreContext, domain: string): Promise<'silence' | 'suspend' | null> {
  const host = normalizeDomain(domain).replace(/:\d+$/, '');
  const candidates = host.split('.').map((_, i, parts) => parts.slice(i).join('.'));
  const rows = await ctx.db
    .select({ severity: domainBlocks.severity })
    .from(domainBlocks)
    .where(inArray(domainBlocks.domain, [normalizeDomain(domain), ...candidates]));
  if (rows.some((r) => r.severity === 'suspend')) return 'suspend';
  return rows.length > 0 ? 'silence' : null;
}

export async function createReport(
  ctx: CoreContext,
  reporterActorId: string,
  input: { accountId: string; statusIds?: string[]; category?: ReportCategory; comment?: string },
) {
  if (input.accountId === reporterActorId) throw new DomainError('bad_request', 'You cannot report yourself');
  const [target] = await ctx.db.select().from(actors).where(eq(actors.id, input.accountId));
  if (!target) throw new DomainError('not_found', 'Account not found');
  const statusIds = [...new Set(input.statusIds ?? [])].slice(0, 20);
  if (statusIds.length > 0) {
    const owned = await ctx.db
      .select({ id: posts.id })
      .from(posts)
      .where(and(inArray(posts.id, statusIds), eq(posts.actorId, target.id)));
    if (owned.length !== statusIds.length) throw new DomainError('not_found', 'Post not found');
  }
  const id = uuidv7();
  await ctx.db.insert(reports).values({
    id,
    reporterActorId,
    targetActorId: target.id,
    postIds: statusIds,
    category: input.category ?? 'other',
    comment: (input.comment ?? '').slice(0, 1000),
  });
  return { id };
}

export async function listReports(ctx: CoreContext, options: { resolved?: boolean } = {}) {
  const reporter = schema.actors;
  const rows = await ctx.db
    .select()
    .from(reports)
    .where(options.resolved ? isNotNull(reports.resolvedAt) : isNull(reports.resolvedAt))
    .orderBy(desc(reports.id))
    .limit(100);
  const actorIds = [...new Set(rows.flatMap((r) => [r.reporterActorId, r.targetActorId]))];
  const actorRows = actorIds.length > 0 ? await ctx.db.select().from(reporter).where(inArray(reporter.id, actorIds)) : [];
  const byId = new Map(actorRows.map((a) => [a.id, serializeAccount(a)]));
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    comment: r.comment,
    statusIds: r.postIds,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    reporter: byId.get(r.reporterActorId) ?? null,
    target: byId.get(r.targetActorId) ?? null,
  }));
}

export async function resolveReport(ctx: CoreContext, moderatorUserId: string, reportId: string) {
  const updated = await ctx.db
    .update(reports)
    .set({ resolvedAt: new Date(), resolvedById: moderatorUserId })
    .where(and(eq(reports.id, reportId), isNull(reports.resolvedAt)))
    .returning({ id: reports.id });
  if (updated.length === 0) throw new DomainError('not_found', 'Open report not found');
  await logAdminAction(ctx, moderatorUserId, 'resolve_report', { type: 'report', id: reportId });
}

export async function countOpenModerationItems(ctx: CoreContext) {
  const [[pending], [open]] = await Promise.all([
    ctx.db.select({ n: sql<number>`count(*)::int` }).from(users).where(eq(users.approved, false)),
    ctx.db.select({ n: sql<number>`count(*)::int` }).from(reports).where(isNull(reports.resolvedAt)),
  ]);
  return { pendingUsers: pending?.n ?? 0, openReports: open?.n ?? 0 };
}
