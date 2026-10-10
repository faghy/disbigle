import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../api/errors.ts';
import { buttonClass } from '../components/ui.tsx';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="py-16 text-center">
      <p className="text-sm font-semibold text-accent">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t('notFound.title')}</h1>
      <p className="mt-2 text-fg-muted">{t('notFound.description')}</p>
      <Link to="/" className={buttonClass('secondary', 'mt-6')}>
        {t('notFound.home')}
      </Link>
    </div>
  );
}

export function ErrorPage({ error, reset }: { error: unknown; reset?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="py-16 text-center" role="alert">
      <h1 className="text-2xl font-semibold tracking-tight">{t('errorPage.title')}</h1>
      <p className="mt-2 text-fg-muted">{errorMessage(error)}</p>
      <button
        type="button"
        className={buttonClass('secondary', 'mt-6')}
        onClick={() => (reset ? reset() : window.location.reload())}
      >
        {t('errorPage.retry')}
      </button>
    </div>
  );
}
