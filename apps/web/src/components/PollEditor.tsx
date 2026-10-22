import { MAX_POLL_OPTIONS, type Poll } from '@disbigle/shared';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { CloseIcon } from './icons.tsx';
import { Button, cx } from './ui.tsx';

export const MIN_POLL_OPTIONS = 2;
export const MAX_OPTION_LENGTH = 100;

/** Durations offered in the composer, in seconds (the server accepts 5 minutes to 30 days). */
export const pollDurations = [
  { seconds: 300, key: 'm5' },
  { seconds: 1800, key: 'm30' },
  { seconds: 3600, key: 'h1' },
  { seconds: 21_600, key: 'h6' },
  { seconds: 86_400, key: 'd1' },
  { seconds: 259_200, key: 'd3' },
  { seconds: 604_800, key: 'd7' },
] as const;

export interface PollDraft {
  options: { key: number; text: string }[];
  expiresIn: number;
  multiple: boolean;
}

let optionKey = 0;
const newOption = (text = '') => {
  optionKey += 1;
  return { key: optionKey, text };
};

export function emptyPoll(): PollDraft {
  return { options: [newOption(), newOption()], expiresIn: 86_400, multiple: false };
}

/**
 * A draft of an existing poll. The duration is the shortest offered one covering the time left
 * (a day for a poll that already closed).
 */
export function pollDraftOf(poll: Poll): PollDraft {
  const left = poll.expiresAt ? (Date.parse(poll.expiresAt) - Date.now()) / 1000 : 0;
  const duration =
    left > 0
      ? (pollDurations.find((d) => d.seconds >= left) ?? pollDurations[pollDurations.length - 1])
      : pollDurations.find((d) => d.seconds === 86_400);
  return {
    options: poll.options.map((option) => newOption(option.title)),
    expiresIn: duration?.seconds ?? 86_400,
    multiple: poll.multiple,
  };
}

/** Client-side checks; error keys follow the server's paths (`poll.options.1`). */
export function validatePoll(poll: PollDraft, t: (key: string) => string): Record<string, string> {
  const found: Record<string, string> = {};
  const seen = new Map<string, number>();
  poll.options.forEach((option, index) => {
    const text = option.text.trim().toLowerCase();
    if (!text) found[`poll.options.${index}`] = t('poll.errors.optionRequired');
    else if (seen.has(text)) found[`poll.options.${index}`] = t('poll.errors.duplicate');
    else seen.set(text, index);
  });
  return found;
}

export function PollEditor({
  value,
  onChange,
  errors,
}: {
  value: PollDraft;
  onChange: (value: PollDraft) => void;
  errors: Record<string, string>;
}) {
  const { t } = useTranslation();
  const baseId = useId();
  const setOption = (key: number, text: string) =>
    onChange({
      ...value,
      options: value.options.map((option) => (option.key === key ? { ...option, text } : option)),
    });

  return (
    <fieldset className="space-y-3 rounded-xl border border-border p-3">
      <legend className="px-1 text-sm font-semibold">{t('poll.editor.legend')}</legend>
      <ol className="space-y-2">
        {value.options.map((option, index) => {
          const id = `${baseId}-option-${option.key}`;
          const error = errors[`poll.options.${index}`];
          return (
            <li key={option.key}>
              <div className="flex items-center gap-2">
                <label htmlFor={id} className="sr-only">
                  {t('poll.editor.option', { number: index + 1 })}
                </label>
                <input
                  id={id}
                  className="input-base"
                  maxLength={MAX_OPTION_LENGTH}
                  placeholder={t('poll.editor.option', { number: index + 1 })}
                  value={option.text}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${id}-error` : undefined}
                  onChange={(event) => setOption(option.key, event.target.value)}
                />
                <button
                  type="button"
                  disabled={value.options.length <= MIN_POLL_OPTIONS}
                  onClick={() =>
                    onChange({
                      ...value,
                      options: value.options.filter((o) => o.key !== option.key),
                    })
                  }
                  aria-label={t('poll.editor.removeOption', { number: index + 1 })}
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-surface-muted hover:text-fg focus-ring disabled:invisible"
                >
                  <CloseIcon size={16} />
                </button>
              </div>
              {error && (
                <p id={`${id}-error`} className="mt-1 text-sm text-danger">
                  {error}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {errors.poll && <p className="text-sm text-danger">{errors.poll}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          className="min-h-9 px-3 py-1"
          disabled={value.options.length >= MAX_POLL_OPTIONS}
          onClick={() => onChange({ ...value, options: [...value.options, newOption()] })}
        >
          {t('poll.editor.addOption')}
        </Button>
        <div className="flex items-center gap-2">
          <label htmlFor={`${baseId}-duration`} className="text-sm text-fg-muted">
            {t('poll.editor.duration')}
          </label>
          <select
            id={`${baseId}-duration`}
            className="input-base w-auto py-1.5"
            value={value.expiresIn}
            onChange={(event) => onChange({ ...value, expiresIn: Number(event.target.value) })}
          >
            {pollDurations.map((duration) => (
              <option key={duration.seconds} value={duration.seconds}>
                {t(`poll.durations.${duration.key}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <fieldset>
        <legend className="sr-only">{t('poll.editor.kind')}</legend>
        <div className="inline-flex rounded-lg border border-border p-0.5">
          {[false, true].map((multiple) => (
            <label
              key={String(multiple)}
              className={cx(
                'cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
                value.multiple === multiple ? 'bg-accent-soft text-accent' : 'text-fg-muted',
              )}
            >
              <input
                type="radio"
                name={`${baseId}-kind`}
                className="sr-only"
                checked={value.multiple === multiple}
                onChange={() => onChange({ ...value, multiple })}
              />
              {multiple ? t('poll.editor.multiple') : t('poll.editor.single')}
            </label>
          ))}
        </div>
      </fieldset>
    </fieldset>
  );
}
