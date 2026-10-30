import type { Notification, NotificationType } from '@disbigle/shared';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ComponentType, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { socialKeys } from '../api/cache.ts';
import { errorMessage } from '../api/errors.ts';
import { groupKeys, groups } from '../api/groups.ts';
import { useCurrentUser } from '../api/queries.ts';
import { PAGE_SIZE, social } from '../api/social.ts';
import { Avatar } from '../components/Avatar.tsx';
import { FeedHeader, FeedSection } from '../components/FeedSection.tsx';
import {
  AtIcon,
  BellIcon,
  GroupIcon,
  HeartIcon,
  PollIcon,
  ReplyIcon,
  ReshareIcon,
  UserPlusIcon,
} from '../components/icons.tsx';
import { AccountLink, displayName, StatusCard, statusPath } from '../components/StatusCard.tsx';
import { Alert, Button, cx, LoadingState } from '../components/ui.tsx';
import { relativeTime } from '../lib/time.ts';

export const typeStyle: Record<
  NotificationType,
  { icon: ComponentType<{ size?: number; filled?: boolean }>; tone: string }
> = {
  follow: { icon: UserPlusIcon, tone: 'bg-accent-soft text-accent' },
  follow_request: { icon: UserPlusIcon, tone: 'bg-accent-soft text-accent' },
  mention: { icon: AtIcon, tone: 'bg-surface-muted text-fg' },
  reply: { icon: ReplyIcon, tone: 'bg-surface-muted text-fg' },
  reblog: { icon: ReshareIcon, tone: 'bg-success-soft text-success' },
  like: { icon: HeartIcon, tone: 'bg-danger-soft text-danger' },
  poll: { icon: PollIcon, tone: 'bg-accent-soft text-accent' },
  group_request: { icon: GroupIcon, tone: 'bg-accent-soft text-accent' },
  group_invite: { icon: GroupIcon, tone: 'bg-accent-soft text-accent' },
  group_accepted: { icon: GroupIcon, tone: 'bg-success-soft text-success' },
  group_post_pending: { icon: GroupIcon, tone: 'bg-accent-soft text-accent' },
  group_post_approved: { icon: GroupIcon, tone: 'bg-success-soft text-success' },
  group_post_rejected: { icon: GroupIcon, tone: 'bg-danger-soft text-danger' },
};

/** Plain-text excerpt of a post for one-line summaries. */
export function excerpt(html: string, max = 140): string {
  const text = new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function NotificationsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: socialKeys.notifications,
    queryFn: ({ pageParam }) => social.notifications({ maxId: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.length < PAGE_SIZE ? undefined : lastPage[lastPage.length - 1]?.id,
  });

  // Opening the page marks everything as read.
  const markRead = useMutation({
    mutationFn: social.markNotificationsRead,
    onSuccess: () => queryClient.setQueryData(socialKeys.unreadCount, 0),
  });
  const { mutate } = markRead;
  const loaded = query.isSuccess;
  useEffect(() => {
    if (loaded) mutate();
  }, [loaded, mutate]);

  const items = query.data?.pages.flat() ?? [];

  return (
    <>
      <FeedHeader title={t('notifications.title')} icon={BellIcon} />
      <FeedSection>
        {query.isPending ? (
          <LoadingState label={t('common.loading')} />
        ) : query.isError && items.length === 0 ? (
          <Alert className="m-4">{errorMessage(query.error)}</Alert>
        ) : items.length === 0 ? (
          <p className="px-4 py-16 text-center text-fg-muted">{t('notifications.empty')}</p>
        ) : (
          <ul aria-label={t('notifications.title')}>
            {items.map((notification) => (
              <li key={notification.id} className="border-b border-border last:border-b-0">
                <NotificationItem notification={notification} />
              </li>
            ))}
          </ul>
        )}
        {query.hasNextPage && (
          <div className="flex justify-center p-4">
            <Button
              variant="secondary"
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t('timeline.loadMore')}
            </Button>
          </div>
        )}
      </FeedSection>
    </>
  );
}

