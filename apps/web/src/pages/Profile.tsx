import type { Account, Relationship } from '@disbigle/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { type KeyboardEvent, useCallback, useId, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { socialKeys } from '../api/cache.ts';
import { ApiError } from '../api/client.ts';
import { errorMessage } from '../api/errors.ts';
import { accountQueryOptions, useCurrentUser, useInstance } from '../api/queries.ts';
import { type AccountAction, social } from '../api/social.ts';
import { relationshipQueryOptions, useAspects, useRelationships } from '../api/socialQueries.ts';
import { AccountRow } from '../components/AccountList.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { ConfirmDialog } from '../components/Dialog.tsx';
import { FeedSection } from '../components/FeedSection.tsx';
import { FollowButton } from '../components/FollowButton.tsx';
import { AspectsIcon, CheckIcon, ChevronDownIcon, MoreIcon } from '../components/icons.tsx';
import { ReportDialog } from '../components/ReportDialog.tsx';
import { Timeline } from '../components/Timeline.tsx';
import { Alert, Button, buttonClass, Card, cx, LoadingState } from '../components/ui.tsx';
import { useDismiss } from '../lib/dismiss.ts';
import { NotFoundPage } from './ErrorPages.tsx';

export function ProfilePage() {
  const { t } = useTranslation();
  const { username } = useParams({ from: '/@{$username}' });
  const account = useQuery(accountQueryOptions(username));

  if (account.isPending) return <LoadingState label={t('common.loading')} />;
  if (account.isError) {
    if (account.error instanceof ApiError && account.error.status === 404) {
      return <ProfileNotFound username={username} />;
    }
    return <Alert>{errorMessage(account.error)}</Alert>;
  }
  return <Profile account={account.data} />;
}

