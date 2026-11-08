import { schema } from '@disbigle/db';
import { eq } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';
import { blockDomain, unblockDomain } from '../moderation.ts';

/**
 * IFTAS "Do Not Interact": a small list of servers with severe, documented harm (hate,
 * harassment, illegal content), reviewed by people, that IFTAS is very unlikely to retract.
 * https://about.iftas.org/library/iftas-dni-list/
 */
export const IFTAS_DNI = {
  source: 'iftas-dni',
  url: 'https://about.iftas.org/wp-content/uploads/2025/10/iftas-dni-latest.csv',
} as const;

export interface SharedBlock {
  domain: string;
  severity: 'silence' | 'suspend';
  /** Labels of the shared vocabulary, e.g. `hate-speech`. */
  labels: string[];
  obfuscate: boolean;
}

/** Reads a blocklist in Mastodon's CSV format (`#domain,#severity,…,#public_comment,#obfuscate`). */
export function parseBlocklistCsv(text: string): SharedBlock[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = (lines.shift() ?? '').split(',').map((h) => h.trim().replace(/^#/, ''));
  const col = (name: string) => header.indexOf(name);
  const [domainAt, severityAt, commentAt, obfuscateAt] = [
    col('domain'),
    col('severity'),
    col('public_comment'),
    col('obfuscate'),
  ];
  if (domainAt < 0) return [];
  const result: SharedBlock[] = [];
  for (const line of lines) {
    const cells = line.split(',');
    const domain = (cells[domainAt] ?? '').trim().toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z0-9-]+$/.test(domain)) continue;
    const severity = cells[severityAt]?.trim() === 'silence' ? 'silence' : 'suspend';
    const labels = (cells[commentAt] ?? '')
      .replace(/^[a-z]+:/, '')
      .split(';')
      .map((l) => l.trim())
      .filter(Boolean);
    result.push({
      domain,
      severity,
      labels,
      obfuscate: (cells[obfuscateAt] ?? '').trim().toUpperCase() === 'TRUE',
    });
  }
  return result;
}

/**
 * Brings the blocks of a shared list in step with it: adds new servers, changes their
 * severity, and lifts the blocks of servers the list dropped. Blocks made by hand and
 * servers the admins opened (exceptions) are left alone.
 */
export async function syncSharedBlocklist(
  ctx: CoreContext,
  source: string,
  entries: SharedBlock[],
): Promise<{ added: string[]; removed: string[] }> {
  const { domainBlocks, domainBlockExceptions } = schema;
  const existing = new Map((await ctx.db.select().from(domainBlocks)).map((b) => [b.domain, b]));
  const exceptions = new Set(
    (await ctx.db.select().from(domainBlockExceptions)).map((e) => e.domain),
  );
  const added: string[] = [];
  const listed = new Set<string>();
  for (const entry of entries) {
    listed.add(entry.domain);
    if (exceptions.has(entry.domain)) continue;
    const current = existing.get(entry.domain);
    if (current && current.source !== source) continue;
    const comment = `${entry.labels.join(', ')} (${source === IFTAS_DNI.source ? 'IFTAS DNI' : source})`;
    if (
      current &&
      current.severity === entry.severity &&
      current.publicComment === comment &&
      current.obfuscate === entry.obfuscate
    )
      continue;
    await blockDomain(ctx, null, {
      domain: entry.domain,
      severity: entry.severity,
      publicComment: comment,
      source,
      obfuscate: entry.obfuscate,
    });
    if (!current) added.push(entry.domain);
  }
  const removed: string[] = [];
  for (const block of existing.values()) {
    if (block.source !== source || listed.has(block.domain)) continue;
    await unblockDomain(ctx, null, block.domain);
    removed.push(block.domain);
  }
  // Exceptions of servers the list no longer has are not needed any more.
  for (const domain of exceptions) {
    if (!listed.has(domain))
      await ctx.db.delete(domainBlockExceptions).where(eq(domainBlockExceptions.domain, domain));
  }
  return { added, removed };
}
