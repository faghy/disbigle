import { useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Composer } from '../components/Composer.tsx';
import { FeedHeader, FeedSection } from '../components/FeedSection.tsx';
import { ReshareIcon } from '../components/icons.tsx';
import { statusPath } from '../components/StatusCard.tsx';

/** Shares a link from another site: the composer, already holding its title and address. */
export function SharePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { text } = useSearch({ from: '/share' });
  return (
    <>
      <FeedHeader
        title={t('share.title')}
        description={t('share.description')}
        icon={ReshareIcon}
      />
      <FeedSection>
        <Composer
          autoFocus
          initialText={text ? `${text.trim()} ` : ''}
          onPosted={(status) => void navigate(statusPath(status))}
          onCancel={() => void navigate({ to: '/' })}
        />
      </FeedSection>
    </>
  );
}
