import type { Account, Relationship } from '@disbigle/shared';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { socialKeys } from '../api/cache.ts';
import { errorMessage } from '../api/errors.ts';
import { social } from '../api/social.ts';
import { aspectsQueryOptions, relationshipQueryOptions } from '../api/socialQueries.ts';
import { AccountRow } from '../components/AccountList.tsx';
import { AspectsPopover } from '../components/AspectsPopover.tsx';
import { FeedHeader } from '../components/FeedSection.tsx';
import { FollowButton } from '../components/FollowButton.tsx';
import { ContactsIcon } from '../components/icons.tsx';
import { Alert, Button, Card, cx, LoadingState } from '../components/ui.tsx';

const PAGE = 40;

/** The people you are connected with, diaspora* style: everyone, one aspect, or your fans. */
export function ContactsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { aspect, only } = useSearch({ from: '/contacts' });
  const aspects = useQuery(aspectsQueryOptions);
  const filter = aspect ? { aspectId: aspect } : only === 'followers' ? { only } : {};

  const contacts = useInfiniteQuery({
    queryKey: ['contacts', filter],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const page = await social.contacts(filter, { offset: pageParam, limit: PAGE });
      // Prime the relationship cache: the follow and aspect buttons read it.
      for (const { relationship } of page)
        queryClient.setQueryData(socialKeys.relationship(relationship.id), relationship);
      return page;
    },
    getNextPageParam: (last, pages) =>
      last.length < PAGE ? undefined : pages.reduce((n, p) => n + p.length, 0),
  });

  const tabs: { key: string; label: string; search: { aspect?: string; only?: 'followers' } }[] = [
    { key: 'all', label: t('contacts.all'), search: {} },
    ...(aspects.data ?? []).map((a) => ({ key: a.id, label: a.name, search: { aspect: a.id } })),
    { key: 'followers', label: t('contacts.onlyFollowers'), search: { only: 'followers' } },
  ];
  const activeKey = aspect ?? (only === 'followers' ? 'followers' : 'all');
  const rows = contacts.data?.pages.flat() ?? [];

  return (
    <div className="space-y-4">
      <FeedHeader
        title={t('contacts.title')}
        description={t('contacts.description')}
        icon={ContactsIcon}
      />
      <nav aria-label={t('contacts.filters')} className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            to="/contacts"
            search={tab.search}
            aria-current={tab.key === activeKey ? 'page' : undefined}
            className={cx(
              'rounded-full border px-3.5 py-1.5 text-sm font-medium focus-ring',
              tab.key === activeKey
                ? 'border-accent/50 bg-accent-soft text-accent'
                : 'border-border-strong hover:bg-surface-muted',
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <Card className="p-2 sm:p-3">
        {contacts.isPending ? (
          <LoadingState label={t('common.loading')} />
        ) : contacts.isError ? (
          <Alert>{errorMessage(contacts.error)}</Alert>
        ) : rows.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-fg-muted">
            {activeKey === 'all' ? t('contacts.emptyAll') : t('contacts.empty')}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map(({ account, relationship }) => (
              <li key={account.id} className="py-1">
                <ContactRow account={account} relationship={relationship} />
              </li>
            ))}
          </ul>
        )}
        {contacts.hasNextPage && (
          <div className="mt-2 flex justify-center">
            <Button
              variant="secondary"
              loading={contacts.isFetchingNextPage}
              onClick={() => void contacts.fetchNextPage()}
            >
              {t('nav.loadMore')}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

/** One contact; reads the relationship from the cache so follow and aspect changes show at once. */
function ContactRow({ account, relationship }: { account: Account; relationship: Relationship }) {
  const rel =
    useQuery({ ...relationshipQueryOptions(account.id), initialData: relationship }).data ??
    relationship;
  return (
    <AccountRow
      account={account}
      actions={
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {!rel.blocking && <AspectsPopover account={account} relationship={rel} />}
          <FollowButton account={account} compact fetch={false} />
        </div>
      }
    />
  );
}
