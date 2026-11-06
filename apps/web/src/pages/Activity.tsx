import type { ActivityItem, ActivityKind } from '@disbigle/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { type ComponentType, type KeyboardEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../api/errors.ts';
import { PAGE_SIZE, social } from '../api/social.ts';
import { FeedHeader, FeedSection } from '../components/FeedSection.tsx';
import {
  ActivityIcon,
  BookmarkIcon,
  HeartIcon,
  ReplyIcon,
  ReshareIcon,
} from '../components/icons.tsx';
import { StatusCard } from '../components/StatusCard.tsx';
import { useOnVisible } from '../components/Timeline.tsx';
import { Alert, Button, cx, LoadingState } from '../components/ui.tsx';
import { relativeTime } from '../lib/time.ts';

type TabId = 'all' | ActivityKind;

const icons: Record<ActivityKind, ComponentType<{ size?: number; className?: string }>> = {
  like: HeartIcon,
  reply: ReplyIcon,
  reblog: ReshareIcon,
  bookmark: BookmarkIcon,
};

/** "My activity": what you liked, answered, reshared and saved, newest first, by kind or all. */
export function ActivityPage() {
  const { t } = useTranslation();
  const baseId = useId();
  const [tab, setTab] = useState<TabId>('all');
  const tabs: { id: TabId; label: string }[] = [
    { id: 'all', label: t('activity.tabs.all') },
    { id: 'like', label: t('activity.tabs.like') },
    { id: 'reply', label: t('activity.tabs.reply') },
    { id: 'reblog', label: t('activity.tabs.reblog') },
    { id: 'bookmark', label: t('activity.tabs.bookmark') },
  ];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const index = tabs.findIndex((item) => item.id === tab);
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    if (!next) return;
    setTab(next.id);
    document.getElementById(`${baseId}-${next.id}-tab`)?.focus();
  };

  return (
    <>
      <FeedHeader
        title={t('activity.title')}
        description={t('activity.description')}
        icon={ActivityIcon}
      />
      <FeedSection>
        <div
          role="tablist"
          aria-label={t('activity.title')}
          onKeyDown={onKeyDown}
          className="flex overflow-x-auto border-b border-border"
        >
          {tabs.map((item) => (
            <button
              key={item.id}
              id={`${baseId}-${item.id}-tab`}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              aria-controls={`${baseId}-panel`}
              tabIndex={tab === item.id ? 0 : -1}
              onClick={() => setTab(item.id)}
              className={cx(
                'shrink-0 border-b-2 px-2.5 py-3 text-sm font-medium focus-ring sm:px-4',
                tab === item.id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-fg-muted hover:text-fg',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-${tab}-tab`}>
          <ActivityList key={tab} type={tab === 'all' ? undefined : tab} />
        </div>
      </FeedSection>
    </>
  );
}

function ActivityList({ type }: { type: ActivityKind | undefined }) {
  const { t } = useTranslation();
  const query = useInfiniteQuery({
    queryKey: ['activity', type ?? 'all'],
    queryFn: ({ pageParam }) => social.activity({ maxId: pageParam, limit: PAGE_SIZE, type }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next ?? undefined,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const canLoadMore = query.hasNextPage && !query.isFetchingNextPage;
  const sentinel = useOnVisible(() => {
    if (canLoadMore && !query.isError) void query.fetchNextPage();
  }, Boolean(query.hasNextPage));

  if (query.isPending) return <LoadingState label={t('common.loading')} />;
  if (query.isError && items.length === 0) {
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
    <div>
      {items.length === 0 ? (
        <div className="px-4 py-16 text-center text-fg-muted">
          {t(`activity.empty.${type ?? 'all'}`)}
        </div>
      ) : (
        <div role="feed" aria-label={t('activity.title')} aria-busy={query.isFetchingNextPage}>
          {items.map((item, index) => (
            <ActivityEntry key={item.id} item={item} position={index + 1} />
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
          items.length > 0 && <p className="text-sm text-fg-muted">{t('timeline.end')}</p>
        )}
      </div>
    </div>
  );
}

function ActivityEntry({ item, position }: { item: ActivityItem; position: number }) {
  const { t, i18n } = useTranslation();
  const Icon = icons[item.type];
  return (
    <StatusCard
      status={item.status}
      position={position}
      note={
        <>
          <Icon size={16} className="shrink-0" />
          <span>{t(`activity.did.${item.type}`)}</span>
          <span aria-hidden="true">·</span>
          <time
            dateTime={item.createdAt}
            title={new Date(item.createdAt).toLocaleString(i18n.language)}
          >
            {relativeTime(item.createdAt, i18n.language)}
          </time>
        </>
      }
    />
  );
}
