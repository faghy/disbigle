import type { CreatePostRequest, Group, GroupSummary, Status, Visibility } from '@disbigle/shared';
import { Link } from '@tanstack/react-router';
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, fieldErrorsFrom, isFieldError } from '../api/errors.ts';
import { useCreateStatus } from '../api/mutations.ts';
import { useCurrentUser, useLimits } from '../api/queries.ts';
import { scheduleBounds, useSchedulePost } from '../api/scheduled.ts';
import { useAspects } from '../api/socialQueries.ts';
import { useAutoGrow } from '../lib/autoGrow.ts';
import { draftKey, loadDraft, removeDraft, saveDraft } from '../lib/drafts.ts';
import { applyFormat, type Format, shortcutFormat } from '../lib/markdownFormat.ts';
import { fullDateTime } from '../lib/time.ts';
import { isPrivateConversation } from '../lib/visibility.tsx';
import { AudiencePicker, type AudienceValue } from './AudiencePicker.tsx';
import { Avatar } from './Avatar.tsx';
import { ComposerLinkPreview } from './ComposerLinkPreview.tsx';
import { EmojiButton } from './EmojiPicker.tsx';
import { FormattingToolbar, PostPreview } from './FormattingToolbar.tsx';
import { ClockIcon, GroupIcon, PollIcon, WarningIcon } from './icons.tsx';
import { AddMediaButton, MediaList, useMediaItems } from './MediaEditor.tsx';
import { useMentionSuggestions } from './MentionSuggestions.tsx';
import { emptyPoll, type PollDraft, PollEditor, validatePoll } from './PollEditor.tsx';
import { Alert, Button, cx } from './ui.tsx';

/** Visibility a reply starts with: the parent's, unless the parent is public. */
function initialReplyVisibility(parent: Status): Visibility {
  return parent.visibility === 'public' ? 'public' : parent.visibility;
}

export interface ComposerProps {
  replyTo?: Status;
  /** Starting audience, e.g. the aspect whose timeline is open. */
  initialAudience?: AudienceValue;
  autoFocus?: boolean;
  compact?: boolean;
  onPosted?: (status: Status) => void;
  onCancel?: () => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  /** Lets a parent edit the text (e.g. a recipient picker adding @mentions). */
  editContentRef?: RefObject<((edit: (content: string) => string) => void) | null>;
  /** Shown above the text, e.g. a recipient picker. */
  header?: ReactNode;
  /** Writes in this group: its members (or everyone, for a public group) read the post. */
  group?: GroupSummary | Group;
  /** Text to start with, e.g. a link shared from another site. */
  initialText?: string;
  /** Opens with the time picker shown, as on the page of scheduled posts. */
  startScheduling?: boolean;
}

/** Posts of plain members wait for a moderator in groups that approve them. */
const needsApproval = (group: GroupSummary | Group) =>
  'postApproval' in group && group.postApproval && group.membership?.role === 'member';

