import { type InstanceInfo, registerRequestSchema } from '@disbigle/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../api/endpoints.ts';
import {
  errorMessage,
  type FieldErrors,
  fieldErrorsFrom,
  isFieldError,
  issuesToFieldErrors,
} from '../api/errors.ts';
import { clearUserData, queryKeys, useInstance } from '../api/queries.ts';
import { InstanceRules } from '../components/InstanceRules.tsx';
import {
  Alert,
  Button,
  buttonClass,
  Card,
  CheckboxField,
  LoadingState,
  TextAreaField,
  TextField,
} from '../components/ui.tsx';
import { type BotCheckAnswer, prepareBotCheck } from '../lib/botCheck.ts';
import { useFocusFirstError } from '../lib/forms.ts';
import { currentLanguage } from '../lib/i18n.ts';
import { fullNavigation } from '../lib/redirect.ts';

export function RegisterPage() {
  const { t } = useTranslation();
  const instance = useInstance();

  if (instance.isPending) return <LoadingState label={t('common.loading')} />;
  if (instance.isError) {
    return (
      <div className="mx-auto max-w-md">
        <Alert>{errorMessage(instance.error)}</Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md">
      {instance.data.registrationMode === 'closed' ? (
        <Card>
          <h1 className="text-2xl font-semibold tracking-tight">{t('register.closedTitle')}</h1>
          <p className="mt-2 text-fg-muted">
            {t('register.closedBody', { domain: instance.data.domain })}
          </p>
          <Link to="/login" className={buttonClass('secondary', 'mt-6')}>
            {t('register.signIn')}
          </Link>
        </Card>
      ) : (
        <RegisterForm instance={instance.data} />
      )}
    </div>
  );
}

function RegisterForm({ instance }: { instance: InstanceInfo }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const mode = instance.registrationMode;
  // Invitation links look like /register?invite=CODE.
  const { invite, redirect } = useSearch({ from: '/register' });
  const showInvite = mode === 'invite' || Boolean(invite);

  const [values, setValues] = useState({
    username: '',
    email: '',
    password: '',
    reason: '',
    inviteCode: invite ?? '',
    agreement: false,
  });
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  // Honeypot: hidden from people, filled in by form-filling robots.
  const [website, setWebsite] = useState('');
  // The anti-robot answer is computed in the background while the form is being filled in.
  const botCheck = useRef<Promise<BotCheckAnswer | null> | null>(null);
  useEffect(() => {
    botCheck.current = prepareBotCheck();
  }, []);
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) =>
    setValues((previous) => ({ ...previous, [key]: value }));

  const register = useMutation({
    mutationFn: async (body: Parameters<typeof endpoints.register>[0]) => {
      const answer = await (botCheck.current ?? prepareBotCheck());
      return endpoints.register({
        ...body,
        ...(answer ?? {}),
        ...(website ? { website } : {}),
      });
    },
    // A refused robot check needs a fresh challenge for the next attempt.
    onError: (error) => {
      if ((error as { code?: string }).code === 'bot_check_failed')
        botCheck.current = prepareBotCheck();
    },
    onSuccess: async (result) => {
      if (result.status !== 'ok') return;
      clearUserData(queryClient);
      queryClient.setQueryData(queryKeys.me, result.user);
      if (redirect) {
        fullNavigation.assign(redirect);
        return;
      }
      await navigate({ to: '/' });
    },
  });

  const errors = { ...fieldErrorsFrom(register.error), ...clientErrors };
  useFocusFirstError(formRef, clientErrors);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = registerRequestSchema.safeParse({
      username: values.username,
      email: values.email,
      password: values.password,
      locale: currentLanguage(),
      agreement: values.agreement,
      ...(mode === 'approval' && values.reason.trim() ? { reason: values.reason } : {}),
      ...(showInvite && values.inviteCode.trim() ? { inviteCode: values.inviteCode } : {}),
    });
    const found = parsed.success ? {} : issuesToFieldErrors(parsed.error.issues);
    if (mode === 'invite' && !values.inviteCode.trim()) found.inviteCode = t('validation.required');
    if (!parsed.success || Object.keys(found).length > 0) {
      register.reset();
      setClientErrors(found);
      return;
    }
    setClientErrors({});
    register.mutate(parsed.data);
  };

  if (register.data?.status === 'pending_approval') {
    return (
      <Card>
        <div role="status">
          <h1 className="text-2xl font-semibold tracking-tight">{t('register.pendingTitle')}</h1>
          <p className="mt-2 text-fg-muted">{t('register.pendingBody')}</p>
        </div>
        <Link to="/" className={buttonClass('secondary', 'mt-6')}>
          {t('notFound.home')}
        </Link>
      </Card>
    );
  }

  const generalError =
    register.error && !isFieldError(register.error) ? errorMessage(register.error) : null;

  return (
    <>
      <Card>
        <h1 className="text-2xl font-semibold tracking-tight">{t('register.title')}</h1>
        <p className="mt-1 text-sm text-fg-muted">
          {t('register.subtitle', { domain: instance.domain })}
        </p>
        {mode === 'approval' && (
          <p className="mt-3 text-sm text-fg-muted">{t('register.approvalNotice')}</p>
        )}

        <form ref={formRef} onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
          <Alert>{generalError}</Alert>
          <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
            <label>
              Website
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
              />
            </label>
          </div>
          <TextField
            label={t('register.username')}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={30}
            required
            hint={t('register.usernameHint', { domain: instance.domain })}
            value={values.username}
            onChange={(event) => set('username', event.target.value)}
            error={errors.username}
          />
          <TextField
            label={t('register.email')}
            name="email"
            type="email"
            autoComplete="email"
            required
            value={values.email}
            onChange={(event) => set('email', event.target.value)}
            error={errors.email}
          />
          <TextField
            label={t('register.password')}
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            hint={t('register.passwordHint')}
            value={values.password}
            onChange={(event) => set('password', event.target.value)}
            error={errors.password}
          />
          {showInvite && (
            <TextField
              label={t('register.inviteCode')}
              name="inviteCode"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={values.inviteCode}
              onChange={(event) => set('inviteCode', event.target.value)}
              error={errors.inviteCode}
            />
          )}
          {mode === 'approval' && (
            <TextAreaField
              label={t('register.reason')}
              name="reason"
              maxLength={1000}
              hint={t('register.reasonHint')}
              value={values.reason}
              onChange={(event) => set('reason', event.target.value)}
              error={errors.reason}
            />
          )}
          {(instance.rules ?? []).length > 0 && (
            <section
              aria-labelledby="register-rules"
              className="rounded-xl border border-border bg-surface-muted/50 p-4"
            >
              <h2 id="register-rules" className="mb-3 text-sm font-semibold">
                {t('register.rulesTitle', { domain: instance.domain })}
              </h2>
              <InstanceRules rules={instance.rules} headingId="register-rules" />
            </section>
          )}
          <CheckboxField
            label={
              (instance.rules ?? []).length > 0
                ? t('register.agreementRules', { domain: instance.domain })
                : t('register.agreement', { domain: instance.domain })
            }
            name="agreement"
            required
            checked={values.agreement}
            onChange={(event) => set('agreement', event.target.checked)}
            error={errors.agreement}
          />
          <Button type="submit" className="w-full" loading={register.isPending}>
            {t('register.submit')}
          </Button>
        </form>
      </Card>
      <p className="mt-6 text-center text-sm text-fg-muted">
        {t('register.haveAccount')}{' '}
        <Link
          to="/login"
          search={{ redirect }}
          className="rounded font-medium text-accent hover:underline focus-ring"
        >
          {t('register.signIn')}
        </Link>
      </p>
    </>
  );
}
