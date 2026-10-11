import { schema, uuidv7 } from '@disbigle/db';
import type { FilterContext, KeywordFilter } from '@disbigle/shared';
import { and, desc, eq, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { CoreContext } from '../context.ts';
import { DomainError } from '../errors.ts';

const { keywordFilters, posts } = schema;

export const keywordFilterRequestSchema = z.object({
  phrase: z.string().trim().min(1).max(100),
  wholeWord: z.boolean().default(true),
  contexts: z
    .array(z.enum(['home', 'public', 'notifications', 'thread']))
    .min(1)
    .default(['home', 'public', 'notifications', 'thread']),
  /** Seconds until the filter stops applying; null = forever. */
  expiresIn: z
    .number()
    .int()
    .min(300)
    .max(365 * 24 * 3600)
    .nullable()
    .default(null),
});
export type KeywordFilterRequest = z.input<typeof keywordFilterRequestSchema>;

export type { FilterContext, KeywordFilter };

const serialize = (row: typeof keywordFilters.$inferSelect): KeywordFilter => ({
  id: row.id,
  phrase: row.phrase,
  wholeWord: row.wholeWord,
  contexts: row.contexts,
  expiresAt: row.expiresAt?.toISOString() ?? null,
});

export async function listKeywordFilters(
  ctx: CoreContext,
  actorId: string,
): Promise<KeywordFilter[]> {
  const rows = await ctx.db
    .select()
    .from(keywordFilters)
    .where(eq(keywordFilters.actorId, actorId))
    .orderBy(desc(keywordFilters.id));
  return rows.map(serialize);
}

export async function createKeywordFilter(
  ctx: CoreContext,
  actorId: string,
  request: KeywordFilterRequest,
) {
  const input = keywordFilterRequestSchema.parse(request);
  const existing = await ctx.db
    .select({ id: keywordFilters.id })
    .from(keywordFilters)
    .where(eq(keywordFilters.actorId, actorId));
  if (existing.length >= 100) throw new DomainError('bad_request', 'Too many filters');
  const [row] = await ctx.db
    .insert(keywordFilters)
    .values({
      id: uuidv7(),
      actorId,
      phrase: input.phrase,
      wholeWord: input.wholeWord,
      contexts: [...new Set(input.contexts)],
      expiresAt: input.expiresIn ? new Date(Date.now() + input.expiresIn * 1000) : null,
    })
    .returning();
  if (!row) throw new Error('Insert failed');
  return serialize(row);
}

export async function deleteKeywordFilter(
  ctx: CoreContext,
  actorId: string,
  filterId: string,
): Promise<void> {
  const removed = await ctx.db
    .delete(keywordFilters)
    .where(and(eq(keywordFilters.id, filterId), eq(keywordFilters.actorId, actorId)))
    .returning({ id: keywordFilters.id });
  if (removed.length === 0) throw new DomainError('not_found', 'Filter not found');
}

/**
 * SQL condition: the post (or the post a reshare points to) matches none of the viewer's active
 * filters for this context. Matches the text and the content warning, case-insensitively.
 */
export function notFilteredFor(
  viewerActorId: string | null,
  context: FilterContext,
  postAlias = posts,
): SQL {
  if (!viewerActorId) return sql`true`;
  const text = sql`(${postAlias.contentHtml} || ' ' || ${postAlias.summary})`;
  return sql`not exists (
    select 1 from ${keywordFilters} f
    where f.actor_id = ${viewerActorId}
      and ${context}::filter_context = any(f.contexts)
      and (f.expires_at is null or f.expires_at > now())
      and case when f.whole_word
        then ${text} ~* ('(^|[^[:alnum:]_])' || regexp_replace(f.phrase, '([.^$*+?()\\[\\]{}|\\\\-])', '\\\\\\1', 'g') || '($|[^[:alnum:]_])')
        else ${text} ilike '%' || replace(replace(replace(f.phrase, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%'
      end
  )`;
}
