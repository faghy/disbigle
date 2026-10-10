import { type LoginResponse, loginRequestSchema, mfaCodeRequestSchema } from '@disbigle/shared';
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client.ts';
import { endpoints } from '../api/endpoints.ts';
import {
  errorMessage,
  type FieldErrors,
  fieldErrorsFrom,
  isFieldError,
  issuesToFieldErrors,
} from '../api/errors.ts';
import { clearUserData, meQueryOptions } from '../api/queries.ts';
import { Alert, Button, Card, TextField } from '../components/ui.tsx';
import { useFocusFirstError } from '../lib/forms.ts';

type MfaMethod = NonNullable<LoginResponse['methods']>[number];

/** Signs in with a passkey; works passwordless and as a second factor (pending session). */
async function passkeySignIn() {
  const { challengeId, options } = await endpoints.passkeyAuthOptions();
  const response = await startAuthentication({ optionsJSON: options });
  await endpoints.passkeyAuthVerify(challengeId, response);
}

export function LoginPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [mfaMethods, setMfaMethods] = useState<MfaMethod[] | null>(null);
  const { reset } = useSearch({ from: '/login' });
  const [notice, setNotice] = useState<string | null>(
    reset === 'done' ? t('passwordReset.done') : null,
  );

  const finish = async () => {
    clearUserData(queryClient);
    await queryClient.fetchQuery({ ...meQueryOptions, staleTime: 0 });
    await navigate({ to: '/' });
  };

  return (
    <div className="mx-auto w-full max-w-md">
      <Card>
        {mfaMethods ? (
          <MfaStep
            methods={mfaMethods}
            onDone={finish}
            onRestart={(message) => {
              setNotice(message);
              setMfaMethods(null);
            }}
          />
        ) : (
          <CredentialsStep
            notice={notice}
            onMfaRequired={(methods) => {
              setNotice(null);
              setMfaMethods(methods);
            }}
            onDone={finish}
          />
        )}
      </Card>
      {!mfaMethods && (
        <p className="mt-6 text-center text-sm text-fg-muted">
          {t('login.noAccount')}{' '}
          <Link
            to="/register"
            className="rounded font-medium text-accent hover:underline focus-ring"
          >
            {t('login.createAccount')}
          </Link>
        </p>
      )}
    </div>
  );
}

function CredentialsStep({
  notice,
  onMfaRequired,
  onDone,
}: {
  notice: string | null;
  onMfaRequired: (methods: MfaMethod[]) => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const formRef = useRef<HTMLFormElement>(null);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});

  const signIn = useMutation({
    mutationFn: endpoints.login,
    onSuccess: async (result) => {
      if (result.status === 'mfa_required') onMfaRequired(result.methods ?? ['totp']);
      else await onDone();
    },
  });
  const passkey = useMutation({ mutationFn: passkeySignIn, onSuccess: onDone });

  const errors = { ...fieldErrorsFrom(signIn.error), ...clientErrors };
  useFocusFirstError(formRef, clientErrors);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    passkey.reset();
    const parsed = loginRequestSchema.safeParse({ login, password });
    if (!parsed.success) {
      signIn.reset();
      setClientErrors(issuesToFieldErrors(parsed.error.issues));
      return;
    }
    setClientErrors({});
    signIn.mutate(parsed.data);
  };

  const error = signIn.error ?? passkey.error;
  const generalError = error && !isFieldError(error) ? errorMessage(error) : null;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t('login.title')}</h1>
      <p className="mt-1 text-sm text-fg-muted">{t('login.subtitle')}</p>

      <div className="mt-6 space-y-4">
        <Alert tone="info">{notice}</Alert>
        <Alert>{generalError}</Alert>
        <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-4">
          <TextField
            label={t('login.login')}
            name="login"
            autoComplete="username webauthn"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            error={errors.login}
          />
          <TextField
            label={t('login.password')}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={errors.password}
          />
          <p className="-mt-2 text-right text-sm">
            <Link
              to="/forgot-password"
              className="rounded font-medium text-accent hover:underline focus-ring"
            >
              {t('login.forgot')}
            </Link>
          </p>
          <Button type="submit" className="w-full" loading={signIn.isPending}>
            {t('login.submit')}
          </Button>
        </form>

        {browserSupportsWebAuthn() && (
          <>
            <div className="flex items-center gap-3 text-xs text-fg-muted uppercase">
              <span className="h-px flex-1 bg-border" />
              {t('common.or')}
              <span className="h-px flex-1 bg-border" />
            </div>
            <Button
              variant="secondary"
              className="w-full"
              loading={passkey.isPending}
              onClick={() => {
                signIn.reset();
                passkey.mutate();
              }}
            >
              {t('login.passkey')}
            </Button>
          </>
        )}
      </div>
    </>
  );
}

