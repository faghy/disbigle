import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type AdminUserAction,
  type AdminUserDetail,
  type AdminUserPatch,
  admin,
  adminKeys,
} from '../../api/admin.ts';
import { errorMessage } from '../../api/errors.ts';
import { useCurrentUser } from '../../api/queries.ts';
import { AccountRow } from '../../components/AccountList.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { Alert, Button, Card, LoadingState } from '../../components/ui.tsx';
import { languages } from '../../lib/i18n.ts';
import { fullDateTime, relativeTime } from '../../lib/time.ts';

/** One person's account, for administrators: correct their data and help them get back in. */
export function UserDetailPage() {
  const { t } = useTranslation();
  const { userId } = useParams({ from: '/admin/users/$userId' });
  const user = useQuery({ queryKey: adminKeys.user(userId), queryFn: () => admin.user(userId) });

  return (
    <section aria-labelledby="user-title" className="space-y-3">
      <Link to="/admin/users" className="text-sm font-medium text-accent hover:underline">
        ← {t('admin.userDetail.back')}
      </Link>
      {user.isPending ? (
        <LoadingState label={t('common.loading')} />
      ) : user.isError ? (
        <Alert>{errorMessage(user.error)}</Alert>
      ) : (
        <UserDetail user={user.data} />
      )}
    </section>
  );
}

