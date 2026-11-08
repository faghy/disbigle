import type { PublicDomainBlock } from '@disbigle/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.ts';
import { errorMessage } from '../api/errors.ts';
import { useCurrentUser, useInstance } from '../api/queries.ts';
import { InstanceRules } from '../components/InstanceRules.tsx';
import { Alert, buttonClass, Card, LoadingState } from '../components/ui.tsx';

export const REPOSITORY_URL = 'https://github.com/faghy/disbigle';

export function AboutPage() {
  const { t } = useTranslation();
  const instance = useInstance();
  const user = useCurrentUser();

  if (instance.isPending) return <LoadingState label={t('common.loading')} />;
  if (instance.isError) return <Alert>{errorMessage(instance.error)}</Alert>;
  const info = instance.data;
  const rules = info.rules ?? [];
  const open = info.registrationMode !== 'closed';

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm text-fg-muted">{info.domain}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{info.title || 'Disbigle'}</h1>
        {info.description ? (
          <p className="mt-3 whitespace-pre-wrap break-words">{info.description}</p>
        ) : (
          <p className="mt-3 text-fg-muted">{t('landing.tagline')}</p>
        )}
        {!user && open && (
          <Link to="/register" className={buttonClass('primary', 'mt-5')}>
            {t('about.join')}
          </Link>
        )}
      </Card>

      <Card aria-labelledby="about-rules">
        <h2 id="about-rules" className="font-semibold">
          {t('about.rules')}
        </h2>
        {rules.length > 0 ? (
          <InstanceRules rules={rules} headingId="about-rules" className="mt-3" />
        ) : (
          <p className="mt-2 text-sm text-fg-muted">{t('about.noRules')}</p>
        )}
      </Card>

      <BlockedServers />

      <Card aria-labelledby="about-contact" className="space-y-3">
        <h2 id="about-contact" className="font-semibold">
          {t('about.contact')}
        </h2>
        {info.contactEmail ? (
          <p className="text-sm">
            {t('about.contactText')}{' '}
            <a
              href={`mailto:${info.contactEmail}`}
              className="font-medium text-accent hover:underline"
            >
              {info.contactEmail}
            </a>
          </p>
        ) : (
          <p className="text-sm text-fg-muted">{t('about.noContact')}</p>
        )}
        <p className="text-sm text-fg-muted">{t(`about.registration.${info.registrationMode}`)}</p>
      </Card>

      <p className="px-1 text-sm text-fg-muted">
        <a
          href={REPOSITORY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-accent hover:underline"
        >
          Disbigle
        </a>{' '}
        — {t('about.software')} · {t('about.version', { version: info.version })}
      </p>
    </div>
  );
}

/** Servers this one does not talk to, and why: public, for transparency. */
function BlockedServers() {
  const { t } = useTranslation();
  const blocks = useQuery({
    queryKey: ['instance', 'domain-blocks'],
    queryFn: () => api.get<PublicDomainBlock[]>('/instance/domain_blocks'),
  });
  const list = blocks.data ?? [];
  return (
    <Card aria-labelledby="about-blocked">
      <h2 id="about-blocked" className="font-semibold">
        {t('about.blocked.title')}
      </h2>
      <p className="mt-1 text-sm text-fg-muted">{t('about.blocked.intro')}</p>
      {blocks.isPending ? (
        <LoadingState label={t('common.loading')} />
      ) : list.length === 0 ? (
        <p className="mt-2 text-sm text-fg-muted">{t('about.blocked.none')}</p>
      ) : (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium">
            {t('about.blocked.show', { count: list.length })}
          </summary>
          <ul className="mt-2 divide-y divide-border text-sm">
            {list.map((block) => (
              <li
                key={block.domain}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5"
              >
                <span className="font-mono break-all">{block.domain}</span>
                <span className="text-xs text-fg-muted">
                  {t(`about.blocked.severity.${block.severity}`)}
                </span>
                {block.comment && (
                  <span className="w-full text-xs text-fg-muted">{block.comment}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
