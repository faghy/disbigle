import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type AdminGroup, admin, adminKeys } from '../../api/admin.ts';
import { errorMessage } from '../../api/errors.ts';
import { GroupAvatar, PrivacyLabel } from '../../components/GroupParts.tsx';
import { Alert, Card, LoadingState } from '../../components/ui.tsx';
import { fullDateTime, relativeTime } from '../../lib/time.ts';

/** Every group of this server, secret ones included, for administrators. */
export function AdminGroupsPage() {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);
  const list = useQuery({
    queryKey: adminKeys.groups(query),
    queryFn: () => admin.groups(query),
    placeholderData: (previous) => previous,
  });

  return (
    <section aria-labelledby="admin-groups-title" className="space-y-3">
      <h2 id="admin-groups-title" className="sr-only">
        {t('admin.tabs.groups')}
      </h2>
      <p className="text-sm text-fg-muted">{t('admin.groups.description')}</p>
      <Card className="p-4">
        <label htmlFor={id} className="mb-1 block text-xs font-medium text-fg-muted">
          {t('admin.groups.search')}
        </label>
        <input
          id={id}
          type="search"
          className="input-base"
          value={text}
          placeholder={t('admin.groups.searchPlaceholder')}
          onChange={(event) => setText(event.target.value)}
        />
      </Card>
      {list.isPending ? (
        <LoadingState label={t('common.loading')} />
      ) : list.isError ? (
        <Alert>{errorMessage(list.error)}</Alert>
      ) : list.data.length === 0 ? (
        <Card className="text-center text-fg-muted">
          {query ? t('admin.groups.noMatch', { query }) : t('admin.groups.empty')}
        </Card>
      ) : (
        <>
          <p className="text-sm text-fg-muted" aria-live="polite">
            {t('admin.groups.count', { count: list.data.length })}
          </p>
          <Card className="p-0" aria-busy={list.isFetching}>
            <ul aria-label={t('admin.tabs.groups')} className="divide-y divide-border">
              {list.data.map((group) => (
                <li key={group.id}>
                  <GroupRow group={group} />
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </section>
  );
}

function GroupRow({ group }: { group: AdminGroup }) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language);
  const created = new Date(group.createdAt).toLocaleDateString(i18n.language, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const facts: [string, ReactNode][] = [
    [
      t('admin.groups.created'),
      <time
        key="created"
        dateTime={group.createdAt}
        title={fullDateTime(group.createdAt, i18n.language)}
      >
        {created}
      </time>,
    ],
    [
      t('admin.groups.creator'),
      group.creatorUsername ? (
        <Link
          key="creator"
          to="/@{$username}"
          params={{ username: group.creatorUsername }}
          className="hover:underline"
        >
          {group.creatorName || group.creatorUsername}
        </Link>
      ) : (
        '—'
      ),
    ],
    [
      t('admin.groups.members'),
      group.remoteMembers > 0
        ? t('admin.groups.membersSplit', {
            local: number.format(group.localMembers),
            remote: number.format(group.remoteMembers),
          })
        : number.format(group.localMembers),
    ],
    [t('admin.groups.requests'), number.format(group.requests)],
    [t('admin.groups.invitations'), number.format(group.invitations)],
    [t('admin.groups.posts'), number.format(group.posts)],
    [
      t('admin.groups.lastPost'),
      group.lastPostAt ? (
        <time
          key="last"
          dateTime={group.lastPostAt}
          title={fullDateTime(group.lastPostAt, i18n.language)}
        >
          {relativeTime(group.lastPostAt, i18n.language)}
        </time>
      ) : (
        t('admin.groups.never')
      ),
    ],
  ];
  return (
    <div className="space-y-2 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-start gap-3">
        <GroupAvatar group={group} size="sm" />
        <div className="min-w-0 flex-1">
          {group.privacy === 'secret' ? (
            // Secret groups stay closed to administrators too: only their members open them.
            <span className="block truncate font-medium">{group.name || group.handle}</span>
          ) : (
            <Link
              to="/groups/$handle"
              params={{ handle: group.handle }}
              className="block truncate rounded font-medium hover:underline focus-ring"
            >
              {group.name || group.handle}
            </Link>
          )}
          <span className="block truncate text-sm text-fg-muted">@{group.handle}</span>
        </div>
        <PrivacyLabel privacy={group.privacy} className="text-xs" />
      </div>
      {group.description && (
        <p className="line-clamp-2 text-sm text-fg-muted">{group.description}</p>
      )}
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
