import { type HomeRepliesSetting, homeRepliesSettings } from '@disbigle/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { socialKeys } from '../api/cache.ts';
import { endpoints } from '../api/endpoints.ts';
import { queryKeys, useCurrentUser, useInstance, useMe } from '../api/queries.ts';
import { social } from '../api/social.ts';
import { Composer } from '../components/Composer.tsx';
import { FeedHeader, FeedSection } from '../components/FeedSection.tsx';
import { HomeIcon } from '../components/icons.tsx';
import { LogoMark } from '../components/Logo.tsx';
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
      <LogoMark className="mb-6 size-24 -rotate-6" />
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
      <FeedHeader title={t('timeline.home.title')} icon={HomeIcon} actions={<RepliesChoice />} />
      {/* On small screens the floating button opens the composer instead. */}
      <div className="hidden md:block">
        <Composer />
      </div>
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

/** Which replies the home shows: all, only those to people you follow (the default), or none. */
function RepliesChoice() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const id = useId();
  const update = useMutation({
    mutationFn: (homeReplies: HomeRepliesSetting) => endpoints.updateSettings({ homeReplies }),
    onSuccess: (me) => {
      queryClient.setQueryData(queryKeys.me, me);
      void queryClient.resetQueries({ queryKey: socialKeys.timeline('home') });
    },
  });
  if (!user) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor={id} className="text-fg-muted max-sm:sr-only">
        {t('timeline.home.replies.label')}
      </label>
      <select
        id={id}
        value={user.homeReplies}
        disabled={update.isPending}
        onChange={(event) => update.mutate(event.target.value as HomeRepliesSetting)}
        title={t('timeline.home.replies.help')}
        className="rounded-lg border border-border bg-surface py-1 pr-8 pl-2 text-sm focus-ring"
      >
        {homeRepliesSettings.map((value) => (
          <option key={value} value={value}>
            {t(`timeline.home.replies.${value}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
