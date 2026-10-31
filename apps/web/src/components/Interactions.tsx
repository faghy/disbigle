import type { Status } from '@disbigle/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { type KeyboardEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { socialKeys } from '../api/cache.ts';
import { errorMessage } from '../api/errors.ts';
import { social } from '../api/social.ts';
import { useRelationships } from '../api/socialQueries.ts';
import { AccountRow } from './AccountList.tsx';
import { Modal } from './Dialog.tsx';
import { FollowButton } from './FollowButton.tsx';
import { HeartIcon, ReshareIcon } from './icons.tsx';
import { Alert, Button, cx, LoadingState } from './ui.tsx';

export type InteractionKind = 'likes' | 'reshares';

const PAGE = 40;

/**
 * Who liked and who reshared a post, in two tabs. A sheet from the bottom on phones, a dialog on
 * larger screens.
 */
export function InteractionsDialog({
  status,
  initial,
  onClose,
}: {
  status: Status;
  initial: InteractionKind;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<InteractionKind>(initial);
  const baseId = useId();
  const format = (n: number) => new Intl.NumberFormat(i18n.language).format(n);
  const tabs = [
    {
      id: 'likes' as const,
      icon: HeartIcon,
      label: t('status.interactions.likes'),
      count: status.likesCount,
    },
    {
      id: 'reshares' as const,
      icon: ReshareIcon,
      label: t('status.interactions.reshares'),
      count: status.reblogsCount,
    },
  ];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const next = tab === 'likes' ? 'reshares' : 'likes';
    setTab(next);
    document.getElementById(`${baseId}-${next}-tab`)?.focus();
  };

  return (
    <Modal
      title={t('status.interactions.title')}
      onClose={onClose}
      initialFocus="[aria-selected=true]"
    >
      <div
        role="tablist"
        aria-label={t('status.interactions.title')}
        onKeyDown={onKeyDown}
        className="-mx-5 -mt-4 mb-2 flex border-b border-border px-3"
      >
        {tabs.map(({ id, icon: Icon, label, count }) => (
          <button
            key={id}
            id={`${baseId}-${id}-tab`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`${baseId}-panel`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            className={cx(
              'flex items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-medium focus-ring',
              tab === id
                ? 'border-accent text-accent'
                : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            <Icon size={16} filled={id === 'likes' && tab === id} />
            {label}
            <span className="tabular-nums text-fg-muted">{format(count)}</span>
          </button>
        ))}
      </div>
      <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-${tab}-tab`}>
        <People key={tab} statusId={status.id} kind={tab} />
      </div>
    </Modal>
  );
}

function People({ statusId, kind }: { statusId: string; kind: InteractionKind }) {
  const { t } = useTranslation();
  const query = useInfiniteQuery({
    queryKey: socialKeys.interactions(statusId, kind),
    queryFn: ({ pageParam }) =>
      (kind === 'likes' ? social.likedBy : social.resharedBy)(statusId, {
        limit: PAGE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      lastPage.length < PAGE ? undefined : pages.length * PAGE,
    staleTime: 0,
  });
  const accounts = query.data?.pages.flat() ?? [];
  useRelationships(accounts.map((item) => item.id));

  if (query.isPending) return <LoadingState label={t('common.loading')} />;
  if (query.isError) return <Alert>{errorMessage(query.error)}</Alert>;
  if (accounts.length === 0)
    return (
      <p className="px-2 py-6 text-center text-sm text-fg-muted">
        {kind === 'likes' ? t('status.interactions.noLikes') : t('status.interactions.noReshares')}
      </p>
    );
  return (
    <>
      <ul>
        {accounts.map((item) => (
          <li key={item.id}>
            <AccountRow
              account={item}
              actions={<FollowButton account={item} compact fetch={false} />}
            />
          </li>
        ))}
      </ul>
      {query.hasNextPage && (
        <div className="flex justify-center p-3">
          <Button
            variant="secondary"
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t('timeline.loadMore')}
          </Button>
        </div>
      )}
    </>
  );
}
