import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { admin, adminKeys, type InstanceSettings, type RegistrationMode } from '../../api/admin.ts';
import { errorMessage, type FieldErrors, fieldErrorsFrom } from '../../api/errors.ts';
import { queryKeys } from '../../api/queries.ts';
import { ArrowUpIcon, CloseIcon } from '../../components/icons.tsx';
import {
  Alert,
  Button,
  Card,
  cx,
  LoadingState,
  TextAreaField,
  TextField,
} from '../../components/ui.tsx';
import { useFocusFirstError } from '../../lib/forms.ts';

export const MAX_RULES = 30;
export const MAX_RULE_LENGTH = 500;
const modes: RegistrationMode[] = ['open', 'approval', 'invite', 'closed'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InstanceSettingsPage() {
  const { t } = useTranslation();
  const settings = useQuery({ queryKey: adminKeys.settings, queryFn: admin.settings });
  if (settings.isPending) return <LoadingState label={t('common.loading')} />;
  if (settings.isError) return <Alert>{errorMessage(settings.error)}</Alert>;
  return <SettingsForm initial={settings.data} />;
}

let ruleKey = 0;
const withKey = (text: string) => {
  ruleKey += 1;
  return { key: ruleKey, text };
};

function SettingsForm({ initial }: { initial: InstanceSettings }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const ids = { mode: useId(), rules: useId() };
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [registrationMode, setMode] = useState<RegistrationMode>(initial.registrationMode);
  const [rules, setRules] = useState(() => initial.rules.map(withKey));
  const [contactEmail, setContactEmail] = useState(initial.contactEmail);
  const [welcomeAccount, setWelcomeAccount] = useState(initial.welcomeAccount ?? '');
  const [welcomeAspect, setWelcomeAspect] = useState(initial.welcomeAspect ?? '');
  const [welcomeMessage, setWelcomeMessage] = useState(initial.welcomeMessage ?? '');
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  useFocusFirstError(formRef, clientErrors);

  const save = useMutation({
    mutationFn: admin.updateSettings,
    onSuccess: (saved) => {
      queryClient.setQueryData(adminKeys.settings, saved);
      setRules(saved.rules.map(withKey));
      // Registration page, landing and about read the public instance info.
      void queryClient.invalidateQueries({ queryKey: queryKeys.instance });
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const found: FieldErrors = {};
    if (!title.trim()) found.title = t('validation.required');
    if (contactEmail.trim() && !EMAIL.test(contactEmail.trim()))
      found.contactEmail = t('validation.fields.email');
    setClientErrors(found);
    if (Object.keys(found).length > 0) {
      save.reset();
      return;
    }
    save.mutate({
      title: title.trim(),
      description: description.trim(),
      registrationMode,
      // Empty rules are dropped rather than rejected.
      rules: rules.map((rule) => rule.text.trim()).filter(Boolean),
      contactEmail: contactEmail.trim(),
      welcomeAccount: welcomeAccount.trim().replace(/^@/, ''),
      welcomeAspect: welcomeAspect.trim(),
      welcomeMessage: welcomeMessage.trim(),
    });
  };

  const errors = { ...fieldErrorsFrom(save.error), ...clientErrors };
  const move = (index: number, delta: number) =>
    setRules((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      if (item) next.splice(index + delta, 0, item);
      return next;
    });
  const iconButton =
    'inline-flex size-9 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-surface-muted hover:text-fg focus-ring disabled:invisible';

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-4">
      <Card className="space-y-4">
        <TextField
          label={t('admin.instance.title')}
          maxLength={100}
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          error={errors.title}
        />
        <TextAreaField
          label={t('admin.instance.description')}
          hint={t('admin.instance.descriptionHint')}
          rows={3}
          maxLength={2000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          error={errors.description}
        />
        <TextField
          label={t('admin.instance.contactEmail')}
          hint={t('admin.instance.contactHint')}
          type="email"
          autoComplete="email"
          value={contactEmail}
          onChange={(event) => setContactEmail(event.target.value)}
          error={errors.contactEmail}
        />
      </Card>

      <Card>
        <fieldset className="space-y-2">
          <legend className="mb-2 font-semibold">{t('admin.instance.registration')}</legend>
          {modes.map((mode) => (
            <label
              key={mode}
              className={cx(
                'flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5',
                registrationMode === mode ? 'border-accent/60 bg-accent-soft/50' : 'border-border',
              )}
            >
              <input
                type="radio"
                name={ids.mode}
                value={mode}
                checked={registrationMode === mode}
                onChange={() => setMode(mode)}
                className="mt-1 size-4 accent-accent"
              />
              <span>
                <span className="block text-sm font-medium">
                  {t(`admin.instance.modes.${mode}.label`)}
                </span>
                <span className="block text-xs text-fg-muted">
                  {t(`admin.instance.modes.${mode}.description`)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="font-semibold">{t('admin.instance.welcome')}</h2>
          <p className="text-sm text-fg-muted">{t('admin.instance.welcomeHint')}</p>
        </div>
        <TextField
          label={t('admin.instance.welcomeAccount')}
          hint={t('admin.instance.welcomeAccountHint')}
          maxLength={30}
          autoCapitalize="none"
          spellCheck={false}
          value={welcomeAccount}
          onChange={(event) => setWelcomeAccount(event.target.value)}
          error={errors.welcomeAccount}
        />
        <TextField
          label={t('admin.instance.welcomeAspect')}
          hint={t('admin.instance.welcomeAspectHint')}
          maxLength={100}
          value={welcomeAspect}
          onChange={(event) => setWelcomeAspect(event.target.value)}
          error={errors.welcomeAspect}
        />
        <TextAreaField
          label={t('admin.instance.welcomeMessage')}
          hint={t('admin.instance.welcomeMessageHint')}
          rows={8}
          maxLength={5000}
          value={welcomeMessage}
          onChange={(event) => setWelcomeMessage(event.target.value)}
          error={errors.welcomeMessage}
        />
      </Card>

      <Card aria-labelledby={ids.rules} className="space-y-3">
        <div>
          <h2 id={ids.rules} className="font-semibold">
            {t('admin.instance.rules')}
          </h2>
          <p className="text-sm text-fg-muted">
            {t('admin.instance.rulesHint', { max: MAX_RULES })}
          </p>
        </div>
        {rules.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('admin.instance.noRules')}</p>
        ) : (
          <ol className="space-y-2">
            {rules.map((rule, index) => {
              const id = `${ids.rules}-${rule.key}`;
              const error = errors[`rules.${index}`];
              return (
                <li key={rule.key} className="flex items-start gap-2">
                  <span className="mt-2.5 w-6 shrink-0 text-right text-sm font-semibold text-fg-muted">
                    {index + 1}.
                  </span>
                  <div className="min-w-0 flex-1">
                    <label htmlFor={id} className="sr-only">
                      {t('admin.instance.rule', { number: index + 1 })}
                    </label>
                    <textarea
                      id={id}
                      rows={2}
                      maxLength={MAX_RULE_LENGTH}
                      value={rule.text}
                      aria-invalid={error ? true : undefined}
                      onChange={(event) =>
                        setRules((list) =>
                          list.map((r) =>
                            r.key === rule.key ? { ...r, text: event.target.value } : r,
                          ),
                        )
                      }
                      className="input-base resize-y"
                    />
                    {error && <p className="mt-1 text-sm text-danger">{error}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      className={iconButton}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      aria-label={t('admin.instance.moveUp', { number: index + 1 })}
                    >
                      <ArrowUpIcon size={16} />
                    </button>
                    <button
                      type="button"
                      className={iconButton}
                      disabled={index === rules.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label={t('admin.instance.moveDown', { number: index + 1 })}
                    >
                      <ArrowUpIcon size={16} className="rotate-180" />
                    </button>
                  </div>
                  <button
                    type="button"
                    className={iconButton}
                    onClick={() => setRules((list) => list.filter((r) => r.key !== rule.key))}
                    aria-label={t('admin.instance.removeRule', { number: index + 1 })}
                  >
                    <CloseIcon size={16} />
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        <Button
          variant="secondary"
          disabled={rules.length >= MAX_RULES}
          onClick={() => setRules((list) => [...list, withKey('')])}
        >
          {t('admin.instance.addRule')}
        </Button>
      </Card>

      <div className="space-y-3">
        <Alert>
          {save.error && Object.keys(fieldErrorsFrom(save.error)).length === 0
            ? errorMessage(save.error)
            : null}
        </Alert>
        <Alert tone="success">{save.isSuccess ? t('settings.saved') : null}</Alert>
        <Button type="submit" loading={save.isPending}>
          {t('settings.save')}
        </Button>
      </div>
    </form>
  );
}
