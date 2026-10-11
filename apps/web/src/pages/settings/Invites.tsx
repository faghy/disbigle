import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../api/errors.ts';
import { type Invite, inviteActive, inviteKeys, invites } from '../../api/invites.ts';
import { useInstance } from '../../api/queries.ts';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { Alert, Button, Card, cx, LoadingState, PageTitle } from '../../components/ui.tsx';
import { fullDateTime, relativeTime } from '../../lib/time.ts';

const useOptions = [1, 5, 10, 25, 50, 100, null] as const;
const expiryOptions = [
  { seconds: 3600, key: 'h1' },
  { seconds: 21_600, key: 'h6' },
  { seconds: 86_400, key: 'd1' },
  { seconds: 604_800, key: 'd7' },
  { seconds: 2_592_000, key: 'd30' },
  { seconds: null, key: 'never' },
] as const;

export function InvitesPage() {
  const { t } = useTranslation();
  const instance = useInstance();
  const list = useQuery({ queryKey: inviteKeys.all, queryFn: invites.list });

  return (
    <>
      <PageTitle description={t('invites.description', { domain: instance.data?.domain ?? '' })}>
        {t('invites.title')}
      </PageTitle>
      <div className="space-y-6">
        <CreateInvite />
        <section aria-labelledby="invites-list" className="space-y-3">
          <h2 id="invites-list" className="font-semibold">
            {t('invites.yourLinks')}
          </h2>
          {list.isPending ? (
            <LoadingState label={t('common.loading')} />
          ) : list.isError ? (
            <Alert>{errorMessage(list.error)}</Alert>
          ) : list.data.length === 0 ? (
            <Card className="text-center text-sm text-fg-muted">{t('invites.empty')}</Card>
          ) : (
            <ul className="space-y-3">
              {list.data.map((invite) => (
                <li key={invite.id}>
                  <InviteItem invite={invite} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function CreateInvite() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const ids = { uses: useId(), expiry: useId() };
  const [maxUses, setMaxUses] = useState<string>('1');
  const [expiresIn, setExpiresIn] = useState<string>('604800');

  const create = useMutation({
    mutationFn: invites.create,
    onSuccess: (invite) =>
      queryClient.setQueryData<Invite[]>(inviteKeys.all, (list) => [invite, ...(list ?? [])]),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({
      maxUses: maxUses === 'unlimited' ? null : Number(maxUses),
      expiresIn: expiresIn === 'never' ? null : Number(expiresIn),
    });
  };

  return (
    <Card>
      <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <label htmlFor={ids.uses} className="block text-sm font-medium">
            {t('invites.maxUses')}
          </label>
          <select
            id={ids.uses}
            className="input-base"
            value={maxUses}
            onChange={(event) => setMaxUses(event.target.value)}
          >
            {useOptions.map((value) => (
              <option key={String(value)} value={value === null ? 'unlimited' : String(value)}>
                {value === null ? t('invites.unlimited') : t('invites.uses', { count: value })}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 space-y-1.5">
          <label htmlFor={ids.expiry} className="block text-sm font-medium">
            {t('invites.expiresIn')}
          </label>
          <select
            id={ids.expiry}
            className="input-base"
            value={expiresIn}
            onChange={(event) => setExpiresIn(event.target.value)}
          >
            {expiryOptions.map((option) => (
              <option
                key={option.key}
                value={option.seconds === null ? 'never' : String(option.seconds)}
              >
                {t(`invites.expiry.${option.key}`)}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" loading={create.isPending}>
          {t('invites.create')}
        </Button>
      </form>
      <div className="mt-3">
        <Alert>{create.error ? errorMessage(create.error) : null}</Alert>
        <Alert tone="success">{create.isSuccess ? t('invites.created') : null}</Alert>
      </div>
    </Card>
  );
}

function InviteItem({ invite }: { invite: Invite }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const inputId = useId();
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const active = inviteActive(invite);
  const expired = invite.expiresAt !== null && new Date(invite.expiresAt).getTime() <= Date.now();

  const remove = useMutation({
    mutationFn: () => invites.remove(invite.id),
    onSuccess: () => {
      setConfirming(false);
      queryClient.setQueryData<Invite[]>(inviteKeys.all, (list) =>
        list?.filter((item) => item.id !== invite.id),
      );
    },
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card className={cx('space-y-3 p-4', !active && 'opacity-75')}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor={inputId} className="sr-only">
          {t('invites.link')}
        </label>
        <input
          id={inputId}
          readOnly
          value={invite.url}
          onFocus={(event) => event.currentTarget.select()}
          className="input-base font-mono text-sm"
        />
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={copy} disabled={!active}>
            {copied ? t('invites.copied') : t('invites.copy')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setConfirming(true)}
            aria-label={t('invites.deleteLabel', { code: invite.code })}
          >
            {t('invites.delete')}
          </Button>
        </div>
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-fg-muted">
        <span>
          {invite.maxUses === null
            ? t('invites.usedUnlimited', { count: invite.uses })
            : t('invites.used', { count: invite.uses, max: invite.maxUses })}
        </span>
        <span aria-hidden="true">·</span>
        {invite.expiresAt ? (
          <time dateTime={invite.expiresAt} title={fullDateTime(invite.expiresAt, i18n.language)}>
            {expired
              ? t('invites.expired')
              : t('invites.expires', { time: relativeTime(invite.expiresAt, i18n.language) })}
          </time>
        ) : (
          <span>{t('invites.neverExpires')}</span>
        )}
        {!active && (
          <span className="rounded-full bg-surface-muted px-2 text-xs font-medium">
            {t('invites.inactive')}
          </span>
        )}
      </p>
      {confirming && (
        <ConfirmDialog
          title={t('invites.deleteTitle')}
          description={
            remove.error ? (
              <span className="text-danger">{errorMessage(remove.error)}</span>
            ) : (
              t('invites.deleteDescription')
            )
          }
          confirmLabel={t('invites.delete')}
          pending={remove.isPending}
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