function UserDetail({ user }: { user: AdminUserDetail }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const me = useCurrentUser();
  const [done, setDone] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<AdminUserAction | null>(null);

  const refresh = (next?: AdminUserDetail) => {
    if (next) queryClient.setQueryData(adminKeys.user(user.userId), next);
    else void queryClient.invalidateQueries({ queryKey: adminKeys.user(user.userId) });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
  };
  const action = useMutation({
    mutationFn: (kind: AdminUserAction) => admin.userAction(user.userId, kind),
    onSuccess: (_result, kind) => {
      setConfirming(null);
      if (kind === 'delete_unconfirmed') {
        void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
        void navigate({ to: '/admin/users' });
        return;
      }
      refresh();
      setDone(t(`admin.userDetail.done.${kind}`, { email: user.email }));
    },
  });

  const confirmed = user.emailVerifiedAt !== null;
  const neverSignedIn = user.lastSignInAt === null;
  const date = (value: string | null) =>
    value ? (
      <time dateTime={value} title={fullDateTime(value, i18n.language)}>
        {relativeTime(value, i18n.language)}
      </time>
    ) : (
      t('admin.users.never')
    );

  return (
    <div className="space-y-3">
      <h2 id="user-title" className="sr-only">
        {user.account.displayName || user.account.username}
      </h2>
      <Card className="space-y-3 p-4 sm:p-5">
        <AccountRow account={user.account} />
        <dl className="grid gap-x-4 gap-y-1 px-2 text-sm sm:grid-cols-2">
          <Fact term={t('admin.users.joined')}>{date(user.createdAt)}</Fact>
          <Fact term={t('admin.userDetail.lastSignIn')}>{date(user.lastSignInAt)}</Fact>
          <Fact term={t('admin.userDetail.role')}>{t(`admin.roles.${user.role}`)}</Fact>
          <Fact term={t('admin.userDetail.emailState')}>
            <span className={confirmed ? 'text-success' : 'text-danger'}>
              {confirmed ? t('admin.pending.verified') : t('admin.pending.notVerified')}
            </span>
          </Fact>
          <Fact term={t('admin.userDetail.twoFactor')}>
            {user.totp || user.passkeys > 0
              ? [
                  user.totp ? t('admin.userDetail.totp') : null,
                  user.passkeys > 0
                    ? t('admin.userDetail.passkeys', { count: user.passkeys })
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : t('admin.users.no')}
          </Fact>
        </dl>
        <figure className="mx-2 rounded-xl border border-border bg-surface-muted px-4 py-3">
          <figcaption className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
            {t('admin.accounts.reason')}
          </figcaption>
          {user.reason ? (
            <blockquote className="mt-1 text-sm whitespace-pre-wrap break-words">
              {user.reason}
            </blockquote>
          ) : (
            <p className="mt-1 text-sm text-fg-muted italic">{t('admin.pending.noReason')}</p>
          )}
        </figure>
      </Card>

      <p role="status" className="text-sm text-success empty:hidden">
        {done}
      </p>

      <EditForm
        user={user}
        onSaved={(next) => {
          refresh(next);
          setDone(t('admin.userDetail.saved'));
        }}
      />

      <Card className="space-y-3 p-4 sm:p-5">
        <h3 className="font-semibold">{t('admin.userDetail.access')}</h3>
        <Alert>{action.error ? errorMessage(action.error) : null}</Alert>
        <div className="flex flex-wrap gap-2">
          {!confirmed && (
            <>
              <Button
                variant="secondary"
                loading={action.isPending && action.variables === 'resend_confirmation'}
                disabled={action.isPending}
                onClick={() => action.mutate('resend_confirmation')}
              >
                {t('admin.userDetail.resendConfirmation')}
              </Button>
              <Button
                variant="secondary"
                disabled={action.isPending}
                onClick={() => setConfirming('confirm_email')}
              >
                {t('admin.userDetail.confirmEmail')}
              </Button>
            </>
          )}
          <Button
            variant="secondary"
            loading={action.isPending && action.variables === 'password_reset'}
            disabled={action.isPending || user.disabled || user.deletionRequested}
            onClick={() => action.mutate('password_reset')}
          >
            {t('admin.userDetail.passwordReset')}
          </Button>
          {(user.totp || user.passkeys > 0) && user.account.id !== me?.account.id && (
            <Button
              variant="danger"
              disabled={action.isPending}
              onClick={() => setConfirming('reset_two_factor')}
            >
              {t('admin.userDetail.resetTwoFactor')}
            </Button>
          )}
          {!confirmed && neverSignedIn && (
            <Button
              variant="danger"
              disabled={action.isPending}
              onClick={() => setConfirming('delete_unconfirmed')}
            >
              {t('admin.userDetail.deleteUnconfirmed')}
            </Button>
          )}
        </div>
        <p className="text-xs text-fg-muted">{t('admin.userDetail.accessHint')}</p>
      </Card>

      <Card className="space-y-2 p-4 sm:p-5">
        <h3 className="font-semibold">{t('admin.userDetail.log')}</h3>
        {user.log.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('admin.userDetail.logEmpty')}</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {user.log.map((entry) => (
              <li key={entry.id} className="flex flex-wrap gap-x-2 py-1.5">
                <span className="font-medium">
                  {t(`admin.userDetail.actions.${entry.action}`, { defaultValue: entry.action })}
                </span>
                {entry.byUsername && <span className="text-fg-muted">@{entry.byUsername}</span>}
                <span className="ml-auto text-xs text-fg-muted">{date(entry.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {confirming && (
        <ConfirmDialog
          title={t(`admin.userDetail.confirm.${confirming}.title`, {
            name: user.account.displayName || user.account.username,
          })}
          description={t(`admin.userDetail.confirm.${confirming}.description`, {
            email: user.email,
          })}
          confirmLabel={t(`admin.userDetail.confirm.${confirming}.button`)}
          danger={confirming !== 'confirm_email'}
          pending={action.isPending}
          onCancel={() => setConfirming(null)}
          onConfirm={() => action.mutate(confirming)}
        />
      )}
    </div>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-1">
      <dt className="text-fg-muted">{term}:</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function EditForm({
  user,
  onSaved,
}: {
  user: AdminUserDetail;
  onSaved: (next: AdminUserDetail) => void;
}) {
  const { t } = useTranslation();
  const ids = { email: useId(), name: useId(), locale: useId() };
  const [email, setEmail] = useState(user.email);
  const [displayName, setDisplayName] = useState(user.account.displayName);
  const [locale, setLocale] = useState(user.locale);
  useEffect(() => {
    setEmail(user.email);
    setDisplayName(user.account.displayName);
    setLocale(user.locale);
  }, [user.email, user.account.displayName, user.locale]);

  const patch: AdminUserPatch = {
    ...(email.trim() !== user.email ? { email: email.trim() } : {}),
    ...(displayName.trim() !== user.account.displayName ? { displayName: displayName.trim() } : {}),
    ...(locale !== user.locale ? { locale } : {}),
  };
  const changed = Object.keys(patch).length > 0;
  const save = useMutation({
    mutationFn: () => admin.updateUser(user.userId, patch),
    onSuccess: onSaved,
  });
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (changed) save.mutate();
  };

  return (
    <Card className="p-4 sm:p-5">
      <form onSubmit={onSubmit} className="space-y-3" aria-labelledby={`${ids.email}-title`}>
        <h3 id={`${ids.email}-title`} className="font-semibold">
          {t('admin.userDetail.data')}
        </h3>
        <div className="space-y-1">
          <label htmlFor={ids.email} className="block text-sm font-medium">
            {t('admin.userDetail.email')}
          </label>
          <input
            id={ids.email}
            type="email"
            required
            className="input-base"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <p className="text-xs text-fg-muted">{t('admin.userDetail.emailHint')}</p>
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.name} className="block text-sm font-medium">
            {t('admin.userDetail.displayName')}
          </label>
          <input
            id={ids.name}
            className="input-base"
            maxLength={100}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.locale} className="block text-sm font-medium">
            {t('admin.userDetail.language')}
          </label>
          <select
            id={ids.locale}
            className="input-base"
            value={locale}
            onChange={(event) => setLocale(event.target.value)}
          >
            {languages.map((language) => (
              <option key={language} value={language}>
                {t(`languages.${language}`)}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-fg-muted">
          {t('admin.userDetail.username', { username: user.account.username })}
        </p>
        <Alert>{save.error ? errorMessage(save.error) : null}</Alert>
        <Button type="submit" loading={save.isPending} disabled={!changed}>
          {t('settings.save')}
        </Button>
      </form>
    </Card>
  );
}
