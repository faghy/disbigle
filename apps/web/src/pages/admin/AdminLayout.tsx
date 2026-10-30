import { useQuery } from '@tanstack/react-query';
import { Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { isModerator, summaryQueryOptions } from '../../api/admin.ts';
import { useCurrentUser } from '../../api/queries.ts';
import { FeedHeader } from '../../components/FeedSection.tsx';
import { ShieldIcon } from '../../components/icons.tsx';
import { cx } from '../../components/ui.tsx';

const tabClass = cx(
  'inline-flex shrink-0 items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors focus-ring',
  'hover:bg-surface-muted hover:text-fg data-[status=active]:border-transparent',
  'data-[status=active]:bg-accent-soft data-[status=active]:text-accent',
);

function Count({ value }: { value: number | undefined }) {
  if (!value) return null;
  return (
    <span className="rounded-full bg-accent px-1.5 text-[11px] leading-5 font-semibold text-accent-fg">
      {value}
    </span>
  );
}

export function AdminLayout() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const summary = useQuery({ ...summaryQueryOptions, enabled: isModerator(user) });
  if (!isModerator(user)) return null;

  return (
    <div className="space-y-4">
      <FeedHeader
        title={t('admin.title')}
        description={user?.role === 'admin' ? t('admin.roleAdmin') : t('admin.roleModerator')}
        icon={ShieldIcon}
      />
      <nav aria-label={t('admin.sections')} className="flex flex-wrap gap-2">
        {user?.role === 'admin' && (
          <Link to="/admin/dashboard" className={tabClass}>
            {t('admin.tabs.dashboard')}
          </Link>
        )}
        <Link to="/admin/pending" className={tabClass}>
          {t('admin.tabs.pending')}
          <Count value={summary.data?.pendingUsers} />
        </Link>
        <Link to="/admin/reports" className={tabClass}>
          {t('admin.tabs.reports')}
          <Count value={summary.data?.openReports} />
        </Link>
        {user?.role === 'admin' && (
          <Link to="/admin/users" className={tabClass}>
            {t('admin.tabs.users')}
          </Link>
        )}
        <Link to="/admin/accounts" className={tabClass}>
          {t('admin.tabs.accounts')}
        </Link>
        <Link to="/admin/federation" className={tabClass}>
          {t('admin.tabs.federation')}
        </Link>
        <Link to="/admin/domains" className={tabClass}>
          {t('admin.tabs.domains')}
        </Link>
        {user?.role === 'admin' && (
          <Link to="/admin/instance" className={tabClass}>
            {t('admin.tabs.instance')}
          </Link>
        )}
      </nav>
      <Outlet />
    </div>
  );
}
