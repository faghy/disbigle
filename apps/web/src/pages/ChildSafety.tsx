import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Card, PageTitle } from '../components/ui.tsx';

const CONTACT = 'disbin@disbigle.com';

/** Published child safety standards (child sexual abuse and exploitation), for the app stores. */
export function ChildSafetyPage() {
  const { t } = useTranslation();
  const list = (key: string) => t(key, { returnObjects: true }) as string[];
  const section = (key: string) => (
    <>
      <h2 className="pt-2 text-lg font-semibold first:pt-0">{t(`childSafety.${key}Title`)}</h2>
      <ul className="list-disc space-y-1 pl-5">
        {list(`childSafety.${key}`).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </>
  );
  return (
    <div className="space-y-4">
      <PageTitle description={t('childSafety.lead')}>{t('childSafety.title')}</PageTitle>
      <Card className="space-y-3">
        {section('banned')}
        {section('report')}
        <p>
          <Link to="/report-content" className="font-medium text-accent underline">
            app.disbigle.com/report-content
          </Link>
        </p>
        {section('action')}
        {section('prevention')}
        <h2 className="pt-2 text-lg font-semibold">{t('childSafety.contactTitle')}</h2>
        <p>
          {t('childSafety.contact')}{' '}
          <a href={`mailto:${CONTACT}`} className="font-medium text-accent underline">
            {CONTACT}
          </a>
        </p>
      </Card>
    </div>
  );
}
