import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { socialKeys } from '../api/cache.ts';
import { useInstance, useMe } from '../api/queries.ts';
import { social } from '../api/social.ts';
import { Composer } from '../components/Composer.tsx';
import { FeedHeader, FeedSection } from '../components/FeedSection.tsx';
import { HomeIcon } from '../components/icons.tsx';
import { Timeline } from '../components/Timeline.tsx';
import { buttonClass, LoadingState } from '../components/ui.tsx';

export function HomePage() {
  const { t } = useTranslation();
  const me = useMe();
  if (me.isPending) return <LoadingState label={t('common.loading')} />;
  return me.data ? <HomeTimeline /> : <Landing />;
}

function Landing() {
  const { t } = useTranslation();
  const instance = useInstance();
  return (
    <div className="flex flex-col items-center py-12 text-center sm:py-20">
      <span
        aria-hidden="true"
        className="mb-6 inline-flex size-16 items-center justify-center rounded-2xl bg-accent text-3xl font-bold text-accent-fg shadow-sm"
      >
        D
      </span>
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
        {instance.data?.title || 'Disbigle'}
      </h1>
      <p className="mt-4 max-w-xl text-lg text-fg-muted">
        {instance.data?.description || t('landing.tagline')}
      </p>
      <div className="mt-8 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
        <Link to="/register" className={buttonClass('primary', 'px-6')}>
          {t('landing.register')}
        </Link>
        <Link to="/login" className={buttonClass('secondary', 'px-6')}>
          {t('landing.signIn')}
        </Link>
      </div>
      <Link
        to="/public/local"
        className="mt-6 rounded text-sm text-accent hover:underline focus-ring"
      >
        {t('landing.explore')}
      </Link>
    </div>
  );
}

function HomeTimeline() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <FeedHeader title={t('timeline.home.title')} icon={HomeIcon} />
      <Composer />
      <FeedSection>
        <Timeline
          queryKey={socialKeys.timeline('home')}
          fetchPage={social.homeTimeline}
          stream="user"
          label={t('timeline.home.title')}
          empty={
            <>
              <p className="font-medium text-fg">{t('timeline.home.emptyTitle')}</p>
              <p className="mt-1 text-sm">{t('timeline.home.empty')}</p>
              <p className="mt-3 text-sm">
                {t('timeline.home.findPeople')}{' '}
                <Link
                  to="/search"
                  search={{ q: '@someone@mastodon.social' }}
                  className="font-mono text-accent hover:underline"
                >
                  @someone@mastodon.social
                </Link>
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Link to="/search" className={buttonClass('primary')}>
                  {t('timeline.home.findButton')}
                </Link>
                <Link to="/public/local" className={buttonClass('secondary')}>
                  {t('timeline.home.explore')}
                </Link>
              </div>
            </>
          }
        />
      </FeedSection>
    </div>
  );
}
