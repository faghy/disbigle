import type { CurrentUser } from '@disbigle/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { type ComponentType, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../api/endpoints.ts';
import { clearUserData, queryKeys, useMe } from '../api/queries.ts';
import { useUnreadCount } from '../api/socialQueries.ts';
import { useDismiss } from '../lib/dismiss.ts';
import { currentLanguage, isLanguage, type Language, languages, setLanguage } from '../lib/i18n.ts';
import { Avatar } from './Avatar.tsx';
import {
  AspectsIcon,
  BellIcon,
  BookmarkIcon,
  GlobeIcon,
  HomeIcon,
  LocalIcon,
  SettingsIcon,
} from './icons.tsx';
import { buttonClass, cx } from './ui.tsx';

/** Keeps the interface language in line with the signed-in user's setting. */
function useUserLanguage(user: CurrentUser | null | undefined) {
  const locale = user?.locale;
  useEffect(() => {
    if (isLanguage(locale)) void setLanguage(locale);
  }, [locale]);
}

export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: endpoints.logout,
    onSettled: async () => {
      await navigate({ to: '/' });
      queryClient.setQueryData(queryKeys.me, null);
      clearUserData(queryClient);
    },
  });
}

export function RootLayout() {
  const { t } = useTranslation();
  const me = useMe();
  const user = me.data ?? null;
  useUserLanguage(me.data);

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow-lg"
      >
        {t('nav.skipToContent')}
      </a>
      <TopBar user={user} loading={me.isPending} />
      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-8 px-0 sm:px-6">
        {!me.isPending && <SideNav user={user} />}
        <main
          id="main"
          tabIndex={-1}
          className={cx(
            'min-w-0 flex-1 px-4 py-6 sm:px-0 lg:max-w-2xl xl:max-w-3xl',
            user && 'pb-24 md:pb-6',
          )}
        >
          <Outlet />
        </main>
      </div>
      <Footer signedIn={Boolean(user)} />
      {user && <BottomNav />}
    </div>
  );
}

interface NavItem {
  to:
    | '/'
    | '/public/local'
    | '/public'
    | '/notifications'
    | '/aspects'
    | '/bookmarks'
    | '/settings';
  label: string;
  icon: ComponentType<{ size?: number }>;
  exact?: boolean;
  badge?: number;
}

function useNavItems(user: CurrentUser | null): NavItem[] {
  const { t } = useTranslation();
  const unread = useUnreadCount();
  const items: NavItem[] = [
    { to: '/', label: t('nav.home'), icon: HomeIcon, exact: true },
    { to: '/public/local', label: t('nav.local'), icon: LocalIcon },
    { to: '/public', label: t('nav.federated'), icon: GlobeIcon, exact: true },
  ];
  if (!user) return items;
  return [
    ...items,
    {
      to: '/notifications',
      label: t('nav.notifications'),
      icon: BellIcon,
      badge: unread.data ?? 0,
    },
    { to: '/aspects', label: t('nav.aspects'), icon: AspectsIcon },
    { to: '/bookmarks', label: t('nav.bookmarks'), icon: BookmarkIcon },
    { to: '/settings', label: t('nav.settings'), icon: SettingsIcon },
  ];
}

function Badge({ count, className }: { count: number; className?: string }) {
  const { t } = useTranslation();
  if (count <= 0) return null;
  return (
    <span
      className={cx(
        'inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] leading-5 font-semibold text-accent-fg',
        className,
      )}
    >
      <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
      <span className="sr-only">{t('nav.unread', { count })}</span>
    </span>
  );
}

