import type { ScheduledPost } from '@disbigle/shared';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../api/errors.ts';
import {
  scheduleBounds,
  toLocalInput,
  useDeleteScheduledPost,
  useReschedulePost,
  useScheduledPosts,
} from '../api/scheduled.ts';
import { Composer } from '../components/Composer.tsx';
import { ConfirmDialog } from '../components/Dialog.tsx';
import { FeedHeader } from '../components/FeedSection.tsx';
import { ClockIcon, PollIcon, WarningIcon } from '../components/icons.tsx';
import { Alert, Button, Card, LoadingState } from '../components/ui.tsx';
import { fullDateTime, relativeTime } from '../lib/time.ts';
import { visibilityIcons } from '../lib/visibility.tsx';

/**
 * Your scheduled posts (issue #28): the next first, each with its time, which can be changed,
 * and a way to cancel it. Posts that could not be published stay here with the reason.
 */
export function ScheduledPage() {
  const { t } = useTranslation();
  const posts = useScheduledPosts();

  return (
    <>
      <FeedHeader
        title={t('scheduled.title')}
        description={t('scheduled.description')}
        icon={ClockIcon}
      />
      <div className="mb-4">
        <Composer startScheduling />
      </div>
      {posts.isPending ? (
        <LoadingState label={t('common.loading')} />
      ) : posts.isError ? (
        <Alert>{errorMessage(posts.error)}</Alert>
      ) : posts.data.length === 0 ? (
        <Card className="p-6 text-center text-fg-muted">{t('scheduled.empty')}</Card>
      ) : (
        <ul className="space-y-3" aria-label={t('scheduled.title')}>
          {posts.data.map((post) => (
            <li key={post.id}>
              <ScheduledItem post={post} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ScheduledItem({ post }: { post: ScheduledPost }) {
  const { t, i18n } = useTranslation();
  const reschedule = useReschedulePost();
  const remove = useDeleteScheduledPost();
  const [moving, setMoving] = useState(false);
  const [when, setWhen] = useState(() => toLocalInput(new Date(post.scheduledAt)));
  const [confirming, setConfirming] = useState(false);
  const whenId = useId();
  const { params } = post;
  const Visibility = visibilityIcons[params.visibility];
  const bounds = scheduleBounds();

  const failure =
    post.error === 'interrupted' ? t('scheduled.interrupted') : post.error || t('scheduled.failed');

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <ClockIcon size={16} />
          <time dateTime={post.scheduledAt}>{fullDateTime(post.scheduledAt, i18n.language)}</time>
        </span>
        {!post.failed && (
          <span className="text-fg-muted">{relativeTime(post.scheduledAt, i18n.language)}</span>
        )}
        <span className="inline-flex items-center gap-1 text-fg-muted">
          <Visibility size={14} />
          {t(`visibility.${params.visibility}.label`)}
        </span>
        {params.inReplyToId && <span className="text-fg-muted">{t('scheduled.reply')}</span>}
      </div>

      {post.failed && (
        <p className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          <WarningIcon size={16} className="mt-0.5 shrink-0" />
          <span>
            {t('scheduled.notPublished')} {failure}
          </span>
        </p>
      )}

      {params.summary && (
        <p className="text-sm font-semibold">
          {t('composer.warning.label')}: {params.summary}
        </p>
      )}
      {params.content && (
        <p className="line-clamp-6 text-sm whitespace-pre-wrap break-words">{params.content}</p>
      )}
      {post.media.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {post.media.map((media) => (
            <img
              key={media.id}
              src={media.previewUrl ?? media.url}
              alt={media.description}
              className="size-20 rounded-lg object-cover"
            />
          ))}
        </div>
      )}
      {params.poll && (
        <p className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
          <PollIcon size={16} />
          {t('scheduled.poll', { count: params.poll.options.length })}
        </p>
      )}

      {moving && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            reschedule.mutate(
              { id: post.id, scheduledAt: new Date(when).toISOString() },
              { onSuccess: () => setMoving(false) },
            );
          }}
        >
          <label htmlFor={whenId} className="text-sm font-semibold">
            {t('scheduled.publishAt')}
          </label>
          <input
            id={whenId}
            type="datetime-local"
            className="input-base w-auto py-1.5"
            min={bounds.min}
            max={bounds.max}
            value={when}
            required
            onChange={(event) => setWhen(event.target.value)}
          />
          <Button type="submit" loading={reschedule.isPending}>
            {t('scheduled.save')}
          </Button>
          <Button variant="ghost" onClick={() => setMoving(false)}>
            {t('common.cancel')}
          </Button>
        </form>
      )}
      <Alert>
        {reschedule.error || remove.error ? errorMessage(reschedule.error ?? remove.error) : null}
      </Alert>

      {!moving && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setMoving(true)}>
            {post.failed ? t('scheduled.retry') : t('scheduled.move')}
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(true)}>
            {t('scheduled.delete')}
          </Button>
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          title={t('scheduled.deleteTitle')}
          description={t('scheduled.deleteDescription')}
          confirmLabel={t('scheduled.delete')}
          pending={remove.isPending}
          onConfirm={() => remove.mutate(post.id, { onSuccess: () => setConfirming(false) })}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Card>
  );
}
