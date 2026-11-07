import { type AccountImportKind, accountImportKinds } from '@disbigle/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../api/endpoints.ts';
import { errorMessage } from '../../api/errors.ts';
import { queryKeys, useCurrentUser, useInstance } from '../../api/queries.ts';
import { Alert, Button, Card, CheckboxField, PageTitle, TextField } from '../../components/ui.tsx';
import { type DiasporaSummary, readDiasporaExport } from '../../lib/diasporaExport.ts';
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

        <ImportLists />
        <DiasporaImport />
      </div>
    </>
  );
}

/** Step 3: lists exported from the old server (CSV) — people to follow, block or mute. */
function ImportLists() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<AccountImportKind>('following');
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const ids = { kind: useId(), file: useId() };
  const list = useQuery({
    queryKey: ['account-imports'],
    queryFn: endpoints.accountImports,
    // Worked through in the background: watch it while something is still running.
    refetchInterval: (query) => (query.state.data?.some((item) => !item.finishedAt) ? 5000 : false),
  });
  const upload = useMutation({
    mutationFn: async () => endpoints.importAccounts(kind, await (file as File).text()),
    onSuccess: () => {
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      void queryClient.invalidateQueries({ queryKey: ['account-imports'] });
    },
  });
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (file) upload.mutate();
  };
  return (
    <Card>
      <h2 className="font-semibold">{t('move.settings.step3')}</h2>
      <p className="mt-1 text-sm text-fg-muted">{t('move.imports.help')}</p>
      <form onSubmit={onSubmit} className="mt-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor={ids.kind} className="block text-sm font-medium">
            {t('move.imports.kind')}
          </label>
          <select
            id={ids.kind}
            value={kind}
            onChange={(event) => setKind(event.target.value as AccountImportKind)}
            className="rounded-lg border border-border bg-surface py-2 pr-8 pl-3 text-sm focus-ring"
          >
            {accountImportKinds.map((value) => (
              <option key={value} value={value}>
                {t(`move.imports.kinds.${value}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-60 flex-1 space-y-1">
          <label htmlFor={ids.file} className="block text-sm font-medium">
            {t('move.imports.file')}
          </label>
          <input
            id={ids.file}
            ref={fileInput}
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-surface-muted file:px-3 file:py-2 file:text-sm"
          />
        </div>
        <Button type="submit" loading={upload.isPending} disabled={!file}>
          {t('move.imports.start')}
        </Button>
      </form>
      {upload.isError && <Alert className="mt-3">{errorMessage(upload.error)}</Alert>}
      {(list.data ?? []).length > 0 && (
        <ul className="mt-4 space-y-3" aria-label={t('move.imports.list')}>
          {(list.data ?? []).map((item) => {
            const handled = item.done + item.failedCount;
            return (
              <li key={item.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{t(`move.imports.kinds.${item.kind}`)}</span>
                  <span className="text-fg-muted">
                    {item.finishedAt
                      ? t('move.imports.finished', {
                          done: item.done,
                          failed: item.failedCount,
                        })
                      : t('move.imports.progress', { handled, total: item.total })}
                    {' · '}
                    {new Date(item.createdAt).toLocaleDateString(i18n.language)}
                  </span>
                </div>
                {!item.finishedAt && (
                  <progress
                    className="mt-2 h-1.5 w-full accent-accent"
                    value={handled}
                    max={item.total}
                  />
                )}
                {item.failed.length > 0 && (
                  <details className="mt-1 text-fg-muted">
                    <summary className="cursor-pointer">{t('move.imports.notFound')}</summary>
                    <p className="mt-1 break-words">{item.failed.join(', ')}</p>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** From diaspora*: its export, read here in the browser, brings profile, aspects and contacts. */
function DiasporaImport() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const id = useId();
  const [summary, setSummary] = useState<DiasporaSummary | null>(null);
  const [readError, setReadError] = useState(false);
  const [useProfile, setUseProfile] = useState(true);
  const send = useMutation({
    mutationFn: () => {
      const data = summary as DiasporaSummary;
      return endpoints.importDiaspora({
        aspects: data.aspects,
        contacts: data.contacts,
        tags: data.tags,
        blocks: data.blocks,
        ...(useProfile && data.displayName ? { displayName: data.displayName } : {}),
        ...(useProfile && data.bio ? { bio: data.bio } : {}),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['account-imports'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: ['aspects'] });
    },
  });
  const onFile = async (file: File | undefined) => {
    setSummary(null);
    setReadError(false);
    send.reset();
    if (!file) return;
    try {
      setSummary(await readDiasporaExport(file));
    } catch {
      setReadError(true);
    }
  };
  return (
    <Card>
      <h2 className="font-semibold">{t('move.diaspora.title')}</h2>
      <p className="mt-1 text-sm text-fg-muted">{t('move.diaspora.help')}</p>
      <div className="mt-4 space-y-1">
        <label htmlFor={id} className="block text-sm font-medium">
          {t('move.diaspora.file')}
        </label>
        <input
          id={id}
          type="file"
          accept=".json,.gz,application/json,application/gzip"
          onChange={(event) => void onFile(event.target.files?.[0])}
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-surface-muted file:px-3 file:py-2 file:text-sm"
        />
      </div>
      {readError && <Alert className="mt-3">{t('move.diaspora.unreadable')}</Alert>}
      {summary && !send.isSuccess && (
        <div className="mt-4 space-y-3 text-sm">
          <p>
            {t('move.diaspora.found', {
              contacts: summary.contacts.length,
              aspects: summary.aspects.length,
              tags: summary.tags.length,
              blocks: summary.blocks.length,
            })}
          </p>
          {(summary.displayName || summary.bio) && (
            <CheckboxField
              label={t('move.diaspora.useProfile', { name: summary.displayName || '—' })}
              checked={useProfile}
              onChange={(event) => setUseProfile(event.target.checked)}
            />
          )}
          <p className="text-fg-muted">{t('move.diaspora.notIncluded')}</p>
          <Button loading={send.isPending} onClick={() => send.mutate()}>
            {t('move.diaspora.start')}
          </Button>
        </div>
      )}
      {send.isError && <Alert className="mt-3">{errorMessage(send.error)}</Alert>}
      {send.isSuccess && (
        <Alert tone="success" className="mt-3">
          {t('move.diaspora.done')}
        </Alert>
      )}
    </Card>
  );
}
