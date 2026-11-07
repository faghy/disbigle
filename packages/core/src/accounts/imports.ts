import { isLocalDomain } from '@disbigle/config';
import { schema, uuidv7 } from '@disbigle/db';
import type { AccountImport, AccountImportKind } from '@disbigle/shared';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';
import { DomainError } from '../errors.ts';
import { block, follow, mute } from '../social/relationships.ts';
import { findLocalActorByUsername } from './profile.ts';

const { accountImports } = schema;

/** The longest list taken at once. */
export const MAX_IMPORT_ROWS = 5000;
/** How many failed addresses are kept to show. */
const MAX_FAILED_SHOWN = 50;
/** Unfinished imports a person can have at once. */
const MAX_RUNNING = 3;

const ADDRESS = /^@?([^@\s,;"]+)@([^@\s,;"]+\.[^@\s,;"]+)$/;

/**
 * The addresses in a list exported by Mastodon (and compatible software): one per line, first
 * column, with or without a header (`Account address,Show boosts,...`) and a leading `@`.
 */
export function parseImportList(text: string): string[] {
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const first = line.split(',')[0]?.trim().replace(/^"|"$/g, '') ?? '';
    const match = ADDRESS.exec(first);
    if (!match) continue;
    seen.add(`${match[1]}@${match[2]}`.toLowerCase());
  }
  return [...seen];
}

function serialize(row: typeof accountImports.$inferSelect): AccountImport {
  return {
    id: row.id,
    kind: row.kind as AccountImportKind,
    total: row.rows.length,
    done: row.done,
    failedCount: row.failedCount,
    failed: row.failed,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

/** Takes a list to work through in the background. */
export async function createAccountImport(
  ctx: CoreContext,
  actorId: string,
  kind: AccountImportKind,
  text: string,
): Promise<AccountImport> {
  const rows = parseImportList(text);
  if (rows.length === 0)
    throw new DomainError('validation_failed', 'No account addresses found in the file');
  if (rows.length > MAX_IMPORT_ROWS)
    throw new DomainError('validation_failed', `At most ${MAX_IMPORT_ROWS} accounts at a time`);
  const running = await ctx.db
    .select({ id: accountImports.id })
    .from(accountImports)
    .where(and(eq(accountImports.actorId, actorId), isNull(accountImports.finishedAt)));
  if (running.length >= MAX_RUNNING)
    throw new DomainError('bad_request', 'Wait for your other imports to finish');
  const [row] = await ctx.db
    .insert(accountImports)
    .values({ id: uuidv7(), actorId, kind, rows })
    .returning();
  if (!row) throw new Error('Import insert failed');
  return serialize(row);
}

export async function listAccountImports(ctx: CoreContext, actorId: string) {
  const rows = await ctx.db
    .select()
    .from(accountImports)
    .where(eq(accountImports.actorId, actorId))
    .orderBy(desc(accountImports.id))
    .limit(20);
  return rows.map(serialize);
}

/** Finds (fetching it when needed) the account at an address; null when there is none. */
export type AccountFinder = (address: string) => Promise<string | null>;

async function findAccount(ctx: CoreContext, address: string, findRemote: AccountFinder) {
  const [username = '', domain = ''] = address.split('@');
  if (isLocalDomain(ctx.config, domain)) {
    const actor = await findLocalActorByUsername(ctx, username).catch(() => null);
    return actor?.id ?? null;
  }
  return findRemote(address);
}

/**
 * Works through the oldest unfinished imports, `limit` addresses in all: finds each account and
 * follows, blocks or mutes it. Returns how many addresses were handled.
 */
export async function processAccountImports(
  ctx: CoreContext,
  findRemote: AccountFinder,
  limit = 20,
): Promise<number> {
  const pending = await ctx.db
    .select()
    .from(accountImports)
    .where(isNull(accountImports.finishedAt))
    .orderBy(asc(accountImports.id))
    .limit(5);
  let handled = 0;
  for (const job of pending) {
    let { position, done, failedCount } = job;
    const failed = [...job.failed];
    while (position < job.rows.length && handled < limit) {
      const address = job.rows[position] as string;
      position += 1;
      handled += 1;
      try {
        const target = await findAccount(ctx, address, findRemote);
        if (!target) throw new Error('not found');
        if (job.kind === 'following') await follow(ctx, job.actorId, target);
        else if (job.kind === 'blocks') await block(ctx, job.actorId, target);
        else await mute(ctx, job.actorId, target);
        done += 1;
      } catch {
        failedCount += 1;
        if (failed.length < MAX_FAILED_SHOWN) failed.push(address);
      }
    }
    await ctx.db
      .update(accountImports)
      .set({
        position,
        done,
        failedCount,
        failed,
        ...(position >= job.rows.length ? { finishedAt: new Date() } : {}),
      })
      .where(eq(accountImports.id, job.id));
    if (handled >= limit) break;
  }
  return handled;
}
