import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type AdminAccount,
  type AdminAccountFilter,
  admin,
  adminKeys,
  isAdmin,
  type Role,
} from '../../api/admin.ts';
import { errorMessage } from '../../api/errors.ts';
import { useCurrentUser } from '../../api/queries.ts';
import { AccountRow } from '../../components/AccountList.tsx';
import { Alert, Button, Card, LoadingState } from '../../components/ui.tsx';
import { SuspendDialog } from './SuspendDialog.tsx';

const roles: Role[] = ['user', 'moderator', 'admin'];

export function AccountsPage() {
  const { t } = useTranslation();
  const ids = { q: useId(), origin: useId(), status: useId() };
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<AdminAccountFilter>({});

  // Search shortly after typing stops.
  useEffect(() => {
    const timer = setTimeout(
      () => setFilter((current) => ({ ...current, q: text.trim() || undefined })),
      300,
    );
    return () => clearTimeout(timer);
  }, [text]);

  const accounts = useQuery({
    queryKey: adminKeys.accounts(filter),
    queryFn: () => admin.accounts(filter),
    placeholderData: (previous) => previous,
  });

  return (
    <section aria-labelledby="accounts-title" className="space-y-3">
      <h2 id="accounts-title" className="sr-only">
        {t('admin.tabs.accounts')}
      </h2>
      <Card className="grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto]">
        <div className="space-y-1">
          <label htmlFor={ids.q} className="block text-xs font-medium text-fg-muted">
            {t('admin.accounts.search')}
          </label>
          <input
            id={ids.q}
            type="search"
            className="input-base"
            value={text}
            placeholder={t('admin.accounts.searchPlaceholder')}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.origin} className="block text-xs font-medium text-fg-muted">
            {t('admin.accounts.origin')}
          </label>
          <select
            id={ids.origin}
            className="input-base"
            value={filter.origin ?? ''}
            onChange={(event) =>
              setFilter((f) => ({
                ...f,
                origin: (event.target.value || undefined) as AdminAccountFilter['origin'],
              }))
            }
          >
            <option value="">{t('admin.accounts.all')}</option>
            <option value="local">{t('admin.accounts.local')}</option>
            <option value="remote">{t('admin.accounts.remote')}</option>
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.status} className="block text-xs font-medium text-fg-muted">
            {t('admin.accounts.status')}
          </label>
          <select
            id={ids.status}
            className="input-base"
            value={filter.status ?? ''}
            onChange={(event) =>
              setFilter((f) => ({
                ...f,
                status: (event.target.value || undefined) as AdminAccountFilter['status'],
              }))
            }
          >
            <option value="">{t('admin.accounts.all')}</option>
            <option value="active">{t('admin.accounts.active')}</option>
            <option value="suspended">{t('admin.accounts.suspended')}</option>
          </select>
        </div>
      </Card>

      {accounts.isPending ? (
        <LoadingState label={t('common.loading')} />
      ) : accounts.isError ? (
        <Alert>{errorMessage(accounts.error)}</Alert>
      ) : accounts.data.length === 0 ? (
        <Card className="text-center text-fg-muted">{t('admin.accounts.empty')}</Card>
      ) : (
        <ul className="space-y-2" aria-busy={accounts.isFetching}>
          {accounts.data.map((item) => (
            <li key={item.account.id}>
              <AccountItem item={item} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Tag({
  children,
  tone = 'muted',
}: {
  children: string;
  tone?: 'muted' | 'danger' | 'accent';
}) {
  const tones = {
    muted: 'bg-surface-muted text-fg-muted',
    danger: 'bg-danger-soft text-danger',
    accent: 'bg-accent-soft text-accent',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

function AccountItem({ item }: { item: AdminAccount }) {
  const { t } = useTranslation();
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const roleId = useId();
  const [suspending, setSuspending] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const { account, user } = item;
  const isSelf = me?.account.id === account.id;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'accounts'] });
  };

  const suspend = useMutation({
    mutationFn: (reason: string) => admin.suspend(account.id, reason),
    onSuccess: () => {
      setSuspending(false);
      refresh();
    },
  });
  const unsuspend = useMutation({
    mutationFn: () => admin.unsuspend(account.id),
    onSuccess: refresh,
  });
  const role = useMutation({
    mutationFn: (next: Role) => {
      if (!user) throw new Error('Not a local user');
      return admin.setRole(user.id, next);
    },
    onSuccess: (_result, next) => {
      setSaved(t('admin.accounts.roleSaved', { role: t(`admin.roles.${next}`) }));
      refresh();
    },
  });

  const error = suspend.error ?? unsuspend.error ?? role.error;
  return (
    <Card className="space-y-2 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <AccountRow account={account} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {item.suspended && <Tag tone="danger">{t('admin.accounts.suspended')}</Tag>}
          {item.domain && <Tag>{item.domain}</Tag>}
          {user && user.role !== 'user' && <Tag tone="accent">{t(`admin.roles.${user.role}`)}</Tag>}
          {user && !user.approved && <Tag>{t('admin.accounts.awaitingApproval')}</Tag>}
        </div>
      </div>
      {user && <p className="px-2 text-xs text-fg-muted">{user.email}</p>}
      <div className="flex flex-wrap items-end gap-2 px-2">
        {item.suspended ? (
          <Button
            variant="secondary"
            loading={unsuspend.isPending}
            onClick={() => unsuspend.mutate()}
          >
            {t('admin.accounts.unsuspend')}
          </Button>
        ) : (
          !isSelf &&
          user?.role !== 'admin' && (
            <Button variant="danger" onClick={() => setSuspending(true)}>
              {t('admin.accounts.suspend')}
            </Button>
          )
        )}
        {isAdmin(me) && user && !isSelf && (
          <div className="flex items-center gap-2">
            <label htmlFor={roleId} className="text-sm text-fg-muted">
              {t('admin.accounts.role')}
            </label>
            <select
              id={roleId}
              className="input-base w-auto py-1.5"
              value={user.role}
              disabled={role.isPending}
              onChange={(event) => role.mutate(event.target.value as Role)}
            >
              {roles.map((value) => (
                <option key={value} value={value}>
                  {t(`admin.roles.${value}`)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <p role="status" className="px-2 text-xs text-success empty:hidden">
        {saved}
      </p>
      <Alert>{error ? errorMessage(error) : null}</Alert>
      {suspending && (
        <SuspendDialog
          account={account}
          pending={suspend.isPending}
          error={suspend.error}
          onConfirm={(reason) => suspend.mutate(reason)}
          onClose={() => {
            setSuspending(false);
            suspend.reset();
          }}
        />
      )}
    </Card>
  );
}
