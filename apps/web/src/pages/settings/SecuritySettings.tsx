import { type CurrentUser, mfaCodeRequestSchema, type Passkey } from '@disbigle/shared';
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../api/client.ts';
import { endpoints } from '../../api/endpoints.ts';
import { errorMessage } from '../../api/errors.ts';
import { passkeysQueryOptions, queryKeys, useCurrentUser } from '../../api/queries.ts';
import { Alert, Button, Card, LoadingState, PageTitle, TextField } from '../../components/ui.tsx';
import { downloadText } from '../../lib/forms.ts';
import i18n from '../../lib/i18n.ts';

export function SecuritySettingsPage() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  if (!user) return null;
  return (
    <>
      <PageTitle description={t('settings.security.description')}>
        {t('settings.security.title')}
      </PageTitle>
      <div className="space-y-6">
        <TwoFactorSection user={user} />
        <PasskeysSection />
      </div>
    </>
  );
}

/** Wrong password errors are shown on the password field rather than as a general error. */
function passwordError(error: unknown) {
  if (error instanceof ApiError && error.code === 'wrong_password')
    return i18n.t('errors.wrong_password');
  return undefined;
}

function useRefreshMe() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.me });
}

// ---------------------------------------------------------------------------------------------
// Two-factor authentication (TOTP) and recovery codes
// ---------------------------------------------------------------------------------------------

function TwoFactorSection({ user }: { user: CurrentUser }) {
  const { t } = useTranslation();
  const [codes, setCodes] = useState<string[] | null>(null);

  return (
    <Card aria-labelledby="totp-title" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="totp-title" className="font-semibold">
            {t('settings.security.totp.title')}
          </h2>
          <p className="text-sm text-fg-muted">{t('settings.security.totp.description')}</p>
        </div>
        <span
          className={
            user.totpEnabled
              ? 'rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success'
              : 'rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-fg-muted'
          }
        >
          {user.totpEnabled ? t('settings.security.totp.on') : t('settings.security.totp.off')}
        </span>
      </div>

      {codes ? (
        <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />
      ) : user.totpEnabled ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <RegenerateCodes onCodes={setCodes} />
          <DisableTotp />
        </div>
      ) : (
        <EnableTotp onCodes={setCodes} />
      )}
    </Card>
  );
}

function EnableTotp({ onCodes }: { onCodes: (codes: string[]) => void }) {
  const { t } = useTranslation();
  const refreshMe = useRefreshMe();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);

  const setup = useMutation({ mutationFn: endpoints.totpSetup });
  const confirm = useMutation({
    mutationFn: endpoints.totpConfirm,
    onSuccess: async ({ codes }) => {
      onCodes(codes);
      await refreshMe();
    },
  });

  if (!setup.data) {
    return (
      <div className="space-y-3">
        <Alert>{setup.error ? errorMessage(setup.error) : null}</Alert>
        <Button onClick={() => setup.mutate()} loading={setup.isPending}>
          {t('settings.security.totp.enable')}
        </Button>
      </div>
    );
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = mfaCodeRequestSchema.safeParse({ code: code.replace(/\s+/g, '') });
    if (!parsed.success) {
      confirm.reset();
      setCodeError(t('login.codeInvalid'));
      return;
    }
    setCodeError(null);
    confirm.mutate(parsed.data.code);
  };

  const invalidCode =
    confirm.error instanceof ApiError && confirm.error.code === 'invalid_mfa_code'
      ? errorMessage(confirm.error)
      : null;

  return (
    <div className="space-y-5">
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        <li>{t('settings.security.totp.step1')}</li>
        <li>{t('settings.security.totp.step2')}</li>
      </ol>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <img
          src={setup.data.qrCodeDataUrl}
          alt={t('settings.security.totp.qrAlt')}
          width={176}
          height={176}
          className="size-44 rounded-lg border border-border bg-white p-2"
        />
        <div className="min-w-0 space-y-1 text-sm">
          <p className="text-fg-muted">{t('settings.security.totp.manual')}</p>
          <code className="block rounded-lg bg-surface-muted px-3 py-2 font-mono break-all select-all">
            {setup.data.secret}
          </code>
        </div>
      </div>
      <form
        onSubmit={onSubmit}
        noValidate
        className="flex flex-col gap-3 sm:flex-row sm:items-start"
      >
        <div className="flex-1">
          <TextField
            label={t('settings.security.totp.code')}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={8}
            required
            className="font-mono tracking-[0.3em]"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            error={codeError ?? invalidCode ?? undefined}
          />
        </div>
        <Button type="submit" className="sm:mt-7" loading={confirm.isPending}>
          {t('settings.security.totp.confirm')}
        </Button>
      </form>
      <Alert>{confirm.error && !invalidCode ? errorMessage(confirm.error) : null}</Alert>
    </div>
  );
}

