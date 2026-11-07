import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../api/endpoints.ts';
import { errorMessage } from '../../api/errors.ts';
import { queryKeys, useCurrentUser, useInstance } from '../../api/queries.ts';
import { Alert, Button, Card, PageTitle, TextField } from '../../components/ui.tsx';
import { moveInfoUrl } from '../Register.tsx';

/** The server part of `name@server`. */
const domainOf = (address: string) => address.replace(/^@/, '').split('@')[1] ?? '';

/**
 * Moving an account here from Mastodon and the like: link the old address (so the old server
 * accepts the move), then start the move over there; followers come on their own.
 */
export function MoveSettingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const instance = useInstance();
  const aliases = user?.aliases ?? [];
  const [address, setAddress] = useState(() =>
    user?.moveFrom && !aliases.includes(user.moveFrom) ? user.moveFrom : '',
  );
  const save = useMutation({
    mutationFn: (accounts: string[]) => endpoints.setAliases(accounts),
    onSuccess: () => {
      setAddress('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
  if (!user) return null;
  const myAddress = `${user.account.username}@${instance.data?.domain ?? ''}`;

  const onLink = (event: FormEvent) => {
    event.preventDefault();
    const value = address.trim().replace(/^@/, '');
    if (!value || aliases.includes(value)) return;
    save.mutate([...aliases, value]);
  };

  return (
    <>
      <PageTitle description={t('move.settings.description')}>{t('move.settings.title')}</PageTitle>
      <div className="space-y-6">
        <Alert tone="info">
          {t('move.settings.risk')}{' '}
          <a
            href={moveInfoUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline focus-ring"
          >
            {t('move.register.infoLink')}
          </a>
        </Alert>

        <Card>
          <h2 className="font-semibold">{t('move.settings.step1')}</h2>
          <p className="mt-1 text-sm text-fg-muted">{t('move.settings.step1Help')}</p>
          {aliases.length > 0 && (
            <ul className="mt-3 space-y-2" aria-label={t('move.settings.linked')}>
              {aliases.map((alias) => (
                <li
                  key={alias}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <span className="truncate font-medium">{alias}</span>
                  <Button
                    variant="secondary"
                    loading={save.isPending}
                    onClick={() => save.mutate(aliases.filter((a) => a !== alias))}
                  >
                    {t('move.settings.unlink')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={onLink} className="mt-4 flex flex-wrap items-end gap-3">
            <div className="min-w-60 flex-1">
              <TextField
                label={t('move.register.from')}
                name="alias"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="nome@mastodon.example"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
            </div>
            <Button type="submit" loading={save.isPending} disabled={!address.trim()}>
              {t('move.settings.link')}
            </Button>
          </form>
          {save.isError && <Alert className="mt-3">{errorMessage(save.error)}</Alert>}
        </Card>

        <Card>
          <h2 className="font-semibold">{t('move.settings.step2')}</h2>
          <p className="mt-1 text-sm text-fg-muted">
            {t('move.settings.step2Help', { address: myAddress })}
          </p>
          <p className="mt-3 rounded-lg bg-surface-muted px-3 py-2 font-mono text-sm select-all">
            {myAddress}
          </p>
          {aliases.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm">
              {aliases.filter(domainOf).map((alias) => (
                <li key={alias}>
                  <a
                    href={`https://${domainOf(alias)}/settings/migration`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-accent hover:underline focus-ring"
                  >
                    {t('move.settings.openOld', { domain: domainOf(alias) })}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-fg-muted">{t('move.settings.linkFirst')}</p>
          )}
          <p className="mt-3 text-sm text-fg-muted">{t('move.settings.otherSoftware')}</p>
        </Card>

        <Card>
          <h2 className="font-semibold">{t('move.settings.step3')}</h2>
          <p className="mt-1 text-sm text-fg-muted">{t('move.settings.step3Help')}</p>
        </Card>
      </div>
    </>
  );
}
