import { passwordResetRequestSchema, passwordSchema } from '@disbigle/shared';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client.ts';
import { endpoints } from '../api/endpoints.ts';
import { errorMessage, type FieldErrors, fieldErrorsFrom } from '../api/errors.ts';
import { Alert, Button, buttonClass, Card, TextField } from '../components/ui.tsx';
import { useFocusFirstError } from '../lib/forms.ts';

/** Asks for a reset link. The server answers the same way whether the address exists or not. */
export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const formRef = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState('');
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const send = useMutation({ mutationFn: endpoints.forgotPassword });
  useFocusFirstError(formRef, clientErrors);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = passwordResetRequestSchema.safeParse({ email });
    if (!parsed.success) {
      setClientErrors({
        email: email.trim() ? t('validation.fields.email') : t('validation.required'),
      });
      return;
    }
    setClientErrors({});
    send.mutate(parsed.data.email);
  };

  return (
    <div className="mx-auto w-full max-w-md">
      <Card>
        <h1 className="text-2xl font-semibold tracking-tight">{t('passwordReset.forgotTitle')}</h1>
        {send.isSuccess ? (
          <div role="status" className="mt-3 space-y-4">
            <p className="text-fg-muted">{t('passwordReset.sent', { email: email.trim() })}</p>
            <Link to="/login" className={buttonClass('secondary')}>
              {t('passwordReset.backToSignIn')}
            </Link>
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-fg-muted">{t('passwordReset.forgotHelp')}</p>
            <form ref={formRef} onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
              <Alert>{send.error ? errorMessage(send.error) : null}</Alert>
              <TextField
                label={t('register.email')}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                error={clientErrors.email ?? fieldErrorsFrom(send.error).email}
              />
              <Button type="submit" className="w-full" loading={send.isPending}>
                {t('passwordReset.send')}
              </Button>
            </form>
          </>
        )}
      </Card>
      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="rounded font-medium text-accent hover:underline focus-ring">
          {t('passwordReset.backToSignIn')}
        </Link>
      </p>
    </div>
  );
}

/** Sets a new password from the link in the email (`/reset-password?token=…`). */
export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { token = '' } = useSearch({ from: '/reset-password' });
  const formRef = useRef<HTMLFormElement>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  useFocusFirstError(formRef, clientErrors);

  const reset = useMutation({
    mutationFn: (value: string) => endpoints.resetPassword(token, value),
    onSuccess: () => navigate({ to: '/login', search: { reset: 'done' } }),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const found: FieldErrors = {};
    if (!password) found.password = t('validation.required');
    else if (!passwordSchema.safeParse(password).success)
      found.password = t('validation.fields.password');
    if (!found.password && password !== confirm) found.confirm = t('validation.passwordMismatch');
    setClientErrors(found);
    if (Object.keys(found).length === 0) reset.mutate(password);
  };

  // A 400 means the link is invalid, already used or expired.
  const linkBroken =
    !token || (reset.error instanceof ApiError && reset.error.code === 'bad_request');

  return (
    <div className="mx-auto w-full max-w-md">
      <Card>
        <h1 className="text-2xl font-semibold tracking-tight">{t('passwordReset.resetTitle')}</h1>
        {linkBroken ? (
          <div className="mt-3 space-y-4">
            <Alert>{t('passwordReset.invalidLink')}</Alert>
            <Link to="/forgot-password" className={buttonClass('primary')}>
              {t('passwordReset.requestNew')}
            </Link>
          </div>
        ) : (
          <form ref={formRef} onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
            <Alert>{reset.error ? errorMessage(reset.error) : null}</Alert>
            {/* Lets password managers save the new password. */}
            <input type="hidden" autoComplete="username" />
            <TextField
              label={t('settings.account.newPassword')}
              type="password"
              autoComplete="new-password"
              required
              hint={t('register.passwordHint')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={clientErrors.password ?? fieldErrorsFrom(reset.error).password}
            />
            <TextField
              label={t('settings.account.confirmPassword')}
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              error={clientErrors.confirm}
            />
            <Button type="submit" className="w-full" loading={reset.isPending}>
              {t('passwordReset.save')}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
