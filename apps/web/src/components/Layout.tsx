import type { CurrentUser } from '@disbigle/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { type ComponentType, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isModerator, summaryQueryOptions } from '../api/admin.ts';
import { endpoints } from '../api/endpoints.ts';
import { clearUserData, queryKeys, useInstance, useMe } from '../api/queries.ts';
import { useFollowedTags } from '../api/socialQueries.ts';
import { useDismiss } from '../lib/dismiss.ts';
import { currentLanguage, isLanguage, type Language, languages, setLanguage } from '../lib/i18n.ts';
import { setTheme, themes, useTheme } from '../lib/theme.ts';
import { Avatar } from './Avatar.tsx';
import { ComposeButton } from './ComposeSheet.tsx';
import { useFocusTrap } from './Dialog.tsx';
import {
  AspectsIcon,
  BookmarkIcon,
  CloseIcon,
  GlobeIcon,
  HomeIcon,
  InfoIcon,
  LocalIcon,
  MailIcon,
  MenuIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
} from './icons.tsx';
import { Logo } from './Logo.tsx';
import { NotificationBell } from './NotificationBell.tsx';
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
      {/* Full width on desktop: navigation, content, and a side panel on wide screens. */}
      <div className="flex w-full flex-1 gap-6 px-0 sm:px-4 lg:px-6 xl:gap-8">
        {!me.isPending && <SideNav user={user} />}
        <main
          id="main"
          tabIndex={-1}
          className={cx('min-w-0 flex-1 px-4 py-6 sm:px-0', user && 'pb-24 md:pb-6')}
        >
          <Outlet />
        </main>
        {!me.isPending && <SidePanel user={user} />}
      </div>
      <Footer signedIn={Boolean(user)} />
      {user && <ComposeButton />}
      {user && <BottomNav />}
    </div>
  );
}

interface NavItem {
  to:
    | '/'
    | '/public/local'
    | '/public'
    | '/messages'
    | '/aspects'
    | '/bookmarks'
    | '/settings'
    | '/admin';
  label: string;
  icon: ComponentType<{ size?: number }>;
  exact?: boolean;
  badge?: number;
  badgeKey?: string;
}

function useNavItems(user: CurrentUser | null): NavItem[] {
  const { t } = useTranslation();
  const moderator = isModerator(user);
  const summary = useQuery({ ...summaryQueryOptions, enabled: moderator });
  const items: NavItem[] = [
    { to: '/', label: t('nav.home'), icon: HomeIcon, exact: true },
    { to: '/public/local', label: t('nav.local'), icon: LocalIcon },
    { to: '/public', label: t('nav.federated'), icon: GlobeIcon, exact: true },
  ];
  if (!user) return items;
  // Notifications live behind the bell in the top bar.
  return [
    ...items,
    { to: '/messages', label: t('nav.messages'), icon: MailIcon },
    { to: '/aspects', label: t('nav.aspects'), icon: AspectsIcon },
    { to: '/bookmarks', label: t('nav.bookmarks'), icon: BookmarkIcon },
    { to: '/settings', label: t('nav.settings'), icon: SettingsIcon },
    ...(moderator
      ? [
          {
            to: '/admin' as const,
            label: t('nav.moderation'),
            icon: ShieldIcon,
            badge: (summary.data?.pendingUsers ?? 0) + (summary.data?.openReports ?? 0),
            badgeKey: 'nav.moderationPending',
          },
        ]
      : []),
  ];
}

function Badge({
  count,
  className,
  labelKey = 'nav.unread',
}: {
  count: number;
  className?: string;
  labelKey?: string;
}) {
  const { t } = useTranslation();
  if (count <= 0) return null;
  return (
    <span
      className={cx(
        'inline-flex min-w-5 items-center justify-center rounded-full border-2 border-ink bg-accent px-1.5 text-[11px] leading-4 font-extrabold text-accent-fg',
        className,
      )}
    >
      <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
      <span className="sr-only">{t(labelKey, { count })}</span>
    </span>
  );
}

