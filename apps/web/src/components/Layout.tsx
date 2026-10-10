import type { CurrentUser } from '@disbigle/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../api/endpoints.ts';
import { clearUserData, queryKeys, useMe } from '../api/queries.ts';
import { currentLanguage, isLanguage, type Language, languages, setLanguage } from '../lib/i18n.ts';
import { Avatar } from './Avatar.tsx';
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
  useUserLanguage(me.data);

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow-lg"
      >
        {t('nav.skipToContent')}
      </a>
      <TopBar user={me.data ?? null} loading={me.isPending} />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
        <Outlet />
      </main>
      <Footer signedIn={Boolean(me.data)} />
    </div>
  );
}

const navLinkClass = cx(
  'rounded-lg px-3 py-2 text-sm font-medium text-fg-muted transition-colors focus-ring',
  'hover:bg-surface-muted hover:text-fg data-[status=active]:text-fg',
  'data-[status=active]:bg-surface-muted',
);

function TopBar({ user, loading }: { user: CurrentUser | null; loading: boolean }) {
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-4xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
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

        {user && (
          <nav aria-label={t('nav.main')} className="flex items-center gap-1">
            <Link to="/" activeOptions={{ exact: true }} className={navLinkClass}>
              {t('nav.home')}
            </Link>
            <Link to="/settings" className={navLinkClass}>
              {t('nav.settings')}
            </Link>
          </nav>
        )}

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

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    // Close when keyboard focus moves outside the menu (for example with Tab).
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (next && !containerRef.current?.contains(next)) setOpen(false);
    };
    const container = containerRef.current;
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    container?.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      container?.removeEventListener('focusout', onFocusOut);
    };
  }, [open]);

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
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-fg-muted sm:px-6">
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
