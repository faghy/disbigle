import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type AdminUser, admin, adminKeys } from '../../api/admin.ts';
import { errorMessage } from '../../api/errors.ts';
import { Avatar } from '../../components/Avatar.tsx';
import { Alert, Button, Card, cx, LoadingState } from '../../components/ui.tsx';
import { fullDateTime, relativeTime } from '../../lib/time.ts';

type Status = 'active' | 'pending' | 'suspended' | 'disabled' | 'deleting';

function statusOf(user: AdminUser): Status {
  if (user.deletionRequested) return 'deleting';
  if (user.suspended) return 'suspended';
  if (user.disabled) return 'disabled';
  if (!user.approved) return 'pending';
  return 'active';
}

/** The list as a CSV file, for a spreadsheet. */
function downloadCsv(users: AdminUser[]) {
  const columns: (keyof AdminUser)[] = [
    'username',
    'displayName',
    'email',
    'role',
    'locale',
    'createdAt',
    'lastActiveAt',
    'posts',
    'followers',
    'following',
    'twoFactor',
    'suspended',
  ];
  const cell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = [
    columns.join(','),
    ...users.map((user) => columns.map((c) => cell(user[c])).join(',')),
  ].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `disbigle-users-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function UsersPage() {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);
  const users = useQuery({
    queryKey: adminKeys.users(query),
    queryFn: () => admin.users(query),
    placeholderData: (previous) => previous,
  });

  return (
    <section aria-labelledby="users-title" className="space-y-3">
      <h2 id="users-title" className="sr-only">
        {t('admin.tabs.users')}
      </h2>
      <p className="text-sm text-fg-muted">{t('admin.users.description')}</p>
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor={id} className="block text-xs font-medium text-fg-muted">
            {t('admin.users.search')}
          </label>
          <input
            id={id}
            type="search"
            className="input-base"
            value={text}
            placeholder={t('admin.users.searchPlaceholder')}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <Button
          variant="secondary"
          disabled={!users.data?.length}
          onClick={() => users.data && downloadCsv(users.data)}
        >
          {t('admin.users.export')}
        </Button>
      </Card>
      {users.isPending ? (
        <LoadingState label={t('common.loading')} />
      ) : users.isError ? (
        <Alert>{errorMessage(users.error)}</Alert>
      ) : users.data.length === 0 ? (
        <Card className="text-center text-fg-muted">
          {query ? t('admin.users.noMatch', { query }) : t('admin.users.empty')}
        </Card>
      ) : (
        <>
          <p className="text-sm text-fg-muted" aria-live="polite">
            {t('admin.users.count', { count: users.data.length })}
          </p>
          <Card className="p-0" aria-busy={users.isFetching}>
            <ul aria-label={t('admin.tabs.users')} className="divide-y divide-border">
              {users.data.map((user) => (
                <li key={user.userId}>
                  <UserRow user={user} />
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </section>
  );
}

function UserRow({ user }: { user: AdminUser }) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language);
  const status = statusOf(user);
  const joined = new Date(user.createdAt).toLocaleDateString(i18n.language, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const facts: [string, ReactNode][] = [
    [
      t('admin.users.joined'),
      <time
        key="joined"
        dateTime={user.createdAt}
        title={fullDateTime(user.createdAt, i18n.language)}
      >
        {joined}
      </time>,
    ],
    [
      t('admin.users.lastActive'),
      user.lastActiveAt ? (
        <time
          key="active"
          dateTime={user.lastActiveAt}
          title={fullDateTime(user.lastActiveAt, i18n.language)}
        >
          {relativeTime(user.lastActiveAt, i18n.language)}
        </time>
      ) : (
        t('admin.users.never')
      ),
    ],
    [t('admin.users.posts'), number.format(user.posts)],
    [t('admin.users.followers'), number.format(user.followers)],
    [t('admin.users.following'), number.format(user.following)],
    [t('admin.users.twoFactor'), user.twoFactor ? t('admin.users.yes') : t('admin.users.no')],
    [
      t('admin.users.lastIp'),
      <span key="ip" className="font-mono">
        {user.lastIp ?? '—'}
      </span>,
    ],
  ];
  return (
    <div className="space-y-2 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-start gap-3">
        <Link
          to="/@{$username}"
          params={{ username: user.username }}
          className="flex min-w-0 flex-1 items-center gap-3 rounded focus-ring"
        >
          <Avatar
            account={{
              displayName: user.displayName,
              username: user.username,
              avatarUrl: user.avatarUrl,
            }}
            size="sm"
          />
          <span className="min-w-0">
            <span className="block truncate font-medium hover:underline">
              {user.displayName || user.username}
            </span>
            <span className="block truncate text-sm text-fg-muted">
              @{user.username}
              {user.role !== 'user' && <> · {t(`admin.roles.${user.role}`)}</>}
            </span>
          </span>
        </Link>
        <span
          className={cx(
            'rounded-full px-2 py-0.5 text-xs font-medium',
            status === 'active'
              ? 'bg-success-soft text-success'
              : status === 'pending'
                ? 'bg-accent-soft text-accent'
                : 'bg-danger-soft text-danger',
          )}
        >
          {t(`admin.users.statuses.${status}`)}
        </span>
      </div>
      <a href={`mailto:${user.email}`} className="block text-sm break-all hover:underline">
        {user.email}
      </a>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {facts.map(([term, value]) => (
          <div key={term} className="flex gap-1">
            <dt className="text-fg-muted">{term}</dt>
            <dd className="font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
