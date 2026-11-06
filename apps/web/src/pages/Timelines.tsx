import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { socialKeys } from '../api/cache.ts';
import { errorMessage } from '../api/errors.ts';
import { useCurrentUser } from '../api/queries.ts';
import { type PageParams, social } from '../api/social.ts';
import {
  aspectsQueryOptions,
  tagKeys,
  useFollowTag,
  useHiddenTags,
  useHideTag,
  useUnhideTag,
} from '../api/socialQueries.ts';
import { Composer } from '../components/Composer.tsx';
import { FeedHeader, FeedSection } from '../components/FeedSection.tsx';
import { AspectsIcon, BookmarkIcon, GlobeIcon, HashIcon, LocalIcon } from '../components/icons.tsx';
import { Timeline } from '../components/Timeline.tsx';
import { Alert, Button, buttonClass, LoadingState } from '../components/ui.tsx';
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
        description={<TagSummary name={name} />}
        icon={HashIcon}
        actions={
          <div className="flex flex-wrap items-start justify-end gap-2">
            <HideTagButton name={name} />
            <FollowTagButton name={name} />
          </div>
        }
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

function TagSummary({ name }: { name: string }) {
  const { t } = useTranslation();
  const tag = useQuery({ queryKey: tagKeys.tag(name), queryFn: () => social.tag(name) });
  if (!tag.data) return <>{t('timeline.tag.description', { tag: name })}</>;
  return <>{t('timeline.tag.postsCount', { count: tag.data.postsCount, tag: name })}</>;
}

/** Follows a hashtag: its public posts then show up in Home. */
function FollowTagButton({ name }: { name: string }) {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const tag = useQuery({ queryKey: tagKeys.tag(name), queryFn: () => social.tag(name) });
  const change = useFollowTag();
  if (!user || !tag.data) return null;
  const following = tag.data.following;
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant={following ? 'secondary' : 'primary'}
        loading={change.isPending}
        aria-pressed={following}
        onClick={() => change.mutate({ name, follow: !following })}
      >
        {following ? t('tags.unfollow') : t('tags.follow')}
      </Button>
      {change.error && (
        <span role="alert" className="text-xs text-danger">
          {errorMessage(change.error)}
        </span>
      )}
    </div>
  );
}

/** Hides a hashtag from your timelines (its own page still shows it), or shows it again. */
function HideTagButton({ name }: { name: string }) {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const tag = useQuery({ queryKey: tagKeys.tag(name), queryFn: () => social.tag(name) });
  const hiddenTags = useHiddenTags();
  const hide = useHideTag();
  const show = useUnhideTag();
  if (!user || !tag.data) return null;
  const entry = hiddenTags.data?.find((h) => h.name === tag.data.name && !h.account);
  const hidden = tag.data.hidden;
  const error = hide.error ?? show.error;
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="secondary"
        loading={hide.isPending || show.isPending}
        aria-pressed={hidden}
        disabled={hidden && !entry}
        onClick={() =>
          hidden && entry ? show.mutate({ id: entry.id }) : hide.mutate({ name: tag.data.name })
        }
      >
        {hidden ? t('tags.unhide') : t('tags.hide')}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {errorMessage(error)}
        </span>
      )}
    </div>
  );
}