function MfaStep({
  methods,
  onDone,
  onRestart,
}: {
  methods: MfaMethod[];
  onDone: () => Promise<void>;
  onRestart: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const formRef = useRef<HTMLFormElement>(null);
  const hasTotp = methods.includes('totp');
  const [mode, setMode] = useState<'totp' | 'recovery_code'>(hasTotp ? 'totp' : 'recovery_code');
  const [code, setCode] = useState('');
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});

  // The pending sign-in expired or ran out of attempts: start again from the password.
  const restartIfExpired = (error: unknown) => {
    if (!(error instanceof ApiError)) return;
    if (error.code === 'unauthorized') onRestart(t('login.mfaExpired'));
    else if (error.code === 'rate_limited' || error.code === 'too_many_attempts') {
      onRestart(errorMessage(error));
    }
  };

  const verify = useMutation({
    mutationFn: endpoints.mfa,
    onSuccess: onDone,
    onError: restartIfExpired,
  });
  const passkey = useMutation({
    mutationFn: passkeySignIn,
    onSuccess: onDone,
    onError: restartIfExpired,
  });

  const errors = { ...fieldErrorsFrom(verify.error), ...clientErrors };
  useFocusFirstError(formRef, clientErrors);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    passkey.reset();
    const parsed = mfaCodeRequestSchema.safeParse({ code: code.replace(/\s+/g, '') });
    if (!parsed.success) {
      verify.reset();
      setClientErrors({ code: t('login.codeInvalid') });
      return;
    }
    setClientErrors({});
    verify.mutate(parsed.data.code);
  };

  const switchMode = (next: 'totp' | 'recovery_code') => {
    setMode(next);
    setCode('');
    setClientErrors({});
    verify.reset();
  };

  const error = verify.error ?? passkey.error;
  const generalError = error && !isFieldError(error) ? errorMessage(error) : null;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t('login.mfaTitle')}</h1>
      <p className="mt-1 text-sm text-fg-muted">
        {mode === 'totp' ? t('login.mfaTotpHelp') : t('login.mfaRecoveryHelp')}
      </p>

      <div className="mt-6 space-y-4">
        <Alert>{generalError}</Alert>
        <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-4">
          {mode === 'totp' ? (
            <TextField
              key="totp"
              label={t('login.totpCode')}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={8}
              required
              autoFocus
              className="font-mono tracking-[0.3em]"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              error={errors.code}
            />
          ) : (
            <TextField
              key="recovery"
              label={t('login.recoveryCode')}
              name="code"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
              autoFocus
              className="font-mono"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              error={errors.code}
            />
          )}
          <Button type="submit" className="w-full" loading={verify.isPending}>
            {t('login.verify')}
          </Button>
        </form>

        <div className="flex flex-col gap-2 text-sm">
          {mode === 'totp' && methods.includes('recovery_code') && (
            <button
              type="button"
              className="self-start rounded font-medium text-accent hover:underline focus-ring"
              onClick={() => switchMode('recovery_code')}
            >
              {t('login.useRecoveryCode')}
            </button>
          )}
          {mode === 'recovery_code' && hasTotp && (
            <button
              type="button"
              className="self-start rounded font-medium text-accent hover:underline focus-ring"
              onClick={() => switchMode('totp')}
            >
              {t('login.useTotp')}
            </button>
          )}
        </div>

        {methods.includes('passkey') && browserSupportsWebAuthn() && (
          <Button
            variant="secondary"
            className="w-full"
            loading={passkey.isPending}
            onClick={() => {
              verify.reset();
              passkey.mutate();
            }}
          >
            {t('login.mfaPasskey')}
          </Button>
        )}

        <button
          type="button"
          className="rounded text-sm text-fg-muted hover:text-fg focus-ring"
          onClick={() => onRestart(null)}
        >
          {t('login.back')}
        </button>
      </div>
    </>
  );
}
