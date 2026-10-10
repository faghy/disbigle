import { Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useCurrentUser } from '../../api/queries.ts';
import { cx } from '../../components/ui.tsx';

const tabClass = cx(
  'shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-fg-muted transition-colors focus-ring',
  'hover:bg-surface-muted hover:text-fg',
  'data-[status=active]:bg-accent-soft data-[status=active]:text-accent',
);

export function SettingsLayout() {
  const { t } = useTranslation();
  const user = useCurrentUser();

  return (
    <div className="grid gap-6 md:grid-cols-[12rem_1fr] md:gap-10">
      <div>
        <h1 className="mb-3 px-3 text-sm font-semibold tracking-wide text-fg-muted uppercase">
          {t('settings.title')}
        </h1>
        <nav
          aria-label={t('settings.nav')}
          className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:flex-col md:overflow-visible"
        >
          <Link to="/settings/profile" className={tabClass}>
            {t('settings.profile.tab')}
          </Link>
          <Link to="/settings/account" className={tabClass}>
            {t('settings.account.tab')}
          </Link>
          <Link to="/settings/security" className={tabClass}>
            {t('settings.security.tab')}
          </Link>
        </nav>
      </div>
      <div className="min-w-0">{user ? <Outlet /> : null}</div>
    </div>
  );
}
