import { Link, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { isAdmin } from '../../api/admin.ts';
import { useCurrentUser } from '../../api/queries.ts';
import { FeedHeader } from '../../components/FeedSection.tsx';
import { WrenchIcon } from '../../components/icons.tsx';
import { cx } from '../../components/ui.tsx';

const tabClass = cx(
  'inline-flex shrink-0 items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors focus-ring',
  'hover:bg-surface-muted hover:text-fg data-[status=active]:border-transparent',
  'data-[status=active]:bg-accent-soft data-[status=active]:text-accent',
);

/** Administration (administrators only): the server, its people and its groups. */
export function AdminLayout() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  if (!isAdmin(user)) return null;

  return (
    <div className="space-y-4">
      <FeedHeader
        title={t('administration.title')}
        description={t('administration.description')}
        icon={WrenchIcon}
      />
      <nav aria-label={t('admin.sections')} className="flex flex-wrap gap-2">
        <Link to="/admin/dashboard" className={tabClass}>
          {t('admin.tabs.dashboard')}
        </Link>
        <Link to="/admin/users" className={tabClass}>
          {t('admin.tabs.users')}
        </Link>
        <Link to="/admin/groups" className={tabClass}>
          {t('admin.tabs.groups')}
        </Link>
        <Link to="/admin/instance" className={tabClass}>
          {t('admin.tabs.instance')}
        </Link>
      </nav>
      <Outlet />
    </div>
  );
}