function FollowedTags() {
  const { t } = useTranslation();
  const tags = useFollowedTags();
  if (!tags.data || tags.data.length === 0) return null;
  return (
    <section aria-labelledby="followed-tags-title" className="mt-6 border-t border-border pt-4">
      <h2
        id="followed-tags-title"
        className="px-3 text-xs font-semibold tracking-wide text-fg-muted uppercase"
      >
        {t('tags.followedTitle')}
      </h2>
      <ul className="mt-2 space-y-0.5">
        {tags.data.map((name) => (
          <li key={name}>
            <Link
              to="/tags/$tag"
              params={{ tag: name }}
              className="block truncate rounded-lg px-3 py-1.5 text-sm text-fg-muted hover:bg-surface-muted hover:text-fg focus-ring data-[status=active]:text-accent"
            >
              #{name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SideNav({ user }: { user: CurrentUser | null }) {
  const { t } = useTranslation();
  const items = useNavItems(user);
  return (
    <div className="hidden w-56 shrink-0 md:block lg:w-64">
      <div className="sticky top-16 max-h-[calc(100dvh-4rem)] overflow-y-auto py-6">
        <nav aria-label={t('nav.main')}>
          <ul className="space-y-1">
            {items.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  activeOptions={{ exact: item.exact ?? false }}
                  className={cx(
                    'flex items-center gap-3 rounded-2xl border-2 border-transparent px-3 py-2.5 font-display text-[1.05rem] font-semibold text-fg-muted transition focus-ring',
                    'hover:bg-surface-muted hover:text-fg',
                    'data-[status=active]:border-ink data-[status=active]:bg-sun data-[status=active]:text-ink data-[status=active]:shadow-[3px_3px_0_0_var(--ink)]',
                  )}
                >
                  <item.icon size={22} />
                  <span className="flex-1">{item.label}</span>
                  {item.badge !== undefined && (
                    <Badge count={item.badge} labelKey={item.badgeKey} />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {/* Below the width where the side panel appears, the tags stay here. */}
        {user && (
          <div className="xl:hidden">
            <FollowedTags />
          </div>
        )}
      </div>
    </div>
  );
}

/** The followed hashtags as a card of the side panel (nothing when there are none). */
function FollowedTagsCard() {
  const tags = useFollowedTags();
  if (!tags.data || tags.data.length === 0) return null;
  return (
    <div className="sticker-soft rounded-3xl bg-surface px-1 pb-3 [&>section]:mt-0 [&>section]:border-t-0">
      <FollowedTags />
    </div>
  );
}

/** Right column on wide screens: this server, and the hashtags you follow. */
function SidePanel({ user }: { user: CurrentUser | null }) {
  const { t } = useTranslation();
  const instance = useInstance().data;
  return (
    <aside aria-label={t('nav.sidePanel')} className="hidden w-80 shrink-0 xl:block 2xl:w-96">
      <div className="sticky top-16 max-h-[calc(100dvh-4rem)] space-y-4 overflow-y-auto py-6">
        {instance && (
          <section
            aria-labelledby="side-instance-title"
            className="sticker-soft rounded-3xl bg-surface p-4"
          >
            {/* Not a heading: the page itself often names the server already. */}
            <p id="side-instance-title" className="font-semibold">
              {instance.title}
            </p>
            <p className="mt-0.5 text-xs text-fg-muted">{instance.domain}</p>
            {instance.description && (
              <p className="mt-3 line-clamp-4 text-sm text-fg-muted">{instance.description}</p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to="/about" className={buttonClass('secondary', 'min-h-9 px-3 py-1 text-sm')}>
                {t('nav.aboutServer')}
              </Link>
              {!user && (
                <Link
                  to="/register"
                  className={buttonClass('primary', 'min-h-9 px-3 py-1 text-sm')}
                >
                  {t('nav.register')}
                </Link>
              )}
            </div>
          </section>
        )}
        {user && <FollowedTagsCard />}
      </div>
    </aside>
  );
}

/** Pages kept in the mobile "More" sheet (the bottom bar has room for four). */
const morePaths = ['/public/local', '/public', '/bookmarks', '/settings', '/admin'];

const bottomLinkClass = cx(
  'relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-bold text-fg-muted focus-ring',
  'data-[status=active]:text-accent [&[data-status=active]>svg]:-rotate-6 [&>svg]:transition-transform',
);

function BottomNav() {
  const { t } = useTranslation();
  const user = useMe().data ?? null;
  const items = useNavItems(user);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const byPath = (path: NavItem['to']) => items.find((item) => item.to === path);
  const primary = [byPath('/'), byPath('/aspects'), byPath('/messages')].filter(
    (item): item is NavItem => Boolean(item),
  );
  const more = items.filter((item) => morePaths.includes(item.to));
  const moreBadge = more.reduce((sum, item) => sum + (item.badge ?? 0), 0);
  const moreActive = more.some(
    (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
  );

  return (
    <>
      <nav
        aria-label={t('nav.main')}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="flex">
          {primary.map((item) => (
            <li key={item.to} className="flex-1">
              <Link
                to={item.to}
                activeOptions={{ exact: item.exact ?? false }}
                className={bottomLinkClass}
              >
                <item.icon size={22} />
                <span>{item.label}</span>
                {item.badge !== undefined && (
                  <Badge
                    count={item.badge}
                    labelKey={item.badgeKey}
                    className="absolute top-1 left-1/2 ml-1.5"
                  />
                )}
              </Link>
            </li>
          ))}
          <li className="flex-1">
            <Link to="/search" className={bottomLinkClass}>
              <SearchIcon size={22} />
              <span>{t('search.title')}</span>
            </Link>
          </li>
          <li className="flex-1">
            <button
              ref={moreButton}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(true)}
              data-status={moreActive ? 'active' : undefined}
              className={cx(bottomLinkClass, 'w-full')}
            >
              <MenuIcon size={22} />
              <span>{t('nav.more')}</span>
              <Badge
                count={moreBadge}
                labelKey="nav.moderationPending"
                className="absolute top-1 left-1/2 ml-1.5"
              />
            </button>
          </li>
        </ul>
      </nav>
      {moreOpen && (
        <MoreSheet
          items={more}
          onClose={() => {
            setMoreOpen(false);
            moreButton.current?.focus();
          }}
        />
      )}
    </>
  );
}

/** Bottom sheet with the pages that do not fit in the mobile bar. */
function MoreSheet({ items, onClose }: { items: NavItem[]; onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const trap = useFocusTrap(ref);
  const titleId = useId();
  return (
    <div
      className="fixed inset-0 z-40 flex items-end bg-black/50 md:hidden"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
          trap(event);
        }}
        className="w-full rounded-t-2xl border-t border-border bg-surface px-3 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl"
      >
        <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-border-strong" />
        <div className="flex items-center justify-between px-2 pb-1">
          <h2 id={titleId} className="font-semibold">
            {t('nav.more')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="inline-flex size-10 items-center justify-center rounded-full text-fg-muted hover:bg-surface-muted focus-ring"
          >
            <CloseIcon size={18} />
          </button>
        </div>
        <ul className="grid grid-cols-3 gap-2">
          {[...items, { to: '/about' as const, label: t('footer.about'), icon: InfoIcon }].map(
            (item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  activeOptions={{ exact: 'exact' in item ? (item.exact ?? false) : false }}
                  onClick={onClose}
                  className={cx(
                    'relative flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-center text-xs font-medium text-fg-muted focus-ring',
                    'hover:bg-surface-muted hover:text-fg data-[status=active]:bg-accent-soft data-[status=active]:text-accent',
                  )}
                >
                  <item.icon size={24} />
                  <span>{item.label}</span>
                  {'badge' in item && item.badge !== undefined && (
                    <Badge
                      count={item.badge}
                      labelKey={item.badgeKey}
                      className="absolute top-1.5 right-2"
                    />
                  )}
                </Link>
              </li>
            ),
          )}
        </ul>
      </div>
    </div>
  );
}

function TopBar({ user, loading }: { user: CurrentUser | null; loading: boolean }) {
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur">
      <div className="flex h-16 w-full items-center gap-2 px-4 sm:gap-4 lg:px-6">
        <Link
          to="/"
          aria-label="Disbigle"
          className="group rounded-xl focus-ring [&_svg]:transition-transform hover:[&_svg]:rotate-6"
        >
          <Logo />
        </Link>

        <TopSearch />

        <div className="ml-auto flex items-center gap-2">
          {!user && (
            <Link
              to="/search"
              aria-label={t('search.title')}
              title={t('search.title')}
              className="inline-flex size-10 items-center justify-center rounded-full text-fg-muted hover:bg-surface-muted hover:text-fg focus-ring md:hidden"
            >
              <SearchIcon />
            </Link>
          )}
          {user ? (
            <>
              <UserMenu user={user} />
              <NotificationBell />
            </>
          ) : loading ? null : (
            <>
              <Link to="/login" className={buttonClass('ghost', 'max-sm:hidden')}>
                {t('nav.signIn')}
              </Link>
              <Link
                to="/register"
                className={buttonClass('primary', 'whitespace-nowrap px-3 sm:px-4')}
              >
                {t('nav.register')}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/** Search box in the top bar (wider screens); it opens the search page with the query. */
function TopSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const id = useId();
  const [text, setText] = useState('');
  const onSearchPage = useRouterState({ select: (state) => state.location.pathname === '/search' });
  if (onSearchPage) return null;
  return (
    <search className="ml-4 hidden max-w-md flex-1 md:block lg:ml-14">
      <form
        className="relative"
        onSubmit={(event) => {
          event.preventDefault();
          const q = text.trim();
          void navigate({ to: '/search', search: { q: q || undefined } });
          setText('');
        }}
      >
        <label htmlFor={id} className="sr-only">
          {t('search.label')}
        </label>
        <SearchIcon
          size={16}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted"
        />
        <input
          id={id}
          type="search"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('search.shortPlaceholder')}
          className="input-base rounded-full py-1.5 pl-9 text-sm"
        />
      </form>
    </search>
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
        className="absolute right-0 mt-2 w-56 sticker rounded-2xl bg-surface p-1.5"
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
        <Link to="/about" className={itemClass} onClick={() => setOpen(false)}>
          {t('footer.about')}
        </Link>
        <hr className="my-1 border-border" />
        <ThemeChoice />
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

/** Light (the default), dark, or the system's choice; kept on this device. */
function ThemeChoice() {
  const { t } = useTranslation();
  const theme = useTheme();
  const name = useId();
  return (
    <fieldset className="px-3 py-2">
      <legend className="float-left mb-1.5 text-xs text-fg-muted">{t('theme.label')}</legend>
      <div className="clear-left grid grid-cols-3 gap-1 rounded-lg bg-surface-muted p-1">
        {themes.map((value) => (
          <label
            key={value}
            className={cx(
              'cursor-pointer rounded-md px-1.5 py-1 text-center text-xs font-medium text-fg-muted has-focus-visible:ring-2 has-focus-visible:ring-accent',
              theme === value ? 'bg-surface text-fg shadow-sm' : 'hover:text-fg',
            )}
          >
            <input
              type="radio"
              name={name}
              value={value}
              checked={theme === value}
              onChange={() => setTheme(value)}
              className="sr-only"
            />
            {t(`theme.${value}`)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Footer({ signedIn }: { signedIn: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <footer className={cx('border-t border-border', signedIn && 'hidden md:block')}>
      <div className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-fg-muted lg:px-6">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{t('footer.tagline')}</span>
          <Link to="/about" className="rounded font-medium text-fg hover:underline focus-ring">
            {t('footer.about')}
          </Link>
        </p>
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
