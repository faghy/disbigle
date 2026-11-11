import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Card, PageTitle } from '../components/ui.tsx';

const CONTACT = 'disbin@disbigle.com';

/**
 * Public page on how to delete the account and what happens to the data (linked from the app
 * stores, which ask for one reachable without signing in).
 */
export function DeleteAccountInfoPage() {
  const { t } = useTranslation();
  const list = (key: string) => t(key, { returnObjects: true }) as string[];
  return (
    <div className="space-y-4">
      <PageTitle description={t('deleteInfo.lead')}>{t('deleteInfo.title')}</PageTitle>
      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">{t('deleteInfo.appTitle')}</h2>
        <ol className="list-decimal space-y-1 pl-5">
          {list('deleteInfo.appSteps').map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <h2 className="pt-2 text-lg font-semibold">{t('deleteInfo.webTitle')}</h2>
        <p>
          {t('deleteInfo.web')}{' '}
          <Link to="/settings/account" className="font-medium text-accent underline">
            app.disbigle.com/settings/account
          </Link>
        </p>
        <h2 className="pt-2 text-lg font-semibold">{t('deleteInfo.noAccessTitle')}</h2>
        <p>
          {t('deleteInfo.noAccess')}{' '}
          <a href={`mailto:${CONTACT}`} className="font-medium text-accent underline">
            {CONTACT}
          </a>
        </p>
      </Card>
      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">{t('deleteInfo.deletedTitle')}</h2>
        <ul className="list-disc space-y-1 pl-5">
          {list('deleteInfo.deleted').map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <h2 className="pt-2 text-lg font-semibold">{t('deleteInfo.keptTitle')}</h2>
        <ul className="list-disc space-y-1 pl-5">
          {list('deleteInfo.kept').map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <h2 className="pt-2 text-lg font-semibold">{t('deleteInfo.partialTitle')}</h2>
        <p>{t('deleteInfo.partial')}</p>
      </Card>
    </div>
  );
}
