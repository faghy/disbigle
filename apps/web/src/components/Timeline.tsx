import type { Status } from '@disbigle/shared';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { prependToTimeline, timelineIds } from '../api/cache.ts';
import { errorMessage } from '../api/errors.ts';
import { useCurrentUser } from '../api/queries.ts';
import { PAGE_SIZE, type PageParams } from '../api/social.ts';
import { ArrowUpIcon } from './icons.tsx';
import { StatusCard } from './StatusCard.tsx';
import { useStream } from './StreamingProvider.tsx';
import { Alert, Button, LoadingState } from './ui.tsx';

export interface TimelineProps {
  queryKey: readonly string[];
  fetchPage: (page: PageParams) => Promise<Status[]>;
  /** Live stream feeding this timeline (`user`, `public`, `public:local`, `hashtag:x`). */
  stream?: string | null;
  label: string;
  empty: ReactNode;
}

/** Calls `onVisible` when the element scrolls into view (no-op where unsupported). */
function useOnVisible(onVisible: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onVisible);
  callback.current = onVisible;
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) callback.current();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled]);
  return ref;
}

/**
 * A paged list of posts. Older posts load as the reader scrolls (or with the button);
 * new posts from the stream wait behind a "new posts" pill so the list never jumps.
 */
export function Timeline({ queryKey, fetchPage, stream, label, empty }: TimelineProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const [pending, setPending] = useState<Status[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage({ maxId: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.length < PAGE_SIZE ? undefined : lastPage[lastPage.length - 1]?.id,
  });

  // Reset the waiting posts when switching to another timeline.
  const keyString = queryKey.join('/');
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the timeline changes
  useEffect(() => setPending([]), [keyString]);

  useStream(stream ?? null, (event) => {
    if (event.event !== 'update') return;
    const status = event.payload;
    if (timelineIds(queryClient, queryKey).has(status.id)) return;
    // Your own posts appear immediately; others wait for the reader.
    if (status.account.id === user?.account.id) {
      prependToTimeline(queryClient, queryKey, [status]);
      return;
    }
    setPending((list) => (list.some((s) => s.id === status.id) ? list : [status, ...list]));
  });

  const statuses = query.data?.pages.flat() ?? [];
  const known = new Set(statuses.map((s) => s.id));
  const waiting = pending.filter((s) => !known.has(s.id));

  const showPending = () => {
    prependToTimeline(queryClient, queryKey, waiting);
    setPending([]);
    listRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    listRef.current?.querySelector<HTMLElement>('article a')?.focus({ preventScroll: true });
  };

  const canLoadMore = query.hasNextPage && !query.isFetchingNextPage;
  const sentinel = useOnVisible(() => {
    if (canLoadMore && !query.isError) void query.fetchNextPage();
  }, Boolean(query.hasNextPage));

  if (query.isPending) return <LoadingState label={t('common.loading')} />;
  if (query.isError && statuses.length === 0) {
    return (
      <div className="space-y-3 p-4">
        <Alert>{errorMessage(query.error)}</Alert>
        <Button variant="secondary" onClick={() => void query.refetch()}>
          {t('errorPage.retry')}
        </Button>
      </div>
    );
  }

  return (
    <div ref={listRef} className="relative scroll-mt-20">
      {waiting.length > 0 && (
        <div className="sticky top-20 z-20 flex justify-center py-2">
          <button
            type="button"
            onClick={showPending}
            className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-fg shadow-lg hover:bg-accent-hover focus-ring"
          >
            <ArrowUpIcon size={16} />
            {t('timeline.newPosts', { count: waiting.length })}
          </button>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {waiting.length > 0 ? t('timeline.newPosts', { count: waiting.length }) : ''}
      </p>

      {statuses.length === 0 ? (
        <div className="px-4 py-16 text-center text-fg-muted">{empty}</div>
      ) : (
        <div role="feed" aria-label={label} aria-busy={query.isFetchingNextPage}>
          {statuses.map((status, index) => (
            <StatusCard key={status.id} status={status} position={index + 1} />
          ))}
        </div>
      )}

      <div ref={sentinel} className="flex flex-col items-center gap-3 px-4 py-6">
        {query.isFetchNextPageError && <Alert>{errorMessage(query.error)}</Alert>}
        {query.hasNextPage ? (
          <Button
            variant="secondary"
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t('timeline.loadMore')}
          </Button>
        ) : (
          statuses.length > 0 && <p className="text-sm text-fg-muted">{t('timeline.end')}</p>
        )}
      </div>
    </div>
  );
}