function NotificationItem({ notification }: { notification: Notification }) {
  const { t, i18n } = useTranslation();
  const me = useCurrentUser();
  const { account, status, type } = notification;
  const style = typeStyle[type];
  const Icon = style.icon;
  const name = displayName(account);

  // Mentions and replies are conversations: show the whole post.
  // Mentions, replies and ended polls show the whole post (with the final poll results).
  if ((type === 'mention' || type === 'reply' || type === 'poll') && status) {
    return (
      <div className={cx(!notification.read && 'bg-accent-soft/20')}>
        <p className="flex items-center gap-2 px-4 pt-3 text-sm text-fg-muted sm:px-5">
          <span
            className={cx(
              'inline-flex size-6 items-center justify-center rounded-full',
              style.tone,
            )}
          >
            <Icon size={14} />
          </span>
          {type === 'poll'
            ? status.account.id === me?.account.id
              ? t('notifications.pollOwnEnded')
              : t('notifications.pollEnded')
            : t(`notifications.types.${type}`, { name })}
        </p>
        <StatusCard status={status} />
      </div>
    );
  }

  return (
    <div className={cx('flex gap-3 px-4 py-4 sm:px-5', !notification.read && 'bg-accent-soft/20')}>
      <span
        className={cx(
          'inline-flex size-9 shrink-0 items-center justify-center rounded-full',
          style.tone,
        )}
      >
        <Icon size={18} filled={type === 'like'} />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start gap-2">
          <AccountLink account={account} className="shrink-0 rounded-full focus-ring">
            <Avatar account={account} size="sm" />
          </AccountLink>
          <p className="min-w-0 flex-1 text-sm">
            <AccountLink account={account} className="font-semibold hover:underline">
              {name}
            </AccountLink>{' '}
            <span className="text-fg-muted">
              {t(`notifications.verbs.${type}`, { group: notification.group?.name ?? '' })}
            </span>
          </p>
          <time dateTime={notification.createdAt} className="shrink-0 text-xs text-fg-muted">
            {relativeTime(notification.createdAt, i18n.language)}
          </time>
        </div>
        {status && (
          <Link
            {...statusPath(status)}
            className="block rounded-lg border border-border bg-surface-muted/60 px-3 py-2 text-sm text-fg-muted hover:text-fg focus-ring"
          >
            {status.summary || excerpt(status.content) || t('notifications.mediaPost')}
          </Link>
        )}
        {type === 'follow_request' && <FollowRequestActions accountId={account.id} />}
        {notification.group && (
          <Link
            to="/groups/$handle"
            params={{ handle: notification.group.handle }}
            className="inline-block rounded text-sm font-medium text-accent hover:underline focus-ring"
          >
            {t('notifications.openGroup', { name: notification.group.name })}
          </Link>
        )}
        {type === 'group_invite' && notification.group && (
          <InvitationActions groupId={notification.group.id} />
        )}
      </div>
    </div>
  );
}

function InvitationActions({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<'accepted' | 'declined' | null>(null);
  const decide = useMutation({
    mutationFn: (accept: boolean) => (accept ? groups.join(groupId) : groups.leave(groupId)),
    onSuccess: (_, accept) => {
      setOutcome(accept ? 'accepted' : 'declined');
      void queryClient.invalidateQueries({ queryKey: groupKeys.all });
    },
  });
  if (outcome) {
    return (
      <p role="status" className="text-sm font-medium text-fg-muted">
        {outcome === 'accepted' ? t('groups.joined') : t('groups.invitationDeclined')}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button
          className="min-h-9 px-3 py-1"
          loading={decide.isPending && decide.variables === true}
          disabled={decide.isPending}
          onClick={() => decide.mutate(true)}
        >
          {t('groups.accept')}
        </Button>
        <Button
          variant="secondary"
          className="min-h-9 px-3 py-1"
          loading={decide.isPending && decide.variables === false}
          disabled={decide.isPending}
          onClick={() => decide.mutate(false)}
        >
          {t('groups.decline')}
        </Button>
      </div>
      {decide.error && <Alert>{errorMessage(decide.error)}</Alert>}
    </div>
  );
}

function FollowRequestActions({ accountId }: { accountId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<'accepted' | 'rejected' | null>(null);
  const decide = useMutation({
    mutationFn: (accept: boolean) =>
      accept ? social.authorizeFollowRequest(accountId) : social.rejectFollowRequest(accountId),
    onSuccess: (relationship, accept) => {
      setOutcome(accept ? 'accepted' : 'rejected');
      queryClient.setQueryData(socialKeys.relationship(accountId), relationship);
    },
  });

  if (outcome) {
    return (
      <p role="status" className="text-sm font-medium text-fg-muted">
        {outcome === 'accepted' ? t('notifications.accepted') : t('notifications.rejected')}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button
          className="min-h-9 px-3 py-1"
          loading={decide.isPending && decide.variables === true}
          disabled={decide.isPending}
          onClick={() => decide.mutate(true)}
        >
          {t('notifications.accept')}
        </Button>
        <Button
          variant="secondary"
          className="min-h-9 px-3 py-1"
          loading={decide.isPending && decide.variables === false}
          disabled={decide.isPending}
          onClick={() => decide.mutate(false)}
        >
          {t('notifications.reject')}
        </Button>
      </div>
      {decide.error && <Alert>{errorMessage(decide.error)}</Alert>}
    </div>
  );
}
