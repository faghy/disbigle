import type { CreatePostRequest, GroupSummary, Status, Visibility } from '@disbigle/shared';
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
import { useAspects } from '../api/socialQueries.ts';
import { isPrivateConversation } from '../lib/visibility.tsx';
import { AudiencePicker, type AudienceValue } from './AudiencePicker.tsx';
import { Avatar } from './Avatar.tsx';
import { EmojiButton } from './EmojiPicker.tsx';
import { GroupIcon, PollIcon, WarningIcon } from './icons.tsx';
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
  group?: GroupSummary;
}

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
}: ComposerProps) {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const aspects = useAspects();
  const create = useCreateStatus();
  const limits = useLimits();
  const maxLength = limits.maxPostLength;
  const ids = { text: useId(), counter: useId(), warning: useId(), error: useId() };
  const ownTextarea = useRef<HTMLTextAreaElement>(null);
  const textarea = textareaRef ?? ownTextarea;

  // Posts and replies in a group: the group is the audience.
  const group = groupProp ?? replyTo?.group ?? null;
  const lockedAudience = replyTo ? isPrivateConversation(replyTo.visibility) : false;
  const mention =
    replyTo && replyTo.account.id !== user?.account.id ? `@${replyTo.account.acct} ` : '';

  const [content, setContent] = useState(mention);
  useEffect(() => {
    if (editContentRef) editContentRef.current = (edit) => setContent(edit);
  }, [editContentRef]);
  const [audience, setAudience] = useState<AudienceValue>(
    replyTo
      ? { visibility: initialReplyVisibility(replyTo), aspectIds: [] }
      : (initialAudience ?? { visibility: 'public', aspectIds: [] }),
  );
  const [warningOpen, setWarningOpen] = useState(false);
  const [summary, setSummary] = useState('');
  const [sensitive, setSensitive] = useState(false);
  const [poll, setPoll] = useState<PollDraft | null>(null);
  const mediaItems = useMediaItems();
  const { media, uploading } = mediaItems;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preparing, setPreparing] = useState(false);
  const mentions = useMentionSuggestions({ textarea, content, setContent });

  useEffect(() => {
    if (!autoFocus) return;
    const element = textarea.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, [autoFocus, textarea]);

  if (!user) return null;

  const length = content.length;
  const remaining = maxLength - length;
  const serverErrors = fieldErrorsFrom(create.error);
  const allErrors = { ...serverErrors, ...errors };

  const reset = () => {
    mediaItems.reset();
    setContent('');
    setSummary('');
    setWarningOpen(false);
    setSensitive(false);
    setErrors({});
    setPoll(null);
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
    return found;
  };

  const submit = async () => {
    if (create.isPending || preparing || uploading) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      create.reset();
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

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentions.onKeyDown(event)) return;
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void submit();
    }
  };

  const generalError =
    create.error && !isFieldError(create.error) ? errorMessage(create.error) : null;
  const busy = create.isPending || preparing;
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
              {t(group.privacy === 'public' ? 'composer.inPublicGroup' : 'composer.inGroup', {
                name: group.name,
              })}
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

          <div className="relative">
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
              className="block w-full resize-y border-0 bg-transparent p-0 text-base placeholder:text-fg-muted focus:ring-0 focus-visible:outline-none"
            />
            {mentions.list}
            {allErrors.content && (
              <p id={ids.error} className="mt-1 text-sm text-danger">
                {allErrors.content}
              </p>
            )}
          </div>

          <MediaList items={mediaItems} error={allErrors.media} />

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
                {replyTo ? t('composer.reply') : t('composer.publish')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
