import type { CreatePostRequest, MediaAttachment, Status, Visibility } from '@disbigle/shared';
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
import { social } from '../api/social.ts';
import { useAspects } from '../api/socialQueries.ts';
import { isPrivateConversation } from '../lib/visibility.tsx';
import { AudiencePicker, type AudienceValue } from './AudiencePicker.tsx';
import { Avatar } from './Avatar.tsx';
import { CloseIcon, ImageIcon, PollIcon, WarningIcon } from './icons.tsx';
import { emptyPoll, type PollDraft, PollEditor, validatePoll } from './PollEditor.tsx';
import { Alert, Button, cx, Spinner } from './ui.tsx';

const MAX_DESCRIPTION = 1500;

interface MediaItem {
  key: string;
  name: string;
  kind: 'image' | 'video' | 'audio';
  previewUrl: string | null;
  state: 'uploading' | 'ready' | 'error';
  attachment: MediaAttachment | null;
  description: string;
  error: unknown;
}

/** Visibility a reply starts with: the parent's, unless the parent is public. */
function initialReplyVisibility(parent: Status): Visibility {
  return parent.visibility === 'public' ? 'public' : parent.visibility;
}

let mediaKey = 0;

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
}: ComposerProps) {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const aspects = useAspects();
  const create = useCreateStatus();
  const limits = useLimits();
  const maxLength = limits.maxPostLength;
  const maxMedia = limits.maxMediaAttachments;
  const ids = { text: useId(), counter: useId(), warning: useId(), error: useId() };
  const ownTextarea = useRef<HTMLTextAreaElement>(null);
  const textarea = textareaRef ?? ownTextarea;
  const fileInput = useRef<HTMLInputElement>(null);

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
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [editingAlt, setEditingAlt] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  // Free object URLs of local previews when the composer goes away.
  const mediaRef = useRef(media);
  mediaRef.current = media;
  useEffect(
    () => () => {
      for (const item of mediaRef.current)
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    },
    [],
  );

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
  const uploading = media.some((item) => item.state === 'uploading');
  const serverErrors = fieldErrorsFrom(create.error);
  const allErrors = { ...serverErrors, ...errors };

  const updateItem = (key: string, patch: Partial<MediaItem>) =>
    setMedia((items) => items.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    setMediaError(null);
    const room = maxMedia - media.length;
    const list = [...files];
    if (list.length > room) setMediaError(t('composer.media.tooMany', { max: maxMedia }));
    for (const file of list.slice(0, Math.max(0, room))) {
      const kind = file.type.startsWith('image/')
        ? 'image'
        : file.type.startsWith('video/')
          ? 'video'
          : file.type.startsWith('audio/')
            ? 'audio'
            : null;
      if (!kind || !limits.acceptedMediaTypes.includes(file.type)) {
        setMediaError(t('composer.media.unsupported', { name: file.name }));
        continue;
      }
      const limit = kind === 'image' ? limits.maxImageBytes : limits.maxVideoBytes;
      if (file.size > limit) {
        setMediaError(
          t('composer.media.tooLarge', { name: file.name, size: Math.round(limit / 1024 / 1024) }),
        );
        continue;
      }
      mediaKey += 1;
      const key = `m${mediaKey}`;
      const previewUrl = kind === 'image' ? URL.createObjectURL(file) : null;
      setMedia((items) => [
        ...items,
        {
          key,
          name: file.name,
          kind,
          previewUrl,
          state: 'uploading',
          attachment: null,
          description: '',
          error: null,
        },
      ]);
      social.uploadMedia(file).then(
        (attachment) => updateItem(key, { state: 'ready', attachment }),
        (error: unknown) => updateItem(key, { state: 'error', error }),
      );
    }
  };

  const removeItem = (key: string) => {
    setMedia((items) => {
      const item = items.find((i) => i.key === key);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return items.filter((i) => i.key !== key);
    });
    if (editingAlt === key) setEditingAlt(null);
  };

  const reset = () => {
    for (const item of media) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    setContent('');
    setSummary('');
    setWarningOpen(false);
    setSensitive(false);
    setMedia([]);
    setEditingAlt(null);
    setErrors({});
    setMediaError(null);
    setPoll(null);
  };

  const validate = (): Record<string, string> => {
    const found: Record<string, string> = {};
    const ready = media.filter((item) => item.state === 'ready');
    if (!content.trim() && ready.length === 0)
      found.content = poll ? t('poll.errors.question') : t('composer.errors.empty');
    if (poll) Object.assign(found, validatePoll(poll, t));
    if (length > maxLength) found.content = t('composer.errors.tooLong', { max: maxLength });
    if (!lockedAudience && audience.visibility === 'limited' && audience.aspectIds.length === 0)
      found.aspectIds = t('composer.errors.aspectsRequired');
    if (media.some((item) => item.state === 'error'))
      found.media = t('composer.errors.mediaFailed');
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
    const ready = media.filter(
      (item): item is MediaItem & { attachment: MediaAttachment } => item.attachment !== null,
    );
    setPreparing(true);
    try {
      // Alt text edited after the upload is saved before the post refers to the media.
      await Promise.all(
        ready
          .filter((item) => item.description.trim() !== item.attachment.description)
          .map((item) => social.updateMedia(item.attachment.id, item.description.trim())),
      );
    } catch (error) {
      setPreparing(false);
      setMediaError(errorMessage(error));
      return;
    }
    setPreparing(false);

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
      className={cx(
        'rounded-2xl border border-border bg-surface',
        compact ? 'p-3' : 'p-4 shadow-sm',
      )}
    >
      <div className="flex gap-3">
        {!compact && <Avatar account={user.account} size="md" className="hidden sm:inline-flex" />}
        <div className="min-w-0 flex-1 space-y-3">
          {header}
          {replyTo && lockedAudience && (
            <p className="flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
              <WarningIcon size={16} className="shrink-0" />
              {t('composer.privateReply')}
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

          <div>
            <label htmlFor={ids.text} className="sr-only">
              {replyTo ? t('composer.replyLabel') : t('composer.label')}
            </label>
            <textarea
              id={ids.text}
              ref={textarea}
              rows={compact ? 3 : 4}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={replyTo ? t('composer.replyPlaceholder') : t('composer.placeholder')}
              aria-invalid={allErrors.content ? true : undefined}
              aria-describedby={cx(ids.counter, allErrors.content && ids.error) || undefined}
              className="block w-full resize-y border-0 bg-transparent p-0 text-base placeholder:text-fg-muted focus:ring-0 focus-visible:outline-none"
            />
            {allErrors.content && (
              <p id={ids.error} className="mt-1 text-sm text-danger">
                {allErrors.content}
              </p>
            )}
          </div>

          {media.length > 0 && (
            <ul
              className="grid grid-cols-2 gap-2 sm:grid-cols-4"
              aria-label={t('composer.media.list')}
            >
              {media.map((item, index) => (
                <li key={item.key} className="space-y-1">
                  <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-surface-muted">
                    {item.previewUrl ? (
                      <img
                        src={item.previewUrl}
                        alt={item.description || t('composer.media.preview', { number: index + 1 })}
                        className="size-full object-cover"
                      />
                    ) : (
                      <span className="flex size-full items-center justify-center p-2 text-center text-xs break-all text-fg-muted">
                        {item.name}
                      </span>
                    )}
                    {item.state === 'uploading' && (
                      <span className="absolute inset-0 flex items-center justify-center bg-surface/70">
                        <Spinner />
                        <span className="sr-only">{t('composer.media.uploading')}</span>
                      </span>
                    )}
                    {item.state === 'error' && (
                      <span className="absolute inset-x-0 bottom-0 bg-danger px-1 py-0.5 text-center text-xs text-white">
                        {errorMessage(item.error)}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeItem(item.key)}
                      aria-label={t('composer.media.remove', { name: item.name })}
                      className="absolute top-1 right-1 inline-flex size-7 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black focus-ring"
                    >
                      <CloseIcon size={14} />
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={item.state !== 'ready'}
                    aria-expanded={editingAlt === item.key}
                    onClick={() => setEditingAlt(editingAlt === item.key ? null : item.key)}
                    className={cx(
                      'w-full rounded-md px-2 py-1 text-xs font-medium focus-ring disabled:opacity-50',
                      item.description.trim()
                        ? 'bg-success-soft text-success'
                        : 'bg-surface-muted text-fg-muted hover:text-fg',
                    )}
                  >
                    {item.description.trim()
                      ? t('composer.media.altSet')
                      : t('composer.media.addAlt', { number: index + 1 })}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {media.map((item, index) =>
            editingAlt === item.key ? (
              <AltEditor
                key={item.key}
                number={index + 1}
                value={item.description}
                onChange={(description) => updateItem(item.key, { description })}
                onDone={() => setEditingAlt(null)}
              />
            ) : null,
          )}

          {(mediaError || allErrors.media) && <Alert>{mediaError ?? allErrors.media}</Alert>}

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
          {audience.visibility === 'direct' && !lockedAudience && (
            <p className="text-xs text-fg-muted">{t('composer.directHint')}</p>
          )}

          <Alert>{generalError}</Alert>

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <input
              ref={fileInput}
              type="file"
              accept={limits.acceptedMediaTypes.join(',')}
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                addFiles(event.target.files);
                event.target.value = '';
              }}
              data-testid="composer-file-input"
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={media.length >= maxMedia || poll !== null}
              aria-label={t('composer.media.add')}
              title={poll ? t('poll.editor.noMediaWithPoll') : t('composer.media.add')}
              className="inline-flex size-9 items-center justify-center rounded-full text-fg-muted hover:bg-surface-muted hover:text-fg focus-ring disabled:opacity-40"
            >
              <ImageIcon />
            </button>
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

function AltEditor({
  number,
  value,
  onChange,
  onDone,
}: {
  number: number;
  value: string;
  onChange: (value: string) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface-muted p-3">
      <label htmlFor={id} className="block text-sm font-medium">
        {t('composer.media.altLabel', { number })}
      </label>
      <textarea
        id={id}
        // biome-ignore lint/a11y/noAutofocus: opened on request to edit this description
        autoFocus
        rows={3}
        maxLength={MAX_DESCRIPTION}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('composer.media.altPlaceholder')}
        className="input-base"
      />
      <div className="flex items-center justify-between text-xs text-fg-muted">
        <span>{t('composer.media.altHint')}</span>
        <Button variant="secondary" className="min-h-8 px-3 py-1" onClick={onDone}>
          {t('common.done')}
        </Button>
      </div>
    </div>
  );
}
