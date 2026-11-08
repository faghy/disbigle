import { useMutation } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../api/endpoints.ts';
import { buttonClass, Card, LoadingState } from '../components/ui.tsx';

/** The link emailed at sign-up: confirms the address, then sends the person to sign in. */
export function VerifyEmailPage() {
  const { t } = useTranslation();
  const { token = '' } = useSearch({ from: '/verify-email' });
  const verify = useMutation({ mutationFn: () => endpoints.verifyEmail(token) });
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when the page opens
  useEffect(() => {
    if (token) verify.mutate();
  }, [token]);

  if (token && (verify.isIdle || verify.isPending))
    return <LoadingState label={t('verifyEmail.checking')} />;
  const ok = verify.isSuccess;
  return (
    <Card>
      <div role="status">
        <h1 className="text-2xl font-semibold tracking-tight">
          {ok ? t('verifyEmail.doneTitle') : t('verifyEmail.brokenTitle')}
        </h1>
        <p className="mt-2 text-fg-muted">
          {ok
            ? verify.data.status === 'pending_approval'
              ? t('verifyEmail.donePending')
              : t('verifyEmail.done')
            : t('verifyEmail.broken')}
        </p>
      </div>
      <Link to="/login" className={buttonClass('primary', 'mt-6')}>
        {t('verifyEmail.signIn')}
      </Link>
    </Card>
  );
}
