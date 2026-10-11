import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type AuthorizedApp, appKeys, authorizedApps, groupScopes } from '../../api/apps.ts';
import { errorMessage } from '../../api/errors.ts';
import { useInstance } from '../../api/queries.ts';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { Alert, Button, Card, cx, LoadingState, PageTitle } from '../../components/ui.tsx';
import { fullDateTime, relativeTime } from '../../lib/time.ts';

const knownScopes = ['read', 'write', 'follow', 'push', 'admin'];

export function AuthorizedAppsPage() {
  const { t } = useTranslation();
  const instance = useInstance();
  const apps = useQuery({ queryKey: appKeys.all, queryFn: authorizedApps.list });

  return (
    <>
      <PageTitle description={t('apps.description', { domain: instance.data?.domain ?? '' })}>
        {t('apps.title')}
      </PageTitle>
      {apps.isPending ? (
        <LoadingState label={t('common.loading')} />
      ) : apps.isError ? (
        <Alert>{errorMessage(apps.error)}</Alert>
      ) : apps.data.length === 0 ? (
        <Card className="text-center text-sm text-fg-muted">{t('apps.empty')}</Card>
      ) : (
        <ul className="space-y-3" aria-label={t('apps.title')}>
          {apps.data.map((app) => (
            <li key={app.id}>
              <AppItem app={app} />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-sm text-fg-muted">{t('apps.passwordNote')}</p>
    </>
  );
}

function AppItem({ app }: { app: AuthorizedApp }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const name = app.name || t('apps.unnamed');
  const revoke = useMutation({
    mutationFn: () => authorizedApps.revoke(app.id),
    onSuccess: () => {
      setConfirming(false);
      queryClient.setQueryData<AuthorizedApp[]>(appKeys.all, (list) =>
        list?.filter((item) => item.id !== app.id),
      );
    },
  });
  const website = app.website && /^https?:\/\//.test(app.website) ? app.website : null;

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold break-words">{name}</h2>
          {website && (
            <a
              href={website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm break-all text-accent hover:underline"
            >
              {website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
            </a>
          )}
        </div>
        <Button
          variant="danger"
          onClick={() => setConfirming(true)}
          aria-label={t('apps.revokeLabel', { name })}
        >
          {t('apps.revoke')}
        </Button>
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label={t('apps.permissions')}>
        {groupScopes(app.scopes).map((group) => {
          const label = knownScopes.includes(group.name)
            ? t(`apps.scopes.${group.name}`)
            : group.name;
          return (
            <li
              key={group.name}
              title={group.full ? undefined : group.parts.join(', ')}
              className={cx(
                'rounded-full px-2.5 py-0.5 text-xs font-medium',
                group.name === 'write' || group.name === 'admin'
                  ? 'bg-danger-soft text-danger'
                  : 'bg-accent-soft text-accent',
              )}
            >
              {group.full ? label : t('apps.partial', { scope: label })}
              {!group.full && <span className="sr-only">: {group.parts.join(', ')}</span>}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-fg-muted">
        <time dateTime={app.createdAt} title={fullDateTime(app.createdAt, i18n.language)}>
          {t('apps.authorized', { time: relativeTime(app.createdAt, i18n.language) })}
        </time>
        {' · '}
        {app.lastUsedAt ? (
          <time dateTime={app.lastUsedAt} title={fullDateTime(app.lastUsedAt, i18n.language)}>
            {t('apps.lastUsed', { time: relativeTime(app.lastUsedAt, i18n.language) })}
          </time>
        ) : (
          t('apps.neverUsed')
        )}
      </p>
      {confirming && (
        <ConfirmDialog
          title={t('apps.revokeTitle', { name })}
          description={
            revoke.error ? (
              <span className="text-danger">{errorMessage(revoke.error)}</span>
            ) : (
              t('apps.revokeDescription', { name })
            )
          }
          confirmLabel={t('apps.revoke')}
          pending={revoke.isPending}
          onCancel={() => {
            setConfirming(false);
            revoke.reset();
          }}
          onConfirm={() => revoke.mutate()}
        />
      )}
    </Card>
  );
}
