import type { CurrentUser } from '@disbigle/shared';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useMe } from '../api/queries.ts';
import { Avatar } from '../components/Avatar.tsx';
import { buttonClass, Card, LoadingState } from '../components/ui.tsx';

export function HomePage() {
  const { t } = useTranslation();
  const me = useMe();
  if (me.isPending) return <LoadingState label={t('common.loading')} />;
  return me.data ? <SignedInHome user={me.data} /> : <Landing />;
}

function Landing() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center py-12 text-center sm:py-20">
      <span
        aria-hidden="true"
        className="mb-6 inline-flex size-16 items-center justify-center rounded-2xl bg-accent text-3xl font-bold text-accent-fg shadow-sm"
      >
        D
      </span>
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Disbigle</h1>
      <p className="mt-4 max-w-xl text-lg text-fg-muted">{t('landing.tagline')}</p>
      <div className="mt-8 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
        <Link to="/register" className={buttonClass('primary', 'px-6')}>
          {t('landing.register')}
        </Link>
        <Link to="/login" className={buttonClass('secondary', 'px-6')}>
          {t('landing.signIn')}
        </Link>
      </div>
    </div>
  );
}

function SignedInHome({ user }: { user: CurrentUser }) {
  const { t } = useTranslation();
  const { account } = user;
  const name = account.displayName || account.username;
  return (
    <div className="space-y-6">
      <Card className="flex items-center gap-4">
        <Avatar account={account} size="lg" />
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {t('home.welcome', { name })}
          </h1>
          <Link
            to="/@{$username}"
            params={{ username: account.username }}
            className="rounded text-sm text-fg-muted hover:text-accent focus-ring"
          >
            @{account.username}
          </Link>
        </div>
      </Card>
      <Card className="border-dashed text-center">
        <p className="py-10 text-fg-muted">{t('home.timelinePlaceholder')}</p>
      </Card>
    </div>
  );
}
