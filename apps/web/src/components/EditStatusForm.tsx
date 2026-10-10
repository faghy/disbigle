import type { Status } from '@disbigle/shared';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, fieldErrorsFrom } from '../api/errors.ts';
import { useEditStatus } from '../api/mutations.ts';
import { useLimits } from '../api/queries.ts';
import { Alert, Button, cx } from './ui.tsx';

/** Text of server HTML, keeping paragraph and line breaks (fallback when no source is sent). */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(
    html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p>/gi, '\n\n'),
    'text/html',
  );
  return doc.body.textContent ?? '';
}

/** Inline editor for one of your posts: text, content warning and the sensitive flag. */
export function EditStatusForm({ status, onDone }: { status: Status; onDone: () => void }) {
  const { t } = useTranslation();
  const limits = useLimits();
  const edit = useEditStatus();
  const ids = { text: useId(), counter: useId(), warning: useId(), error: useId() };
  const [content, setContent] = useState(status.source ?? htmlToText(status.content));
  const [summary, setSummary] = useState(status.summary);
  const [warningOpen, setWarningOpen] = useState(status.summary.length > 0);
  const [sensitive, setSensitive] = useState(status.sensitive);
  const [problem, setProblem] = useState<string | null>(null);
  const remaining = limits.maxPostLength - content.length;

  const save = () => {
    if (edit.isPending) return;
    if (!content.trim() && status.media.length === 0) {
      setProblem(t('composer.errors.empty'));
      return;
    }
    if (remaining < 0) return;
    setProblem(null);
    edit.mutate(
      {
        id: status.id,
        body: {
          content,
          summary: warningOpen ? summary.trim() : '',
          sensitive: status.media.length > 0 && sensitive,
        },
      },
      { onSuccess: onDone },
    );
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save();
  };
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
          // biome-ignore lint/a11y/noAutofocus: opened on request to edit this post
          autoFocus
          rows={4}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              save();
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
      <Alert>
        {edit.error && !fieldErrorsFrom(edit.error).content ? errorMessage(edit.error) : null}
      </Alert>
      <div className="flex flex-wrap items-center gap-2">
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
        {status.media.length > 0 && (
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
          <Button type="submit" loading={edit.isPending} disabled={remaining < 0}>
            {t('edit.save')}
          </Button>
        </div>
      </div>
    </form>
  );
}
