import type { Account } from '@disbigle/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../api/errors.ts';
import { Avatar } from './Avatar.tsx';
import { GroupIcon } from './icons.tsx';
import { AccountLink, displayName } from './StatusCard.tsx';
import { Alert, LoadingState } from './ui.tsx';

/** A small "Group" tag next to a group's name among people. */
export function GroupBadge() {
  const { t } = useTranslation();
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
      <GroupIcon size={12} />
      {t('groups.badge')}
    </span>
  );
}

export function AccountRow({ account, actions }: { account: Account; actions?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-muted">
      <AccountLink
        account={account}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-ring"
      >
        <Avatar account={account} size="sm" />
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{displayName(account)}</span>
            {account.group && <GroupBadge />}
          </span>
          <span className="block truncate text-xs text-fg-muted">@{account.acct}</span>
        </span>
      </AccountLink>
      {actions}
    </div>
  );
}

export function AccountList({
  query,
  empty,
}: {
  query: UseQueryResult<Account[]>;
  empty: ReactNode;
}) {
  const { t } = useTranslation();
  if (query.isPending) return <LoadingState label={t('common.loading')} />;
  if (query.isError) return <Alert>{errorMessage(query.error)}</Alert>;
  if (query.data.length === 0)
    return <p className="px-2 py-6 text-center text-sm text-fg-muted">{empty}</p>;
  return (
    <ul>
      {query.data.map((account) => (
        <li key={account.id}>
          <AccountRow account={account} />
        </li>
      ))}
    </ul>
  );
}
