import { isLocalDomain } from '@disbigle/config';
import { schema, uuidv7 } from '@disbigle/db';
import type { AccountImport, AccountImportKind } from '@disbigle/shared';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';
import { DomainError } from '../errors.ts';
import { createAspect, listAspects, setAspectMemberships } from '../social/aspects.ts';
import { block, follow, mute } from '../social/relationships.ts';
import { followTag } from '../social/tags.ts';
import { findLocalActorByUsername, updateProfile } from './profile.ts';

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
  return createImportRows(ctx, actorId, kind, parseImportList(text));
}

/**
 * Queues addresses to follow, block or mute. A row is `address`, or `address|aspectId,...` to
 * also put the person in those aspects once followed.
 */
async function createImportRows(
  ctx: CoreContext,
  actorId: string,
  kind: AccountImportKind,
  rows: string[],
): Promise<AccountImport> {
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
      const [address = '', aspectList = ''] = (job.rows[position] as string).split('|');
      position += 1;
      handled += 1;
      try {
        const target = await findAccount(ctx, address, findRemote);
        if (!target) throw new Error('not found');
        if (job.kind === 'following') {
          await follow(ctx, job.actorId, target);
          const aspectIds = aspectList.split(',').filter(Boolean);
          if (aspectIds.length > 0) await setAspectMemberships(ctx, job.actorId, target, aspectIds);
        } else if (job.kind === 'blocks') await block(ctx, job.actorId, target);
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

/** What the web app takes from a diaspora* export (read in the browser: the key never leaves it). */
export interface DiasporaImport {
  /** Use the old profile's name and description here. */
  displayName?: string | undefined;
  bio?: string | undefined;
  aspects: string[];
  /** People the user shared with, and the aspects they were in. */
  contacts: { address: string; aspects: string[] }[];
  tags: string[];
  blocks: string[];
}

const valid = (address: string) => ADDRESS.exec(address.trim());

/**
 * Brings what a diaspora* export holds: profile name and description, aspects, followed
 * hashtags right away; the contacts (followed and put back in their aspects) and the blocked
 * people in the background, as the other imports.
 */
export async function importDiasporaData(
  ctx: CoreContext,
  actorId: string,
  data: DiasporaImport,
): Promise<{ aspects: number; tags: number; imports: AccountImport[] }> {
  if (data.displayName !== undefined || data.bio !== undefined) {
    await updateProfile(ctx, actorId, {
      ...(data.displayName ? { displayName: data.displayName.slice(0, 100) } : {}),
      ...(data.bio ? { note: data.bio.slice(0, 5000) } : {}),
    });
  }
  const existing = await listAspects(ctx, actorId);
  const byName = new Map(existing.map((a) => [a.name.trim().toLowerCase(), a.id]));
  let createdAspects = 0;
  for (const name of [...new Set(data.aspects.map((n) => n.trim()).filter(Boolean))].slice(0, 50)) {
    if (byName.has(name.toLowerCase())) continue;
    try {
      const aspect = await createAspect(ctx, actorId, name.slice(0, 100));
      byName.set(name.toLowerCase(), aspect.id);
      createdAspects += 1;
    } catch {
      // A name the aspects refuse: its people are still followed.
    }
  }
  let tags = 0;
  for (const tag of [...new Set(data.tags)].slice(0, 200)) {
    try {
      await followTag(ctx, actorId, tag);
      tags += 1;
    } catch {
      // Not a valid hashtag here.
    }
  }
  const imports: AccountImport[] = [];
  const contactRows = data.contacts.flatMap((contact) => {
    const match = valid(contact.address);
    if (!match) return [];
    const ids = contact.aspects
      .map((name) => byName.get(name.trim().toLowerCase()))
      .filter((id): id is string => Boolean(id));
    const address = `${match[1]}@${match[2]}`.toLowerCase();
    return [ids.length > 0 ? `${address}|${[...new Set(ids)].join(',')}` : address];
  });
  if (contactRows.length > 0)
    imports.push(
      await createImportRows(ctx, actorId, 'following', contactRows.slice(0, MAX_IMPORT_ROWS)),
    );
  const blockRows = data.blocks.flatMap((address) => {
    const match = valid(address);
    return match ? [`${match[1]}@${match[2]}`.toLowerCase()] : [];
  });
  if (blockRows.length > 0)
    imports.push(
      await createImportRows(ctx, actorId, 'blocks', blockRows.slice(0, MAX_IMPORT_ROWS)),
    );
  return { aspects: createdAspects, tags, imports };
}