export function Composer({
  replyTo,
  initialAudience,
  autoFocus = false,
  compact = false,
  onPosted,
  onCancel,
  textareaRef,
  editContentRef,
  header,
  group: groupProp,
  initialText = '',
  startScheduling = false,
}: ComposerProps) {
  const { t, i18n } = useTranslation();
  const user = useCurrentUser();
  const aspects = useAspects();
  const create = useCreateStatus();
  const schedule = useSchedulePost();
  const limits = useLimits();
  const maxLength = limits.maxPostLength;
  const ids = {
    text: useId(),
    counter: useId(),
    warning: useId(),
    error: useId(),
    when: useId(),
    whenError: useId(),
  };
  const ownTextarea = useRef<HTMLTextAreaElement>(null);
  const textarea = textareaRef ?? ownTextarea;

  // Posts and replies in a group: the group is the audience.
  const group = groupProp ?? replyTo?.group ?? null;
  const lockedAudience = replyTo ? isPrivateConversation(replyTo.visibility) : false;
  const mention =
    replyTo && replyTo.account.id !== user?.account.id ? `@${replyTo.account.acct} ` : '';

  // What was being written here last time, unless the composer opens with a given text.
  const draftId = user
    ? draftKey(user.account.id, { replyToId: replyTo?.id, groupId: groupProp?.id })
    : null;
  const [restored] = useState(() => (draftId && !initialText ? loadDraft(draftId) : null));
  const [draftNotice, setDraftNotice] = useState(restored !== null);

  const [content, setContent] = useState(restored?.content ?? mention + initialText);
  useEffect(() => {
    if (editContentRef) editContentRef.current = (edit) => setContent(edit);
  }, [editContentRef]);
  const [audience, setAudience] = useState<AudienceValue>(
    replyTo
      ? { visibility: initialReplyVisibility(replyTo), aspectIds: [] }
      : (initialAudience ?? { visibility: 'public', aspectIds: [] }),
  );
  const [warningOpen, setWarningOpen] = useState(Boolean(restored?.summary));
  const [summary, setSummary] = useState(restored?.summary ?? '');
  const [sensitive, setSensitive] = useState(false);
  const [poll, setPoll] = useState<PollDraft | null>(null);
  const mediaItems = useMediaItems();
  const { media, uploading } = mediaItems;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preparing, setPreparing] = useState(false);
  const mentions = useMentionSuggestions({ textarea, content, setContent });
  useAutoGrow(textarea, content);

  useEffect(() => {
    if (!autoFocus) return;
    const element = textarea.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, [autoFocus, textarea]);

  const [previewing, setPreviewing] = useState(false);
  // Publishing later (issue #28): the chosen local time, and the last post scheduled.
  const [scheduling, setScheduling] = useState(startScheduling);
  const [scheduleAt, setScheduleAt] = useState('');
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);

  // Keeps the draft at every change, so closing the page loses nothing; an empty composer
  // leaves no draft behind.
  useEffect(() => {
    if (!draftId) return;
    const kept = warningOpen ? summary : '';
    if ((content.trim() === '' || content === mention) && !kept.trim()) removeDraft(draftId);
    else saveDraft(draftId, { content, summary: kept });
  }, [draftId, content, summary, warningOpen, mention]);

  if (!user) return null;

  const length = content.length;
  const remaining = maxLength - length;
  const mutationError = scheduling ? schedule.error : create.error;
  const serverErrors = fieldErrorsFrom(mutationError);
  const allErrors = { ...serverErrors, ...errors };

  const reset = () => {
    if (draftId) removeDraft(draftId);
    setDraftNotice(false);
    setPreviewing(false);
    mediaItems.reset();
    setContent('');
    setSummary('');
    setWarningOpen(false);
    setSensitive(false);
    setErrors({});
    setPoll(null);
    setScheduling(startScheduling);
    setScheduleAt('');
  };

  const validate = (): Record<string, string> => {
    const found: Record<string, string> = {};
    if (!content.trim() && mediaItems.ready.length === 0)
      found.content = poll ? t('poll.errors.question') : t('composer.errors.empty');
    if (poll) Object.assign(found, validatePoll(poll, t));
    if (length > maxLength) found.content = t('composer.errors.tooLong', { max: maxLength });
    if (
      !group &&
      !lockedAudience &&
      audience.visibility === 'limited' &&
      audience.aspectIds.length === 0
    )
      found.aspectIds = t('composer.errors.aspectsRequired');
    if (mediaItems.failed) found.media = t('composer.errors.mediaFailed');
    if (scheduling) {
      const when = new Date(scheduleAt).getTime();
      if (!scheduleAt || Number.isNaN(when)) found.scheduledAt = t('scheduled.errors.chooseTime');
      else if (when < Date.now() + 5 * 60_000) found.scheduledAt = t('scheduled.errors.tooSoon');
      else if (when > Date.now() + 90 * 24 * 3600_000)
        found.scheduledAt = t('scheduled.errors.tooLate');
    }
    return found;
  };

  const submit = async () => {
    if (create.isPending || schedule.isPending || preparing || uploading) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      create.reset();
      schedule.reset();
      if (found.content) textarea.current?.focus();
      return;
    }
    const { ready } = mediaItems;
    setPreparing(true);
    const saved = await mediaItems.saveDescriptions();
    setPreparing(false);
    if (!saved) return;

    const body: CreatePostRequest = {
      content,
      visibility: lockedAudience && replyTo ? replyTo.visibility : audience.visibility,
      aspectIds: !lockedAudience && audience.visibility === 'limited' ? audience.aspectIds : [],
      summary: warningOpen ? summary.trim() : '',
      sensitive: ready.length > 0 && sensitive,
      mediaIds: ready.map((item) => item.attachment.id),
      ...(poll
        ? {
            poll: {
              options: poll.options.map((option) => option.text.trim()),
              expiresIn: poll.expiresIn,
              multiple: poll.multiple,
            },
          }
        : {}),
      ...(replyTo ? { inReplyToId: replyTo.id } : {}),
      ...(group && !replyTo ? { groupId: group.id } : {}),
    };
    if (scheduling) {
      schedule.mutate(
        { ...body, scheduledAt: new Date(scheduleAt).toISOString() },
        {
          onSuccess: (post) => {
            reset();
            setScheduledFor(post.scheduledAt);
          },
        },
      );
      return;
    }
    setScheduledFor(null);
    create.mutate(body, {
      onSuccess: (status) => {
        reset();
        onPosted?.(status);
      },
    });
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const format = (kind: Format) => {
    const element = textarea.current;
    if (!element) return;
    const edit = applyFormat(content, element.selectionStart, element.selectionEnd, kind, {
      text: t('composer.format.placeholder'),
      link: 'https://',
    });
    setContent(edit.text);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(edit.start, edit.end);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentions.onKeyDown(event)) return;
    const shortcut = shortcutFormat(event);
    if (shortcut) {
      event.preventDefault();
      format(shortcut);
      return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void submit();
    }
  };

  const generalError =
    mutationError && !isFieldError(mutationError) ? errorMessage(mutationError) : null;
  const busy = create.isPending || schedule.isPending || preparing;
  const bounds = scheduleBounds();
  const counterTone =
    remaining < 0
      ? 'text-danger font-semibold'
      : remaining <= 100
        ? 'text-accent'
        : 'text-fg-muted';

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label={replyTo ? t('composer.replyLabel') : t('composer.label')}
      className={cx('sticker-soft rounded-2xl bg-surface', compact ? 'p-3' : 'p-4')}
    >
      <div className="flex gap-3">
        {!compact && <Avatar account={user.account} size="md" className="max-sm:hidden" />}
        <div className="min-w-0 flex-1 space-y-3">
          {header}
          {group ? (
            <p className="flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
              <GroupIcon size={16} className="shrink-0" />
              <span>
                {t(group.privacy === 'public' ? 'composer.inPublicGroup' : 'composer.inGroup', {
                  name: group.name,
                })}
                {needsApproval(group) && (
                  <span className="block text-xs">{t('composer.needsApproval')}</span>
                )}
              </span>
            </p>
          ) : (
            replyTo &&
            lockedAudience && (
              <p className="flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
                <WarningIcon size={16} className="shrink-0" />
                {t('composer.privateReply')}
              </p>
            )
          )}

          {draftNotice && (
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
              {t('composer.draft.restored')}
              <button
                type="button"
                className="font-semibold text-accent hover:underline focus-ring rounded"
                onClick={() => {
                  if (draftId) removeDraft(draftId);
                  setDraftNotice(false);
                  setContent(mention);
                  setSummary('');
                  setWarningOpen(false);
                }}
              >
                {t('composer.draft.discard')}
              </button>
            </p>
          )}

          {warningOpen && (
            <div>
              <label htmlFor={ids.warning} className="sr-only">
                {t('composer.warning.label')}
              </label>
              <input
                id={ids.warning}
                className="input-base"
                placeholder={t('composer.warning.placeholder')}
                maxLength={500}
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
              />
            </div>
          )}

          <FormattingToolbar
            onFormat={format}
            previewing={previewing}
            onPreviewChange={setPreviewing}
          />
          {previewing && <PostPreview content={content} />}
          <div className={cx('relative', previewing && 'hidden')}>
            <label htmlFor={ids.text} className="sr-only">
              {replyTo ? t('composer.replyLabel') : t('composer.label')}
            </label>
            <textarea
              id={ids.text}
              ref={textarea}
              rows={compact ? 3 : 4}
              value={content}
              {...mentions.textareaProps}
              onChange={(event) => {
                setContent(event.target.value);
                mentions.trackCaret();
              }}
              onKeyDown={onKeyDown}
              placeholder={replyTo ? t('composer.replyPlaceholder') : t('composer.placeholder')}
              aria-invalid={allErrors.content ? true : undefined}
              aria-describedby={cx(ids.counter, allErrors.content && ids.error) || undefined}
              className="block w-full resize-none border-0 bg-transparent p-0 text-base placeholder:text-fg-muted focus:ring-0 focus-visible:outline-none"
            />
            {mentions.list}
            {allErrors.content && (
              <p id={ids.error} className="mt-1 text-sm text-danger">
                {allErrors.content}
              </p>
            )}
          </div>

          <MediaList items={mediaItems} error={allErrors.media} />
          {media.length === 0 && !poll && <ComposerLinkPreview text={content} />}

          {poll && (
            <PollEditor
              value={poll}
              onChange={(next) => {
                setPoll(next);
                // Clear option errors as soon as the options change.
                setErrors((current) =>
                  Object.fromEntries(
                    Object.entries(current).filter(([key]) => !key.startsWith('poll')),
                  ),
                );
              }}
              errors={allErrors}
            />
          )}

          {!group && (
            <AudiencePicker
              value={
                lockedAudience && replyTo
                  ? { visibility: replyTo.visibility, aspectIds: replyTo.aspectIds ?? [] }
                  : audience
              }
              onChange={(value) => {
                setAudience(value);
                if (value.visibility !== 'limited' || value.aspectIds.length > 0)
                  setErrors(({ aspectIds: _removed, ...rest }) => rest);
              }}
              aspects={aspects.data}
              error={allErrors.aspectIds}
              disabled={lockedAudience}
            />
          )}
          {!group && audience.visibility === 'direct' && !lockedAudience && (
            <p className="text-xs text-fg-muted">{t('composer.directHint')}</p>
          )}

          {scheduling && (
            <div className="space-y-1 rounded-lg bg-surface-muted px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor={ids.when} className="text-sm font-semibold">
                  {t('scheduled.publishAt')}
                </label>
                <input
                  id={ids.when}
                  type="datetime-local"
                  className="input-base w-auto py-1.5"
                  min={bounds.min}
                  max={bounds.max}
                  value={scheduleAt}
                  onChange={(event) => {
                    setScheduleAt(event.target.value);
                    setErrors(({ scheduledAt: _removed, ...rest }) => rest);
                  }}
                  aria-invalid={allErrors.scheduledAt ? true : undefined}
                  aria-describedby={allErrors.scheduledAt ? ids.whenError : undefined}
                />
              </div>
              <p className="text-xs text-fg-muted">{t('scheduled.hint')}</p>
              {allErrors.scheduledAt && (
                <p id={ids.whenError} className="text-sm text-danger">
                  {allErrors.scheduledAt}
                </p>
              )}
            </div>
          )}

          {scheduledFor && (
            <p role="status" className="text-sm text-success">
              {t('scheduled.done', { date: fullDateTime(scheduledFor, i18n.language) })}{' '}
              <Link to="/scheduled" className="font-semibold underline focus-ring rounded">
                {t('scheduled.seeAll')}
              </Link>
            </p>
          )}

          <Alert>{generalError}</Alert>

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <AddMediaButton
              items={mediaItems}
              disabled={poll !== null}
              title={poll ? t('poll.editor.noMediaWithPoll') : undefined}
              testId="composer-file-input"
            />
            <EmojiButton textarea={textarea} onChange={setContent} />
            <button
              type="button"
              aria-pressed={poll !== null}
              disabled={media.length > 0}
              onClick={() => setPoll((current) => (current ? null : emptyPoll()))}
              aria-label={t('poll.editor.add')}
              title={media.length > 0 ? t('poll.editor.noPollWithMedia') : t('poll.editor.add')}
              className={cx(
                'inline-flex size-9 items-center justify-center rounded-full focus-ring disabled:opacity-40',
                poll
                  ? 'bg-accent-soft text-accent'
                  : 'text-fg-muted hover:bg-surface-muted hover:text-fg',
              )}
            >
              <PollIcon />
            </button>
            <button
              type="button"
              aria-pressed={warningOpen}
              onClick={() => setWarningOpen((value) => !value)}
              title={t('composer.warning.toggle')}
              className={cx(
                'inline-flex h-9 items-center justify-center rounded-full px-2.5 text-xs font-bold focus-ring',
                warningOpen ? 'bg-accent-soft text-accent' : 'text-fg-muted hover:bg-surface-muted',
              )}
            >
              <span aria-hidden="true">CW</span>
              <span className="sr-only">{t('composer.warning.toggle')}</span>
            </button>
            <button
              type="button"
              aria-pressed={scheduling}
              onClick={() => {
                setScheduling((value) => !value);
                setErrors(({ scheduledAt: _removed, ...rest }) => rest);
                schedule.reset();
              }}
              aria-label={t('scheduled.toggle')}
              title={t('scheduled.toggle')}
              className={cx(
                'inline-flex size-9 items-center justify-center rounded-full focus-ring',
                scheduling
                  ? 'bg-accent-soft text-accent'
                  : 'text-fg-muted hover:bg-surface-muted hover:text-fg',
              )}
            >
              <ClockIcon />
            </button>
            {media.length > 0 && (
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-fg-muted">
                <input
                  type="checkbox"
                  className="size-4 accent-accent"
                  checked={sensitive || (warningOpen && summary.trim().length > 0)}
                  disabled={warningOpen && summary.trim().length > 0}
                  onChange={(event) => setSensitive(event.target.checked)}
                />
                {t('composer.sensitive')}
              </label>
            )}

            <div className="ml-auto flex items-center gap-3">
              <span id={ids.counter} className={cx('text-sm tabular-nums', counterTone)}>
                <span aria-hidden="true">{remaining}</span>
                <span className="sr-only">{t('composer.remaining', { count: remaining })}</span>
              </span>
              {onCancel && (
                <Button variant="ghost" onClick={onCancel}>
                  {t('common.cancel')}
                </Button>
              )}
              <Button
                type="submit"
                loading={busy}
                disabled={remaining < 0 || uploading}
                title={t('composer.shortcut')}
              >
                {scheduling
                  ? t('scheduled.schedule')
                  : replyTo
                    ? t('composer.reply')
                    : t('composer.publish')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
