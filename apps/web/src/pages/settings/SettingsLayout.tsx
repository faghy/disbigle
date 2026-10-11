import { Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useCurrentUser } from '../../api/queries.ts';
import { cx } from '../../components/ui.tsx';

const tabClass = cx(
  'shrink-0 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors focus-ring',
  'hover:bg-surface-muted hover:text-fg data-[status=active]:border-transparent',
  'data-[status=active]:bg-accent-soft data-[status=active]:text-accent',
);

export function SettingsLayout() {
  const { t } = useTranslation();
  const user = useCurrentUser();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-3 text-sm font-semibold tracking-wide text-fg-muted uppercase">
          {t('settings.title')}
        </h1>
        {/* Chips that wrap: every section stays visible, even on narrow screens. */}
        <nav aria-label={t('settings.nav')} className="flex flex-wrap gap-2">
          <Link to="/settings/profile" className={tabClass}>
            {t('settings.profile.tab')}
          </Link>
          <Link to="/settings/account" className={tabClass}>
            {t('settings.account.tab')}
          </Link>
          <Link to="/settings/security" className={tabClass}>
            {t('settings.security.tab')}
          </Link>
          <Link to="/settings/apps" className={tabClass}>
            {t('apps.tab')}
          </Link>
          <Link to="/settings/notifications" className={tabClass}>
            {t('settings.notifications.tab')}
          </Link>
          <Link to="/settings/muted-words" className={tabClass}>
            {t('filters.tab')}
          </Link>
          <Link to="/settings/invites" className={tabClass}>
            {t('invites.tab')}
          </Link>
        </nav>
      </div>
      <div className="min-w-0">{user ? <Outlet /> : null}</div>
    </div>
  );
}
