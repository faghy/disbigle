import type { EditPostRequest, Status } from '@disbigle/shared';
import { type FormEvent, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, fieldErrorsFrom } from '../api/errors.ts';
import { useEditStatus } from '../api/mutations.ts';
import { useLimits } from '../api/queries.ts';
import { EmojiButton } from './EmojiPicker.tsx';
import { PollIcon } from './icons.tsx';
import { AddMediaButton, MediaList, useMediaItems } from './MediaEditor.tsx';
import { emptyPoll, type PollDraft, PollEditor, pollDraftOf, validatePoll } from './PollEditor.tsx';
import { Alert, Button, cx } from './ui.tsx';

/** Text of server HTML, keeping paragraph and line breaks (fallback when no source is sent). */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(
    html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p>/gi, '\n\n'),
    'text/html',
  );
  return doc.body.textContent ?? '';
}

/** Inline editor for one of your posts: text, content warning, attachments and poll. */
export function EditStatusForm({ status, onDone }: { status: Status; onDone: () => void }) {
  const { t } = useTranslation();
  const limits = useLimits();
  const edit = useEditStatus();
  const ids = { text: useId(), counter: useId(), warning: useId(), error: useId() };
  const [content, setContent] = useState(status.source ?? htmlToText(status.content));
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [summary, setSummary] = useState(status.summary);
  const [warningOpen, setWarningOpen] = useState(status.summary.length > 0);
  const [sensitive, setSensitive] = useState(status.sensitive);
  const mediaItems = useMediaItems(status.media);
  const [poll, setPoll] = useState<PollDraft | null>(() =>
    status.poll ? pollDraftOf(status.poll) : null,
  );
  // Sent only when changed: an untouched poll keeps its votes and closing time.
  const [pollTouched, setPollTouched] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pollErrors, setPollErrors] = useState<Record<string, string>>({});
  const [preparing, setPreparing] = useState(false);
  const remaining = limits.maxPostLength - content.length;
  const hasMedia = mediaItems.media.length > 0;
  const changePoll = (next: PollDraft | null) => {
    setPoll(next);
    setPollTouched(true);
    setPollErrors({});
  };

  const save = async () => {
    if (edit.isPending || preparing || mediaItems.uploading) return;
    if (!content.trim() && mediaItems.ready.length === 0 && !poll) {
      setProblem(t('composer.errors.empty'));
      return;
    }
    if (remaining < 0) return;
    const found = poll && pollTouched ? validatePoll(poll, t) : {};
    if (mediaItems.failed) found.media = t('composer.errors.mediaFailed');
    setPollErrors(found);
    setProblem(null);
    if (Object.keys(found).length > 0) return;
    setPreparing(true);
    const saved = await mediaItems.saveDescriptions();
    setPreparing(false);
    if (!saved) return;
    const body: EditPostRequest = {
      content,
      summary: warningOpen ? summary.trim() : '',
      sensitive: mediaItems.ready.length > 0 && sensitive,
      mediaIds: mediaItems.ready.map((item) => item.attachment.id),
      ...(pollTouched
        ? {
            poll: poll
              ? {
                  options: poll.options.map((option) => option.text.trim()),
                  expiresIn: poll.expiresIn,
                  multiple: poll.multiple,
                }
              : null,
          }
        : {}),
    };
    edit.mutate({ id: status.id, body }, { onSuccess: onDone });
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void save();
  };
  const serverErrors = fieldErrorsFrom(edit.error);
  const allErrors = { ...serverErrors, ...pollErrors };
  const hadVotes = (status.poll?.votersCount ?? 0) > 0;
  const contentError = problem ?? fieldErrorsFrom(edit.error).content ?? null;

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label={t('edit.label')}
      className="mt-2 space-y-3 rounded-xl border border-border bg-surface-muted/50 p-3"
    >
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
          {t('edit.label')}
        </label>
        <textarea
          id={ids.text}
          ref={textarea}
          // biome-ignore lint/a11y/noAutofocus: opened on request to edit this post
          autoFocus
          rows={4}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void save();
            } else if (event.key === 'Escape') {
              onDone();
            }
          }}
          aria-invalid={contentError ? true : undefined}
          aria-describedby={cx(ids.counter, contentError && ids.error) || undefined}
          className="input-base resize-y"
        />
        {contentError && (
          <p id={ids.error} className="mt-1 text-sm text-danger">
            {contentError}
          </p>
        )}
      </div>
      <MediaList items={mediaItems} error={allErrors.media} />
      {poll && (
        <>
          <PollEditor value={poll} onChange={changePoll} errors={allErrors} />
          {hadVotes && <p className="text-xs text-fg-muted">{t('edit.pollReset')}</p>}
        </>
      )}
      <Alert>
        {edit.error &&
        !serverErrors.content &&
        !Object.keys(serverErrors).some((k) => k.startsWith('poll'))
          ? errorMessage(edit.error)
          : null}
      </Alert>
      <div className="flex flex-wrap items-center gap-2">
        <AddMediaButton
          items={mediaItems}
          disabled={poll !== null}
          title={poll ? t('poll.editor.noMediaWithPoll') : undefined}
        />
        <EmojiButton textarea={textarea} onChange={setContent} />
        <button
          type="button"
          aria-pressed={poll !== null}
          disabled={hasMedia}
          onClick={() => changePoll(poll ? null : emptyPoll())}
          aria-label={t('poll.editor.add')}
          title={hasMedia ? t('poll.editor.noPollWithMedia') : t('poll.editor.add')}
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
          className={cx(
            'inline-flex h-9 items-center rounded-full px-2.5 text-xs font-bold focus-ring',
            warningOpen ? 'bg-accent-soft text-accent' : 'text-fg-muted hover:bg-surface-muted',
          )}
        >
          <span aria-hidden="true">CW</span>
          <span className="sr-only">{t('composer.warning.toggle')}</span>
        </button>
        {hasMedia && (
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-fg-muted">
            <input
              type="checkbox"
              className="size-4 accent-accent"
              checked={sensitive}
              onChange={(event) => setSensitive(event.target.checked)}
            />
            {t('composer.sensitive')}
          </label>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span
            id={ids.counter}
            className={cx('text-sm tabular-nums', remaining < 0 ? 'text-danger' : 'text-fg-muted')}
          >
            <span aria-hidden="true">{remaining}</span>
            <span className="sr-only">{t('composer.remaining', { count: remaining })}</span>
          </span>
          <Button variant="ghost" onClick={onDone}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            loading={edit.isPending || preparing}
            disabled={remaining < 0 || mediaItems.uploading}
          >
            {t('edit.save')}
          </Button>
        </div>
      </div>
    </form>
  );
}
