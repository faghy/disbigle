import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { admin, adminKeys, isAdmin, type KnownInstance } from '../../api/admin.ts';
import { errorMessage } from '../../api/errors.ts';
import { useCurrentUser } from '../../api/queries.ts';
import { ServerIcon } from '../../components/icons.tsx';
import { Alert, buttonClass, Card, cx, LoadingState } from '../../components/ui.tsx';
import { fullDateTime, relativeTime } from '../../lib/time.ts';

export function FederationPage() {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);

  const instances = useQuery({
    queryKey: adminKeys.instances(query),
    queryFn: () => admin.instances(query),
    placeholderData: (previous) => previous,
  });

  return (
    <section aria-labelledby="federation-title" className="space-y-3">
      <h2 id="federation-title" className="sr-only">
        {t('admin.tabs.federation')}
      </h2>
      <p className="text-sm text-fg-muted">{t('admin.federation.description')}</p>
      <Card className="p-4">
        <label htmlFor={id} className="mb-1 block text-xs font-medium text-fg-muted">
          {t('admin.federation.search')}
        </label>
        <input
          id={id}
          type="search"
          className="input-base"
          placeholder="mastodon.social"
          autoCapitalize="none"
          spellCheck={false}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </Card>
      {instances.isPending ? (
        <LoadingState label={t('common.loading')} />
      ) : instances.isError ? (
        <Alert>{errorMessage(instances.error)}</Alert>
      ) : instances.data.length === 0 ? (
        <Card className="text-center text-fg-muted">
          {query ? t('admin.federation.noMatch', { query }) : t('admin.federation.empty')}
        </Card>
      ) : (
        <ul className="space-y-2" aria-busy={instances.isFetching}>
          {instances.data.map((server) => (
            <li key={server.domain}>
              <InstanceItem server={server} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function InstanceItem({ server }: { server: KnownInstance }) {
  const { t, i18n } = useTranslation();
  const user = useCurrentUser();
  return (
    <Card className="flex flex-wrap items-center gap-3 p-4">
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-fg-muted">
        <ServerIcon size={20} />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`https://${server.domain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono font-semibold break-all hover:underline"
          >
            {server.domain}
          </a>
          {server.protocols.map((protocol) => (
            <span
              key={protocol}
              className={cx(
                'rounded-full px-2 py-0.5 text-xs font-medium',
                protocol === 'diaspora'
                  ? 'bg-success-soft text-success'
                  : 'bg-accent-soft text-accent',
              )}
            >
              {protocol === 'diaspora' ? 'diaspora*' : 'ActivityPub'}
            </span>
          ))}
          {server.block && (
            <span
              className={cx(
                'rounded-full px-2 py-0.5 text-xs font-semibold',
                server.block === 'suspend'
                  ? 'bg-danger-soft text-danger'
                  : 'bg-surface-muted text-fg-muted',
              )}
            >
              {t(`admin.federation.blocked.${server.block}`)}
            </span>
          )}
        </div>
        <p className="text-sm text-fg-muted">
          {t('admin.federation.accounts', { count: server.accounts })}
          {' · '}
          {t('admin.federation.followers', { count: server.followersOfLocalAccounts })}
          {server.lastSeenAt && (
            <>
              {' · '}
              <time
                dateTime={server.lastSeenAt}
                title={fullDateTime(server.lastSeenAt, i18n.language)}
              >
                {t('admin.federation.lastSeen', {
                  time: relativeTime(server.lastSeenAt, i18n.language),
                })}
              </time>
            </>
          )}
        </p>
      </div>
      {isAdmin(user) && (
        <Link
          to="/admin/domains"
          search={{ domain: server.domain }}
          className={buttonClass(
            server.block ? 'secondary' : 'danger',
            'min-h-9 px-3 py-1 text-xs',
          )}
          aria-label={
            server.block
              ? t('admin.federation.changeBlockLabel', { domain: server.domain })
              : t('admin.federation.blockLabel', { domain: server.domain })
          }
        >
          {server.block ? t('admin.federation.changeBlock') : t('admin.federation.block')}
        </Link>
      )}
    </Card>
  );
}