function Profile({ account }: { account: Account }) {
  const [tab, setTab] = useState<TabId>('posts');
  const tabsRef = useRef<HTMLDivElement>(null);
  const showTab = (next: TabId) => {
    setTab(next);
    tabsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  return (
    <div className="space-y-4">
      <ProfileView account={account} onShowTab={showTab} />
      <div ref={tabsRef} className="scroll-mt-20">
        <ProfileTabs account={account} tab={tab} onTabChange={setTab} />
      </div>
    </div>
  );
}

function ProfileNotFound({ username }: { username: string }) {
  const { t } = useTranslation();
  const user = useCurrentUser();
  return (
    <div>
      <NotFoundPage />
      <p className="text-center text-sm text-fg-muted">{t('profile.notFound', { username })}</p>
      {user && username.includes('@') && (
        <p className="mt-3 text-center">
          <Link
            to="/search"
            search={{ q: `@${username}` }}
            className="rounded text-sm font-medium text-accent hover:underline focus-ring"
          >
            {t('search.lookUpHandle', { handle: `@${username}` })}
          </Link>
        </p>
      )}
    </div>
  );
}

export function ProfileView({
  account,
  onShowTab,
}: {
  account: Account;
  onShowTab?: (tab: TabId) => void;
}) {
  const { t, i18n } = useTranslation();
  const instance = useInstance();
  const me = useCurrentUser();
  const isOwn = me?.account.id === account.id;
  const domain = instance.data?.domain;
  const handle = account.acct.includes('@') || !domain ? account.acct : `${account.acct}@${domain}`;
  const joined = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(
    new Date(account.createdAt),
  );

  return (
    <article className="space-y-6" aria-labelledby="profile-name">
      <Card as="div" className="overflow-hidden">
        <div className="-mx-5 -mt-5 mb-4 sm:-mx-6 sm:-mt-6">
          {account.headerUrl ? (
            <img
              src={account.headerUrl}
              alt=""
              className="aspect-[3/1] w-full bg-surface-muted object-cover"
            />
          ) : (
            <div
              aria-hidden="true"
              className="aspect-[6/1] w-full bg-gradient-to-r from-accent-soft via-surface-muted to-accent-soft"
            />
          )}
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Avatar
            account={account}
            size="lg"
            className="-mt-14 ring-4 ring-surface sm:-mt-16 sm:size-24 sm:text-3xl"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 id="profile-name" className="text-2xl font-semibold tracking-tight break-words">
                {account.displayName || account.username}
              </h1>
              {account.bot && <Badge>{t('profile.bot')}</Badge>}
              {account.locked && <Badge>{t('profile.locked')}</Badge>}
            </div>
            <p className="break-all text-fg-muted">@{handle}</p>
            <p className="mt-1 text-sm text-fg-muted">{t('profile.joined', { date: joined })}</p>
            {!account.local && account.url && (
              <a
                href={account.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block rounded text-sm font-medium text-accent hover:underline focus-ring"
              >
                {t('profile.openOriginal')}
              </a>
            )}
          </div>
          {isOwn && (
            <Link to="/settings/profile" className={buttonClass('secondary', 'self-start')}>
              {t('profile.edit')}
            </Link>
          )}
        </div>

        <ProfileCounts account={account} onShowTab={onShowTab} />

        {me && !isOwn && <RelationshipBar account={account} />}

        {account.note && <p className="mt-5 whitespace-pre-wrap break-words">{account.note}</p>}

        {account.fields.length > 0 && (
          <dl className="mt-5 divide-y divide-border overflow-hidden rounded-xl border border-border">
            {account.fields.map((field, index) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: fields have no id and keep their order
                key={index}
                className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,10rem)_1fr] sm:gap-4"
              >
                <dt className="text-sm font-medium text-fg-muted break-words">{field.name}</dt>
                <dd className="break-words">{field.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
    </article>
  );
}

function ProfileCounts({
  account,
  onShowTab,
}: {
  account: Account;
  onShowTab?: ((tab: TabId) => void) | undefined;
}) {
  const { i18n } = useTranslation();
  const format = (n: number) => new Intl.NumberFormat(i18n.language).format(n);
  const items: { tab: TabId; count: number | undefined; key: string }[] = [
    { tab: 'posts', count: account.statusesCount, key: 'profile.counts.posts' },
    { tab: 'followers', count: account.followersCount, key: 'profile.counts.followers' },
    { tab: 'following', count: account.followingCount, key: 'profile.counts.following' },
  ];
  if (items.every((item) => item.count === undefined)) return null;
  return (
    <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm">
      {items.map((item) =>
        item.count === undefined ? null : (
          <li key={item.tab}>
            <button
              type="button"
              onClick={() => onShowTab?.(item.tab)}
              className="rounded text-fg-muted hover:text-fg focus-ring"
            >
              <Trans
                i18nKey={item.key}
                count={item.count}
                values={{ formatted: format(item.count) }}
                components={{ strong: <strong className="font-semibold text-fg" /> }}
              />
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded-full border border-border bg-surface-muted px-2 py-0.5 text-xs font-medium text-fg-muted">
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Follow, aspects, mute and block
// ---------------------------------------------------------------------------------------------

function useRelationshipAction(account: Account) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: AccountAction) => social.accountAction(account.id, action),
    onSuccess: (relationship, action) => {
      queryClient.setQueryData(socialKeys.relationship(account.id), relationship);
      void queryClient.invalidateQueries({ queryKey: socialKeys.followers(account.id) });
      void queryClient.invalidateQueries({ queryKey: ['account'] });
      if (action === 'block' || action === 'mute' || action === 'unblock' || action === 'unmute') {
        void queryClient.invalidateQueries({ queryKey: socialKeys.timelines });
        void queryClient.invalidateQueries({ queryKey: socialKeys.aspects });
      }
    },
  });
}

function RelationshipBar({ account }: { account: Account }) {
  const { t } = useTranslation();
  const relationship = useQuery(relationshipQueryOptions(account.id));
  const action = useRelationshipAction(account);

  if (relationship.isPending) return <div className="mt-4 h-10" aria-hidden="true" />;
  if (relationship.isError)
    return <Alert className="mt-4">{errorMessage(relationship.error)}</Alert>;
  const rel = relationship.data;

  let follow: {
    label: string;
    action: AccountAction;
    variant: 'primary' | 'secondary';
    aria?: string;
  };
  if (rel.following)
    follow = { label: t('profile.unfollow'), action: 'unfollow', variant: 'secondary' };
  else if (rel.requested)
    follow = {
      label: t('profile.requested'),
      action: 'unfollow',
      variant: 'secondary',
      aria: t('profile.cancelRequest'),
    };
  else
    follow = {
      label: rel.followedBy ? t('profile.followBack') : t('profile.follow'),
      action: 'follow',
      variant: 'primary',
    };

  return (
    <div className="mt-4 space-y-3">
      {rel.blockedBy && <Alert tone="info">{t('profile.blockedBy')}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        {!rel.blocking && !rel.blockedBy && (
          <Button
            variant={follow.variant}
            loading={
              action.isPending && (action.variables === 'follow' || action.variables === 'unfollow')
            }
            onClick={() => action.mutate(follow.action)}
            aria-label={follow.aria}
            title={follow.aria}
          >
            {follow.label}
          </Button>
        )}
        {!rel.blocking && <AspectsPopover account={account} relationship={rel} />}
        {rel.blocking && (
          <Button
            variant="danger"
            onClick={() => action.mutate('unblock')}
            loading={action.isPending}
          >
            {t('profile.unblock')}
          </Button>
        )}
        {rel.followedBy && <Badge>{t('profile.followsYou')}</Badge>}
        {rel.muting && <Badge>{t('profile.muted')}</Badge>}
        <ProfileMenu account={account} relationship={rel} />
      </div>
      {account.locked && !rel.following && !rel.requested && !rel.blocking && (
        <p className="text-sm text-fg-muted">{t('profile.lockedHint')}</p>
      )}
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
    </div>
  );
}

/** Puts the account in some of your aspects. Each change saves the full set of aspects. */
function AspectsPopover({
  account,
  relationship,
}: {
  account: Account;
  relationship: Relationship;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const aspects = useAspects();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, containerRef, buttonRef);

  const save = useMutation({
    mutationFn: (aspectIds: string[]) => social.setAspectMemberships(account.id, aspectIds),
    onMutate: (aspectIds) => {
      const previous = queryClient.getQueryData<Relationship>(socialKeys.relationship(account.id));
      queryClient.setQueryData<Relationship>(socialKeys.relationship(account.id), (rel) =>
        rel ? { ...rel, aspectIds } : rel,
      );
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous)
        queryClient.setQueryData(socialKeys.relationship(account.id), context.previous);
    },
    onSuccess: (rel) => {
      queryClient.setQueryData(socialKeys.relationship(account.id), rel);
      void queryClient.invalidateQueries({ queryKey: socialKeys.aspects });
      void queryClient.invalidateQueries({ queryKey: ['aspectMembers'] });
    },
  });

  const current = relationship.aspectIds;
  const names = (aspects.data ?? []).filter((a) => current.includes(a.id)).map((a) => a.name);
  const label =
    names.length === 0
      ? t('profile.aspects.add')
      : names.length <= 2
        ? names.join(', ')
        : t('profile.aspects.inMany', { count: names.length });

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={buttonClass(
          names.length > 0 ? 'secondary' : 'secondary',
          cx('max-w-64', names.length > 0 && 'border-accent/50 bg-accent-soft text-accent'),
        )}
      >
        {names.length > 0 ? <CheckIcon size={16} /> : <AspectsIcon size={16} />}
        <span className="truncate">{label}</span>
        <ChevronDownIcon size={16} />
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute left-0 z-30 mt-2 w-72 rounded-2xl border border-border bg-surface p-2 shadow-xl"
      >
        <fieldset>
          <legend className="px-2 py-1 text-sm font-semibold">
            {t('profile.aspects.legend', { name: account.displayName || account.username })}
          </legend>
          {aspects.isPending ? (
            <LoadingState label={t('common.loading')} />
          ) : aspects.data && aspects.data.length > 0 ? (
            <ul className="max-h-64 overflow-y-auto">
              {aspects.data.map((aspect) => (
                <li key={aspect.id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-muted">
                    <input
                      type="checkbox"
                      className="size-4 accent-accent focus-ring"
                      checked={current.includes(aspect.id)}
                      onChange={(event) =>
                        save.mutate(
                          event.target.checked
                            ? [...current, aspect.id]
                            : current.filter((id) => id !== aspect.id),
                        )
                      }
                    />
                    <span className="flex-1 truncate text-sm">{aspect.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-2 text-sm text-fg-muted">{t('composer.audience.noAspects')}</p>
          )}
        </fieldset>
        {save.error && <Alert className="m-2">{errorMessage(save.error)}</Alert>}
        <div className="mt-1 flex items-center justify-between border-t border-border px-2 pt-2">
          <Link to="/aspects" className="rounded text-sm text-accent hover:underline focus-ring">
            {t('profile.aspects.manage')}
          </Link>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              buttonRef.current?.focus();
            }}
            className="rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-surface-muted focus-ring"
          >
            {t('common.done')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfileMenu({ account, relationship }: { account: Account; relationship: Relationship }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [reporting, setReporting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const action = useRelationshipAction(account);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, containerRef, buttonRef);
  const name = account.displayName || account.username;
  const itemClass =
    'block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-surface-muted focus-ring';

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t('profile.moreActions')}
        title={t('profile.moreActions')}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-10 items-center justify-center rounded-lg border border-border-strong text-fg-muted hover:bg-surface-muted hover:text-fg focus-ring"
      >
        <MoreIcon />
      </button>
      <div
        id={menuId}
        hidden={!open}
        className="absolute right-0 z-30 mt-2 w-56 rounded-xl border border-border bg-surface p-1.5 shadow-lg"
      >
        <button
          type="button"
          className={itemClass}
          onClick={() => {
            setOpen(false);
            action.mutate(relationship.muting ? 'unmute' : 'mute');
          }}
        >
          {relationship.muting ? t('profile.unmute', { name }) : t('profile.mute', { name })}
        </button>
        <button
          type="button"
          className={cx(itemClass, !relationship.blocking && 'text-danger')}
          onClick={() => {
            setOpen(false);
            if (relationship.blocking) action.mutate('unblock');
            else setConfirmBlock(true);
          }}
        >
          {relationship.blocking ? t('profile.unblock') : t('profile.block', { name })}
        </button>
        <button
          type="button"
          className={cx(itemClass, 'text-danger')}
          onClick={() => {
            setOpen(false);
            setReporting(true);
          }}
        >
          {t('profile.report', { name })}
        </button>
      </div>
      {reporting && (
        <ReportDialog
          account={account}
          onClose={() => {
            setReporting(false);
            buttonRef.current?.focus();
          }}
        />
      )}
      {confirmBlock && (
        <ConfirmDialog
          title={t('profile.blockTitle', { name })}
          description={t('profile.blockDescription')}
          confirmLabel={t('profile.blockConfirm')}
          pending={action.isPending}
          onCancel={() => setConfirmBlock(false)}
          onConfirm={() => action.mutate('block', { onSettled: () => setConfirmBlock(false) })}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Posts, replies, followers and following
// ---------------------------------------------------------------------------------------------

export type TabId = 'posts' | 'replies' | 'followers' | 'following';
const LIST_PAGE = 40;

function ProfileTabs({
  account,
  tab,
  onTabChange: setTab,
}: {
  account: Account;
  tab: TabId;
  onTabChange: (tab: TabId) => void;
}) {
  const { t, i18n } = useTranslation();
  const baseId = useId();
  const format = (n: number | undefined) =>
    n === undefined ? undefined : new Intl.NumberFormat(i18n.language).format(n);

  const tabs: { id: TabId; label: string; count?: string | undefined }[] = [
    { id: 'posts', label: t('profile.tabs.posts') },
    { id: 'replies', label: t('profile.tabs.replies') },
    { id: 'followers', label: t('profile.tabs.followers'), count: format(account.followersCount) },
    { id: 'following', label: t('profile.tabs.following'), count: format(account.followingCount) },
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
    <FeedSection>
      <div
        role="tablist"
        aria-label={t('profile.tabs.label')}
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
              'flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-3 text-sm font-medium focus-ring',
              tab === item.id
                ? 'border-accent text-accent'
                : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {item.label}
            {item.count && (
              <span className="rounded-full bg-surface-muted px-1.5 text-xs tabular-nums text-fg-muted">
                {item.count}
              </span>
            )}
          </button>
        ))}
      </div>
      <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-${tab}-tab`}>
        {tab === 'posts' || tab === 'replies' ? (
          <Timeline
            key={tab}
            queryKey={socialKeys.timeline('account', account.id, tab)}
            fetchPage={(page) =>
              social.accountStatuses(account.id, { ...page, excludeReplies: tab === 'posts' })
            }
            label={tabs.find((item) => item.id === tab)?.label ?? ''}
            empty={t('profile.noPosts')}
          />
        ) : (
          <div className="p-2">
            <PagedAccountList
              key={tab}
              account={account}
              kind={tab}
              empty={tab === 'followers' ? t('profile.noFollowers') : t('profile.noFollowing')}
            />
          </div>
        )}
      </div>
    </FeedSection>
  );
}

/** Followers or following, 40 at a time. */
function PagedAccountList({
  account,
  kind,
  empty,
}: {
  account: Account;
  kind: 'followers' | 'following';
  empty: string;
}) {
  const { t } = useTranslation();
  const query = useInfiniteQuery({
    queryKey:
      kind === 'followers' ? socialKeys.followers(account.id) : socialKeys.following(account.id),
    queryFn: ({ pageParam }) => social[kind](account.id, { limit: LIST_PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      lastPage.length < LIST_PAGE ? undefined : pages.length * LIST_PAGE,
  });

  const accounts = query.data?.pages.flat() ?? [];
  useRelationships(accounts.map((item) => item.id));

  if (query.isPending) return <LoadingState label={t('common.loading')} />;
  if (query.isError) return <Alert>{errorMessage(query.error)}</Alert>;
  if (accounts.length === 0)
    return <p className="px-2 py-6 text-center text-sm text-fg-muted">{empty}</p>;
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