function PasswordForm({
  title,
  description,
  submitLabel,
  variant,
  onSubmit,
  pending,
  error,
}: {
  title: string;
  description: string;
  submitLabel: string;
  variant: 'secondary' | 'danger';
  onSubmit: (password: string) => void;
  pending: boolean;
  error: unknown;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [missing, setMissing] = useState(false);
  const fieldError = missing ? t('validation.required') : passwordError(error);
  return (
    <form
      noValidate
      className="space-y-3 rounded-xl border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setMissing(!password);
        if (password) onSubmit(password);
      }}
    >
      <h3 className="font-medium">{title}</h3>
      <p className="text-sm text-fg-muted">{description}</p>
      <TextField
        label={t('settings.security.password')}
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={fieldError}
      />
      <Alert>{error && !fieldError ? errorMessage(error) : null}</Alert>
      <Button type="submit" variant={variant} loading={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}

function RegenerateCodes({ onCodes }: { onCodes: (codes: string[]) => void }) {
  const { t } = useTranslation();
  const regenerate = useMutation({
    mutationFn: endpoints.regenerateRecoveryCodes,
    onSuccess: ({ codes }) => onCodes(codes),
  });
  return (
    <PasswordForm
      title={t('settings.security.recovery.title')}
      description={t('settings.security.recovery.description')}
      submitLabel={t('settings.security.recovery.regenerate')}
      variant="secondary"
      onSubmit={(password) => regenerate.mutate(password)}
      pending={regenerate.isPending}
      error={regenerate.error}
    />
  );
}

function DisableTotp() {
  const { t } = useTranslation();
  const refreshMe = useRefreshMe();
  const disable = useMutation({ mutationFn: endpoints.totpDisable, onSuccess: refreshMe });
  return (
    <PasswordForm
      title={t('settings.security.totp.disableTitle')}
      description={t('settings.security.totp.disableDescription')}
      submitLabel={t('settings.security.totp.disable')}
      variant="danger"
      onSubmit={(password) => disable.mutate(password)}
      pending={disable.isPending}
      error={disable.error}
    />
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const text = `${codes.join('\n')}\n`;

  return (
    <div className="space-y-4 rounded-xl border border-accent/40 bg-accent-soft/40 p-4">
      <div role="status">
        <h3 className="font-semibold">{t('settings.security.recovery.saveTitle')}</h3>
        <p className="text-sm text-fg-muted">{t('settings.security.recovery.saveDescription')}</p>
      </div>
      <ul
        aria-label={t('settings.security.recovery.title')}
        className="grid grid-cols-1 gap-2 font-mono text-sm min-[400px]:grid-cols-2"
      >
        {codes.map((code) => (
          <li key={code} className="rounded-md bg-surface px-3 py-1.5 select-all">
            {code}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? t('settings.security.recovery.copied') : t('settings.security.recovery.copy')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => downloadText('disbigle-recovery-codes.txt', text)}
        >
          {t('settings.security.recovery.download')}
        </Button>
        <Button onClick={onDone}>{t('settings.security.recovery.done')}</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Passkeys
// ---------------------------------------------------------------------------------------------

function PasskeysSection() {
  const { t } = useTranslation();
  const passkeys = useQuery(passkeysQueryOptions);
  const supported = browserSupportsWebAuthn();

  return (
    <Card aria-labelledby="passkeys-title" className="space-y-4">
      <div>
        <h2 id="passkeys-title" className="font-semibold">
          {t('settings.security.passkeys.title')}
        </h2>
        <p className="text-sm text-fg-muted">{t('settings.security.passkeys.description')}</p>
      </div>

      {passkeys.isPending ? (
        <LoadingState label={t('common.loading')} />
      ) : passkeys.isError ? (
        <Alert>{errorMessage(passkeys.error)}</Alert>
      ) : passkeys.data.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('settings.security.passkeys.empty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {passkeys.data.map((passkey) => (
            <PasskeyRow key={passkey.id} passkey={passkey} />
          ))}
        </ul>
      )}

      {supported ? (
        <AddPasskey />
      ) : (
        <p className="text-sm text-fg-muted">{t('errors.webauthn_unsupported')}</p>
      )}
    </Card>
  );
}

function PasskeyRow({ passkey }: { passkey: Passkey }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const format = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );

  const remove = useMutation({
    mutationFn: () => endpoints.deletePasskey(passkey.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.passkeys }),
        queryClient.invalidateQueries({ queryKey: queryKeys.me }),
      ]);
    },
  });

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate font-medium">{passkey.name}</p>
        <p className="text-sm text-fg-muted">
          {t('settings.security.passkeys.created', { date: format(passkey.createdAt) })}
          {' · '}
          {passkey.lastUsedAt
            ? t('settings.security.passkeys.lastUsed', { date: format(passkey.lastUsedAt) })
            : t('settings.security.passkeys.neverUsed')}
        </p>
        <Alert className="mt-2">{remove.error ? errorMessage(remove.error) : null}</Alert>
      </div>
      {confirming ? (
        <div className="flex shrink-0 gap-2">
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() => remove.mutate()}
            aria-label={t('settings.security.passkeys.confirmDeleteLabel', { name: passkey.name })}
          >
            {t('settings.security.passkeys.confirmDelete')}
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      ) : (
        <Button
          variant="secondary"
          className="shrink-0"
          onClick={() => setConfirming(true)}
          aria-label={t('settings.security.passkeys.deleteLabel', { name: passkey.name })}
        >
          {t('settings.security.passkeys.delete')}
        </Button>
      )}
    </li>
  );
}

function AddPasskey() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  const add = useMutation({
    mutationFn: async (passkeyName: string) => {
      const optionsJSON = await endpoints.passkeyRegistrationOptions();
      const response = await startRegistration({ optionsJSON });
      return endpoints.addPasskey(passkeyName, response);
    },
    onSuccess: async () => {
      setName('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.passkeys }),
        queryClient.invalidateQueries({ queryKey: queryKeys.me }),
      ]);
    },
  });

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate(name.trim());
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex-1">
          <TextField
            label={t('settings.security.passkeys.name')}
            hint={t('settings.security.passkeys.nameHint')}
            maxLength={100}
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <Button type="submit" className="sm:mt-7" loading={add.isPending}>
          {t('settings.security.passkeys.add')}
        </Button>
      </div>
      <Alert>{add.error ? errorMessage(add.error) : null}</Alert>
      <Alert tone="success">{add.isSuccess ? t('settings.security.passkeys.added') : null}</Alert>
    </form>
  );
}
