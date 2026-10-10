import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { socialKeys } from '../api/cache.ts';
import { errorMessage } from '../api/errors.ts';
import { useCurrentUser } from '../api/queries.ts';
import { type PageParams, social } from '../api/social.ts';
import { aspectsQueryOptions } from '../api/socialQueries.ts';
import { Composer } from '../components/Composer.tsx';
import { FeedHeader, FeedSection } from '../components/FeedSection.tsx';
import { AspectsIcon, BookmarkIcon, GlobeIcon, HashIcon, LocalIcon } from '../components/icons.tsx';
import { Timeline } from '../components/Timeline.tsx';
import { Alert, buttonClass, LoadingState } from '../components/ui.tsx';
import { NotFoundPage } from './ErrorPages.tsx';

const fetchLocal = (page: PageParams) => social.publicTimeline({ ...page, local: true });
const fetchFederated = (page: PageParams) => social.publicTimeline(page);

export function LocalTimelinePage() {
  const { t } = useTranslation();
  return (
    <>
      <FeedHeader
        title={t('timeline.local.title')}
        description={t('timeline.local.description')}
        icon={LocalIcon}
      />
      <FeedSection>
        <Timeline
          queryKey={socialKeys.timeline('public', 'local')}
          fetchPage={fetchLocal}
          stream="public:local"
          label={t('timeline.local.title')}
          empty={t('timeline.empty')}
        />
      </FeedSection>
    </>
  );
}

export function FederatedTimelinePage() {
  const { t } = useTranslation();
  return (
    <>
      <FeedHeader
        title={t('timeline.federated.title')}
        description={t('timeline.federated.description')}
        icon={GlobeIcon}
      />
      <FeedSection>
        <Timeline
          queryKey={socialKeys.timeline('public', 'all')}
          fetchPage={fetchFederated}
          stream="public"
          label={t('timeline.federated.title')}
          empty={t('timeline.empty')}
        />
      </FeedSection>
    </>
  );
}

export function TagTimelinePage() {
  const { t } = useTranslation();
  const { tag } = useParams({ from: '/tags/$tag' });
  const name = tag.replace(/^#/, '').toLowerCase();
  const valid = /^[\p{L}\p{N}_]{1,100}$/u.test(name);
  if (!valid) return <NotFoundPage />;
  return (
    <>
      <FeedHeader
        title={`#${name}`}
        description={t('timeline.tag.description', { tag: name })}
        icon={HashIcon}
      />
      <FeedSection>
        <Timeline
          queryKey={socialKeys.timeline('tag', name)}
          fetchPage={(page) => social.tagTimeline(name, page)}
          stream={`hashtag:${name}`}
          label={`#${name}`}
          empty={t('timeline.tag.empty', { tag: name })}
        />
      </FeedSection>
    </>
  );
}

export function BookmarksPage() {
  const { t } = useTranslation();
  return (
    <>
      <FeedHeader
        title={t('timeline.bookmarks.title')}
        description={t('timeline.bookmarks.description')}
        icon={BookmarkIcon}
      />
      <FeedSection>
        <Timeline
          queryKey={socialKeys.timeline('bookmarks')}
          fetchPage={social.bookmarks}
          label={t('timeline.bookmarks.title')}
          empty={t('timeline.bookmarks.empty')}
        />
      </FeedSection>
    </>
  );
}

export function AspectTimelinePage() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const { aspectId } = useParams({ from: '/aspects/$aspectId' });
  const aspects = useQuery({ ...aspectsQueryOptions, enabled: Boolean(user) });

  if (aspects.isPending) return <LoadingState label={t('common.loading')} />;
  if (aspects.isError) return <Alert>{errorMessage(aspects.error)}</Alert>;
  const aspect = aspects.data.find((a) => a.id === aspectId);
  if (!aspect) return <NotFoundPage />;

  return (
    <div className="space-y-4">
      <FeedHeader
        title={aspect.name}
        description={t('timeline.aspect.description', {
          name: aspect.name,
          count: aspect.memberCount,
        })}
        icon={AspectsIcon}
        actions={
          <Link to="/aspects" className={buttonClass('secondary')}>
            {t('timeline.aspect.manage')}
          </Link>
        }
      />
      <Composer
        key={aspect.id}
        initialAudience={{ visibility: 'limited', aspectIds: [aspect.id] }}
      />
      <FeedSection>
        <Timeline
          queryKey={socialKeys.timeline('aspect', aspect.id)}
          fetchPage={(page) => social.aspectTimeline(aspect.id, page)}
          label={aspect.name}
          empty={t('timeline.aspect.empty', { name: aspect.name })}
        />
      </FeedSection>
    </div>
  );
}
