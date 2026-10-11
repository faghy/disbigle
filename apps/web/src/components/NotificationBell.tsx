import type { Notification } from '@disbigle/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { socialKeys } from '../api/cache.ts';
import { errorMessage } from '../api/errors.ts';
import { social } from '../api/social.ts';
import { useUnreadCount } from '../api/socialQueries.ts';
import { useDismiss } from '../lib/dismiss.ts';
import { relativeTime } from '../lib/time.ts';
import { excerpt, typeStyle } from '../pages/Notifications.tsx';
import { Avatar } from './Avatar.tsx';
import { BellIcon } from './icons.tsx';
import { displayName, profilePath, statusPath } from './StatusCard.tsx';
import { Alert, cx, LoadingState } from './ui.tsx';

const RECENT = 8;
/** Not under `socialKeys.notifications`: that key holds the paged list of the full page. */
const recentKey = ['notificationsRecent'] as const;

/**
 * Bell at the top right: the unread count, and a panel with the latest notifications. Opening it
 * marks them as read, as opening the notifications page does.
 */
export function NotificationBell() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const unread = useUnreadCount().data ?? 0;
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const titleId = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, containerRef, buttonRef);

  const recent = useQuery({
    queryKey: recentKey,
    queryFn: () => social.notifications({ limit: RECENT }),
    enabled: open,
    staleTime: 0,
  });
  const markRead = useMutation({
    mutationFn: social.markNotificationsRead,
    onSuccess: () => {
      queryClient.setQueryData(socialKeys.unreadCount, 0);
      void queryClient.invalidateQueries({ queryKey: socialKeys.notifications });
    },
  });
  const { mutate } = markRead;
  const loaded = recent.isSuccess;
  useEffect(() => {
    if (open && loaded && unread > 0) mutate();
  }, [open, loaded, unread, mutate]);

  const label =
    unread > 0
      ? `${t('nav.notifications')}, ${t('nav.unread', { count: unread })}`
      : t('nav.notifications');

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        title={t('nav.notifications')}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cx(
          'relative inline-flex size-10 items-center justify-center rounded-full text-fg-muted hover:bg-surface-muted hover:text-fg focus-ring',
          open && 'bg-surface-muted text-fg',
        )}
      >
        <BellIcon size={22} />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-0.5 right-0.5 inline-flex min-w-[1.15rem] items-center justify-center rounded-full bg-accent px-1 text-[10px] leading-[1.15rem] font-semibold text-accent-fg ring-2 ring-bg"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      <section
        id={panelId}
        hidden={!open}
        aria-labelledby={titleId}
        className="absolute right-0 mt-2 flex max-h-[min(36rem,calc(100dvh-6rem))] w-[min(26rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg max-sm:-right-12"
      >
        <h2 id={titleId} className="border-b border-border px-4 py-3 font-semibold">
          {t('notifications.title')}
        </h2>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {recent.isPending ? (
            <LoadingState label={t('common.loading')} />
          ) : recent.isError ? (
            <Alert className="m-3">{errorMessage(recent.error)}</Alert>
          ) : recent.data.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-fg-muted">
              {t('notifications.empty')}
            </p>
          ) : (
            <ul>
              {recent.data.map((notification) => (
                <li key={notification.id} className="border-b border-border last:border-b-0">
                  <BellItem notification={notification} onPick={close} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <Link
          to="/notifications"
          onClick={close}
          className="border-t border-border px-4 py-3 text-center text-sm font-medium text-accent hover:bg-surface-muted focus-ring"
        >
          {t('notifications.seeAll')}
        </Link>
      </section>
    </div>
  );
}

function BellItem({ notification, onPick }: { notification: Notification; onPick: () => void }) {
  const { t, i18n } = useTranslation();
  const { account, status, type } = notification;
  const style = typeStyle[type];
  const Icon = style.icon;
  const target = status ? statusPath(status) : profilePath(account);
  return (
    <Link
      {...target}
      onClick={onPick}
      className={cx(
        'flex gap-3 px-4 py-3 hover:bg-surface-muted focus-ring',
        !notification.read && 'bg-accent-soft/30',
      )}
    >
      <span className="relative shrink-0">
        <Avatar account={account} size="sm" />
        <span
          className={cx(
            'absolute -right-1 -bottom-1 inline-flex size-5 items-center justify-center rounded-full ring-2 ring-surface',
            style.tone,
          )}
        >
          <Icon size={11} filled={type === 'like'} />
        </span>
      </span>
      <span className="min-w-0 flex-1 text-sm">
        <span className="block">
          <span className="font-semibold">{displayName(account)}</span>{' '}
          <span className="text-fg-muted">{t(`notifications.verbs.${type}`)}</span>
        </span>
        {status && (
          <span className="mt-0.5 block truncate text-fg-muted">
            {status.summary || excerpt(status.content, 90) || t('notifications.mediaPost')}
          </span>
        )}
      </span>
      <time dateTime={notification.createdAt} className="shrink-0 text-xs text-fg-muted">
        {relativeTime(notification.createdAt, i18n.language)}
      </time>
    </Link>
  );
}
