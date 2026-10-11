import type { PaginationQuery } from '@disbigle/shared';
import { type AnyColumn, and, asc, desc, gt, lt, type SQL } from 'drizzle-orm';
import type { PageParams } from './http.ts';

/**
 * Cursor conditions with Mastodon semantics on a time-ordered id column:
 * `max_id` → older than; `since_id` → newer than, newest first; `min_id` → newer than,
 * starting right after the cursor (so the query runs oldest first and is reversed afterwards).
 */
export function cursorWhere(column: AnyColumn, page: PageParams): SQL | undefined {
  const newerThan = page.minId ?? page.sinceId;
  return and(
    page.maxId ? lt(column, page.maxId) : undefined,
    newerThan ? gt(column, newerThan) : undefined,
  );
}

export function cursorOrder(column: AnyColumn, page: PageParams): SQL {
  return page.minId ? asc(column) : desc(column);
}

/** Puts rows fetched with `cursorOrder` back into newest-first order. */
export function newestFirst<T>(rows: T[], page: PageParams): T[] {
  return page.minId ? rows.reverse() : rows;
}

/**
 * Runs one of core's timeline functions (which know `max_id` and `min_id`) with Mastodon's
 * `since_id` too. `since_id` means "the newest `limit` items newer than X": we fetch the newest
 * page (below `max_id`) and drop what is not newer than X, which is exactly that set.
 * UUIDv7 strings compare like the uuid column (lowercase hex, fixed length).
 */
export async function corePage<T extends { id: string }>(
  fetch: (query: PaginationQuery) => Promise<T[]>,
  page: PageParams,
): Promise<T[]> {
  const base: PaginationQuery = { limit: page.limit };
  if (page.maxId) base.maxId = page.maxId;
  if (page.minId) return fetch({ ...base, minId: page.minId });
  const rows = await fetch(base);
  const since = page.sinceId;
  return since ? rows.filter((row) => row.id > since) : rows;
}

/** First/last cursors of a newest-first page, for the Link header. */
export function cursorsOf(ids: string[]): { first: string; last: string } | null {
  const first = ids[0];
  const last = ids[ids.length - 1];
  return first && last ? { first, last } : null;
}
