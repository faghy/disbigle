import { type CurrentUser, changePasswordRequestSchema } from '@disbigle/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../api/client.ts';
import { endpoints } from '../../api/endpoints.ts';
import {
  errorMessage,
  type FieldErrors,
  fieldErrorsFrom,
  isFieldError,
  issuesToFieldErrors,
} from '../../api/errors.ts';
import { queryKeys, useCurrentUser } from '../../api/queries.ts';
import { Alert, Button, Card, PageTitle, TextField } from '../../components/ui.tsx';
import { useFocusFirstError } from '../../lib/forms.ts';
import { isLanguage, languages, setLanguage } from '../../lib/i18n.ts';

export function AccountSettingsPage() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  if (!user) return null;
  return (
    <>
      <PageTitle description={t('settings.account.description')}>
        {t('settings.account.title')}
      </PageTitle>
      <div className="space-y-6">
        <LanguageSettings user={user} />
        <ChangePassword />
      </div>
    </>
  );
}

function LanguageSettings({ user }: { user: CurrentUser }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const selectId = useId();
  const [locale, setLocale] = useState(isLanguage(user.locale) ? user.locale : 'en');

  const save = useMutation({
    mutationFn: endpoints.updateSettings,
    onSuccess: async (updated) => {
      queryClient.setQueryData(queryKeys.me, updated);
      if (isLanguage(updated.locale)) await setLanguage(updated.locale);
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({ locale });
  };

  return (
    <Card aria-labelledby="language-title">
      <h2 id="language-title" className="font-semibold">
        {t('settings.account.language')}
      </h2>
      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <label htmlFor={selectId} className="block text-sm font-medium">
            {t('settings.account.languageLabel')}
          </label>
          <select
            id={selectId}
            className="input-base"
            value={locale}
            onChange={(event) => {
              if (isLanguage(event.target.value)) setLocale(event.target.value);
              save.reset();
            }}
          >
            {languages.map((language) => (
              <option key={language} value={language}>
                {t(`languages.${language}`)}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" loading={save.isPending}>
          {t('settings.save')}
        </Button>
      </form>
      <div className="mt-3">
        <Alert>{save.error ? errorMessage(save.error) : null}</Alert>
        <Alert tone="success">{save.isSuccess ? t('settings.saved') : null}</Alert>
      </div>
    </Card>
  );
}

function ChangePassword() {
  const { t } = useTranslation();
  const formRef = useRef<HTMLFormElement>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});

  const change = useMutation({
    mutationFn: endpoints.changePassword,
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    },
  });

  const errors = { ...fieldErrorsFrom(change.error), ...clientErrors };
  useFocusFirstError(formRef, clientErrors);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = changePasswordRequestSchema.safeParse({ currentPassword, newPassword });
    const found = parsed.success ? {} : issuesToFieldErrors(parsed.error.issues);
    if (!found.newPassword && newPassword !== confirmPassword) {
      found.confirmPassword = t('validation.passwordMismatch');
    }
    if (!parsed.success || Object.keys(found).length > 0) {
      change.reset();
      setClientErrors(found);
      return;
    }
    setClientErrors({});
    change.mutate(parsed.data);
  };

  // A wrong current password comes back as wrong_password: show it on that field.
  const wrongPassword = change.error instanceof ApiError && change.error.code === 'wrong_password';
  const currentPasswordError =
    errors.currentPassword ?? (wrongPassword ? t('errors.wrong_password') : undefined);
  const generalError =
    change.error && !isFieldError(change.error) && !wrongPassword
      ? errorMessage(change.error)
      : null;

  return (
    <Card aria-labelledby="password-title">
      <h2 id="password-title" className="font-semibold">
        {t('settings.account.password')}
      </h2>
      <p className="mt-1 text-sm text-fg-muted">{t('settings.account.passwordHint')}</p>
      <form ref={formRef} onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
        {/* Helps password managers associate the new password with the right account. */}
        <input type="hidden" autoComplete="username" />
        <TextField
          label={t('settings.account.currentPassword')}
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          error={currentPasswordError}
        />
        <TextField
          label={t('settings.account.newPassword')}
          type="password"
          autoComplete="new-password"
          required
          hint={t('register.passwordHint')}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          error={errors.newPassword}
        />
        <TextField
          label={t('settings.account.confirmPassword')}
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          error={errors.confirmPassword}
        />
        <Alert>{generalError}</Alert>
        <Alert tone="success">
          {change.isSuccess ? t('settings.account.passwordChanged') : null}
        </Alert>
        <Button type="submit" loading={change.isPending}>
          {t('settings.account.changePassword')}
        </Button>
      </form>
    </Card>
  );
}
