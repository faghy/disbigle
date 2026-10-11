import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  admin,
  adminKeys,
  type DomainBlock,
  type DomainBlockSeverity,
  isAdmin,
} from '../../api/admin.ts';
import { errorMessage, fieldErrorsFrom } from '../../api/errors.ts';
import { useCurrentUser } from '../../api/queries.ts';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { Alert, Button, Card, cx, LoadingState, TextField } from '../../components/ui.tsx';

const severities: DomainBlockSeverity[] = ['silence', 'suspend'];

export function DomainBlocksPage() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const blocks = useQuery({ queryKey: adminKeys.domainBlocks, queryFn: admin.domainBlocks });
  const canEdit = isAdmin(user);

  return (
    <section aria-labelledby="domains-title" className="space-y-4">
      <h2 id="domains-title" className="sr-only">
        {t('admin.tabs.domains')}
      </h2>
      <Card className="space-y-2 p-4 text-sm">
        {severities.map((severity) => (
          <p key={severity}>
            <SeverityBadge severity={severity} />{' '}
            <span className="text-fg-muted">{t(`admin.domains.severity.${severity}.explain`)}</span>
          </p>
        ))}
      </Card>
      {canEdit ? (
        <AddDomainBlock />
      ) : (
        <p className="text-sm text-fg-muted">{t('admin.domains.adminOnly')}</p>
      )}
      {blocks.isPending ? (
        <LoadingState label={t('common.loading')} />
      ) : blocks.isError ? (
        <Alert>{errorMessage(blocks.error)}</Alert>
      ) : blocks.data.length === 0 ? (
        <Card className="text-center text-fg-muted">{t('admin.domains.empty')}</Card>
      ) : (
        <ul className="space-y-2">
          {blocks.data.map((block) => (
            <li key={block.id}>
              <DomainBlockItem block={block} canEdit={canEdit} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SeverityBadge({ severity }: { severity: DomainBlockSeverity }) {
  const { t } = useTranslation();
  return (
    <span
      className={cx(
        'rounded-full px-2 py-0.5 text-xs font-semibold',
        severity === 'suspend' ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent',
      )}
    >
      {t(`admin.domains.severity.${severity}.label`)}
    </span>
  );
}

function AddDomainBlock() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const group = useId();
  // The Federation tab links here with ?domain= to block a server quickly.
  const { domain: prefill } = useSearch({ from: '/admin/domains' });
  const [domain, setDomain] = useState(prefill ?? '');
  const [severity, setSeverity] = useState<DomainBlockSeverity>('silence');
  const [publicComment, setPublicComment] = useState('');
  const [privateComment, setPrivateComment] = useState('');
  const [missing, setMissing] = useState(false);

  const add = useMutation({
    mutationFn: admin.blockDomain,
    onSuccess: () => {
      setDomain('');
      setPublicComment('');
      setPrivateComment('');
      void queryClient.invalidateQueries({ queryKey: adminKeys.domainBlocks });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'accounts'] });
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const value = domain.trim();
    setMissing(!value);
    if (value) add.mutate({ domain: value, severity, publicComment, privateComment });
  };
  const domainError = missing ? t('validation.required') : fieldErrorsFrom(add.error).domain;

  return (
    <Card>
      <h3 className="font-semibold">{t('admin.domains.addTitle')}</h3>
      <form onSubmit={onSubmit} noValidate className="mt-3 space-y-4">
        <TextField
          label={t('admin.domains.domain')}
          autoFocus={Boolean(prefill)}
          placeholder="spam.example"
          autoCapitalize="none"
          spellCheck={false}
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          error={domainError}
        />
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('admin.domains.severityLegend')}</legend>
          {severities.map((value) => (
            <label
              key={value}
              className={cx(
                'flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5',
                severity === value ? 'border-accent/60 bg-accent-soft/50' : 'border-border',
              )}
            >
              <input
                type="radio"
                name={group}
                value={value}
                checked={severity === value}
                onChange={() => setSeverity(value)}
                className="mt-1 size-4 accent-accent"
              />
              <span>
                <span className="block text-sm font-medium">
                  {t(`admin.domains.severity.${value}.label`)}
                </span>
                <span className="block text-xs text-fg-muted">
                  {t(`admin.domains.severity.${value}.explain`)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <TextField
          label={t('admin.domains.publicComment')}
          hint={t('admin.domains.publicHint')}
          maxLength={1000}
          value={publicComment}
          onChange={(event) => setPublicComment(event.target.value)}
        />
        <TextField
          label={t('admin.domains.privateComment')}
          hint={t('admin.domains.privateHint')}
          maxLength={1000}
          value={privateComment}
          onChange={(event) => setPrivateComment(event.target.value)}
        />
        <Alert>{add.error && !domainError ? errorMessage(add.error) : null}</Alert>
        <Alert tone="success">{add.isSuccess ? t('admin.domains.added') : null}</Alert>
        <Button type="submit" variant="danger" loading={add.isPending}>
          {t('admin.domains.add')}
        </Button>
      </form>
    </Card>
  );
}

function DomainBlockItem({ block, canEdit }: { block: DomainBlock; canEdit: boolean }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => admin.unblockDomain(block.domain),
    onSuccess: () => {
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: adminKeys.domainBlocks });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'accounts'] });
    },
  });
  return (
    <Card className="space-y-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-mono font-semibold break-all">{block.domain}</h3>
        <SeverityBadge severity={block.severity} />
        <span className="text-xs text-fg-muted">
          {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
            new Date(block.createdAt),
          )}
        </span>
        {canEdit && (
          <Button
            variant="ghost"
            className="ml-auto min-h-8 px-3 py-1 text-xs"
            onClick={() => setConfirming(true)}
            aria-label={t('admin.domains.removeLabel', { domain: block.domain })}
          >
            {t('admin.domains.remove')}
          </Button>
        )}
      </div>
      {block.publicComment && (
        <p className="text-sm">
          <span className="text-fg-muted">{t('admin.domains.publicComment')}:</span>{' '}
          {block.publicComment}
        </p>
      )}
      {block.privateComment && (
        <p className="text-sm">
          <span className="text-fg-muted">{t('admin.domains.privateComment')}:</span>{' '}
          {block.privateComment}
        </p>
      )}
      {confirming && (
        <ConfirmDialog
          title={t('admin.domains.removeTitle', { domain: block.domain })}
          description={
            remove.error ? (
              <span className="text-danger">{errorMessage(remove.error)}</span>
            ) : (
              t(`admin.domains.removeDescription.${block.severity}`)
            )
          }
          confirmLabel={t('admin.domains.remove')}
          pending={remove.isPending}
          danger={false}
          onCancel={() => {
            setConfirming(false);
            remove.reset();
          }}
          onConfirm={() => remove.mutate()}
        />
      )}
    </Card>
  );
}