function SideNav({ user }: { user: CurrentUser | null }) {
  const { t } = useTranslation();
  const items = useNavItems(user);
  return (
    <nav aria-label={t('nav.main')} className="hidden w-56 shrink-0 md:block">
      <ul className="sticky top-20 space-y-1 py-6">
        {items.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              activeOptions={{ exact: item.exact ?? false }}
              className={cx(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-[0.95rem] font-medium text-fg-muted transition-colors focus-ring',
                'hover:bg-surface-muted hover:text-fg',
                'data-[status=active]:bg-accent-soft data-[status=active]:text-accent',
              )}
            >
              <item.icon size={22} />
              <span className="flex-1">{item.label}</span>
              {item.badge !== undefined && <Badge count={item.badge} />}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function BottomNav() {
  const { t } = useTranslation();
  const user = useMe().data ?? null;
  const items = useNavItems(user);
  return (
    <nav
      aria-label={t('nav.main')}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="flex">
        {items.map((item) => (
          <li key={item.to} className="flex-1">
            <Link
              to={item.to}
              activeOptions={{ exact: item.exact ?? false }}
              aria-label={item.label}
              title={item.label}
              className={cx(
                'relative flex h-14 items-center justify-center text-fg-muted focus-ring',
                'data-[status=active]:text-accent',
              )}
            >
              <item.icon size={22} />
              {item.badge !== undefined && (
                <Badge count={item.badge} className="absolute top-1.5 left-1/2 ml-1" />
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function TopBar({ user, loading }: { user: CurrentUser | null; loading: boolean }) {
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
        <Link
          to="/"
          className="flex items-center gap-2 rounded-lg text-lg font-bold tracking-tight focus-ring"
        >
          <span
            aria-hidden="true"
            className="inline-flex size-8 items-center justify-center rounded-lg bg-accent text-accent-fg"
          >
            D
          </span>
          <span>Disbigle</span>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <UserMenu user={user} />
          ) : loading ? null : (
            <>
              <Link to="/login" className={buttonClass('ghost', 'hidden sm:inline-flex')}>
                {t('nav.signIn')}
              </Link>
              <Link to="/register" className={buttonClass('primary')}>
                {t('nav.register')}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function UserMenu({ user }: { user: CurrentUser }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const signOut = useSignOut();
  const { account } = user;
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, containerRef, buttonRef);

  const itemClass =
    'block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-surface-muted focus-ring';

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        className="flex items-center gap-2 rounded-full p-1 pr-2 hover:bg-surface-muted focus-ring"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar account={account} size="sm" />
        <span className="hidden max-w-40 truncate text-sm font-medium sm:inline">
          {account.displayName || account.username}
        </span>
        <span className="sr-only">{t('nav.accountMenu')}</span>
      </button>
      <div
        id={menuId}
        hidden={!open}
        className="absolute right-0 mt-2 w-56 rounded-xl border border-border bg-surface p-1.5 shadow-lg"
      >
        <p className="truncate px-3 py-2 text-xs text-fg-muted">@{account.username}</p>
        <Link
          to="/@{$username}"
          params={{ username: account.username }}
          className={itemClass}
          onClick={() => setOpen(false)}
        >
          {t('nav.viewProfile')}
        </Link>
        <Link to="/settings/profile" className={itemClass} onClick={() => setOpen(false)}>
          {t('nav.settings')}
        </Link>
        <hr className="my-1 border-border" />
        <button
          type="button"
          className={cx(itemClass, 'text-danger')}
          disabled={signOut.isPending}
          onClick={() => {
            setOpen(false);
            signOut.mutate();
          }}
        >
          {t('nav.signOut')}
        </button>
      </div>
    </div>
  );
}

function Footer({ signedIn }: { signedIn: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <footer className={cx('border-t border-border', signedIn && 'hidden md:block')}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-fg-muted sm:px-6">
        <p>{t('footer.tagline')}</p>
        {!signedIn && (
          <div className="flex items-center gap-2">
            <label htmlFor={id}>{t('footer.language')}</label>
            <select
              id={id}
              className="input-base w-auto py-1"
              value={currentLanguage()}
              onChange={(event) => {
                const value = event.target.value;
                if (isLanguage(value)) void setLanguage(value, { remember: true });
              }}
            >
              {languages.map((language: Language) => (
                <option key={language} value={language}>
                  {t(`languages.${language}`)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </footer>
  );
}
