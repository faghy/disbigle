import { type CurrentUser, updateProfileRequestSchema } from '@disbigle/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../api/endpoints.ts';
import {
  errorMessage,
  type FieldErrors,
  fieldErrorsFrom,
  isFieldError,
  issuesToFieldErrors,
} from '../../api/errors.ts';
import { queryKeys, useCurrentUser } from '../../api/queries.ts';
import {
  Alert,
  Button,
  Card,
  CheckboxField,
  PageTitle,
  TextAreaField,
  TextField,
} from '../../components/ui.tsx';
import { useFocusFirstError } from '../../lib/forms.ts';

const MAX_FIELDS = 4;

export function ProfileSettingsPage() {
  const user = useCurrentUser();
  return user ? <ProfileForm user={user} /> : null;
}

interface FieldRow {
  key: number;
  name: string;
  value: string;
}

function ProfileForm({ user }: { user: CurrentUser }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const nextKey = useRef(user.account.fields.length);
  const { account } = user;

  const [displayName, setDisplayName] = useState(account.displayName);
  const [note, setNote] = useState(account.note);
  const [fields, setFields] = useState<FieldRow[]>(() =>
    account.fields.map((field, index) => ({ key: index, ...field })),
  );
  const [locked, setLocked] = useState(account.locked);
  const [discoverable, setDiscoverable] = useState(account.discoverable);
  const [bot, setBot] = useState(account.bot);
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});

  const save = useMutation({
    mutationFn: endpoints.updateProfile,
    onSuccess: (updated) => {
      queryClient.setQueryData<CurrentUser | null>(queryKeys.me, (current) =>
        current ? { ...current, account: updated } : current,
      );
      queryClient.setQueryData(queryKeys.account(updated.username), updated);
    },
  });

  const errors = { ...fieldErrorsFrom(save.error), ...clientErrors };
  useFocusFirstError(formRef, clientErrors);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const kept = fields.filter((field) => field.name.trim() || field.value.trim());
    const parsed = updateProfileRequestSchema.safeParse({
      displayName,
      note,
      fields: kept.map(({ name, value }) => ({ name, value })),
      locked,
      discoverable,
      bot,
    });
    if (!parsed.success) {
      save.reset();
      setClientErrors(issuesToFieldErrors(parsed.error.issues));
      return;
    }
    setClientErrors({});
    setFields(kept);
    save.mutate(parsed.data);
  };

  const updateField = (key: number, patch: Partial<FieldRow>) =>
    setFields((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const generalError = save.error && !isFieldError(save.error) ? errorMessage(save.error) : null;

  return (
    <>
      <PageTitle description={t('settings.profile.description')}>
        {t('settings.profile.title')}
      </PageTitle>
      <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-6">
        <Card className="space-y-4">
          <TextField
            label={t('settings.profile.displayName')}
            name="displayName"
            maxLength={100}
            autoComplete="nickname"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            error={errors.displayName}
          />
          <TextAreaField
            label={t('settings.profile.bio')}
            name="note"
            rows={5}
            maxLength={5000}
            hint={t('settings.profile.bioHint')}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            error={errors.note}
          />
        </Card>

        <Card className="space-y-4" aria-labelledby="profile-fields-title">
          <div>
            <h2 id="profile-fields-title" className="font-semibold">
              {t('settings.profile.fields')}
            </h2>
            <p className="text-sm text-fg-muted">
              {t('settings.profile.fieldsHint', { max: MAX_FIELDS })}
            </p>
          </div>
          {fields.length === 0 && (
            <p className="text-sm text-fg-muted">{t('settings.profile.noFields')}</p>
          )}
          <ul className="space-y-4">
            {fields.map((field, index) => (
              <li
                key={field.key}
                className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
              >
                <TextField
                  label={t('settings.profile.fieldName', { number: index + 1 })}
                  maxLength={255}
                  value={field.name}
                  onChange={(event) => updateField(field.key, { name: event.target.value })}
                  error={errors[`fields.${index}.name`]}
                />
                <TextField
                  label={t('settings.profile.fieldValue', { number: index + 1 })}
                  maxLength={2047}
                  value={field.value}
                  onChange={(event) => updateField(field.key, { value: event.target.value })}
                  error={errors[`fields.${index}.value`]}
                />
                <Button
                  variant="ghost"
                  aria-label={t('settings.profile.removeFieldLabel', { number: index + 1 })}
                  onClick={() => setFields((rows) => rows.filter((row) => row.key !== field.key))}
                >
                  {t('settings.profile.removeField')}
                </Button>
              </li>
            ))}
          </ul>
          {fields.length < MAX_FIELDS && (
            <Button
              variant="secondary"
              onClick={() => {
                nextKey.current += 1;
                setFields((rows) => [...rows, { key: nextKey.current, name: '', value: '' }]);
              }}
            >
              {t('settings.profile.addField')}
            </Button>
          )}
          {errors.fields && <p className="text-sm text-danger">{errors.fields}</p>}
        </Card>

        <Card className="space-y-4" aria-labelledby="profile-privacy-title">
          <h2 id="profile-privacy-title" className="font-semibold">
            {t('settings.profile.options')}
          </h2>
          <CheckboxField
            label={t('settings.profile.locked')}
            hint={t('settings.profile.lockedHint')}
            checked={locked}
            onChange={(event) => setLocked(event.target.checked)}
          />
          <CheckboxField
            label={t('settings.profile.discoverable')}
            hint={t('settings.profile.discoverableHint')}
            checked={discoverable}
            onChange={(event) => setDiscoverable(event.target.checked)}
          />
          <CheckboxField
            label={t('settings.profile.bot')}
            hint={t('settings.profile.botHint')}
            checked={bot}
            onChange={(event) => setBot(event.target.checked)}
          />
        </Card>

        <div className="space-y-3">
          <Alert>{generalError}</Alert>
          <Alert tone="success">{save.isSuccess ? t('settings.saved') : null}</Alert>
          <Button type="submit" loading={save.isPending}>
            {t('settings.save')}
          </Button>
        </div>
      </form>
    </>
  );
}
