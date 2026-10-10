import type { Account } from '@disbigle/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client.ts';
import { errorMessage } from '../api/errors.ts';
import { accountQueryOptions, useCurrentUser, useInstance } from '../api/queries.ts';
import { Avatar } from '../components/Avatar.tsx';
import { Alert, buttonClass, Card, LoadingState } from '../components/ui.tsx';
import { NotFoundPage } from './ErrorPages.tsx';

export function ProfilePage() {
  const { t } = useTranslation();
  const { username } = useParams({ from: '/@{$username}' });
  const account = useQuery(accountQueryOptions(username));

  if (account.isPending) return <LoadingState label={t('common.loading')} />;
  if (account.isError) {
    if (account.error instanceof ApiError && account.error.status === 404) {
      return <ProfileNotFound username={username} />;
    }
    return <Alert>{errorMessage(account.error)}</Alert>;
  }
  return <ProfileView account={account.data} />;
}

function ProfileNotFound({ username }: { username: string }) {
  const { t } = useTranslation();
  return (
    <div>
      <NotFoundPage />
      <p className="text-center text-sm text-fg-muted">{t('profile.notFound', { username })}</p>
    </div>
  );
}

export function ProfileView({ account }: { account: Account }) {
  const { t, i18n } = useTranslation();
  const instance = useInstance();
  const me = useCurrentUser();
  const isOwn = me?.account.id === account.id;
  const domain = instance.data?.domain;
  const handle = account.acct.includes('@') || !domain ? account.acct : `${account.acct}@${domain}`;
  const joined = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(
    new Date(account.createdAt),
  );

  return (
    <article className="space-y-6" aria-labelledby="profile-name">
      <Card as="div">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Avatar account={account} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 id="profile-name" className="text-2xl font-semibold tracking-tight break-words">
                {account.displayName || account.username}
              </h1>
              {account.bot && <Badge>{t('profile.bot')}</Badge>}
              {account.locked && <Badge>{t('profile.locked')}</Badge>}
            </div>
            <p className="break-all text-fg-muted">@{handle}</p>
            <p className="mt-1 text-sm text-fg-muted">{t('profile.joined', { date: joined })}</p>
          </div>
          {isOwn && (
            <Link to="/settings/profile" className={buttonClass('secondary', 'self-start')}>
              {t('profile.edit')}
            </Link>
          )}
        </div>

        {account.note && <p className="mt-5 whitespace-pre-wrap break-words">{account.note}</p>}

        {account.fields.length > 0 && (
          <dl className="mt-5 divide-y divide-border overflow-hidden rounded-xl border border-border">
            {account.fields.map((field, index) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: fields have no id and keep their order
                key={index}
                className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,10rem)_1fr] sm:gap-4"
              >
                <dt className="text-sm font-medium text-fg-muted break-words">{field.name}</dt>
                <dd className="break-words">{field.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
    </article>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded-full border border-border bg-surface-muted px-2 py-0.5 text-xs font-medium text-fg-muted">
      {children}
    </span>
  );
}
