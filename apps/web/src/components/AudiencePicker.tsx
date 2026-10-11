import type { Aspect, Visibility } from '@disbigle/shared';
import { Link } from '@tanstack/react-router';
import { useCallback, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDismiss } from '../lib/dismiss.ts';
import { visibilityIcons, visibilityOrder } from '../lib/visibility.tsx';
import { ChevronDownIcon, CloseIcon } from './icons.tsx';
import { cx } from './ui.tsx';

export interface AudienceValue {
  visibility: Visibility;
  aspectIds: string[];
}

/** "Family, Friends" for the chosen aspects, in the order the user arranged them. */
export function aspectNames(aspects: Aspect[] | undefined, ids: string[]): string[] {
  return (aspects ?? []).filter((aspect) => ids.includes(aspect.id)).map((a) => a.name);
}

/**
 * "Share with" control. Public, unlisted, followers and direct are single choices; "Aspects"
 * opens a multi-select of the user's aspects, diaspora style.
 */
export function AudiencePicker({
  value,
  onChange,
  aspects,
  error,
  disabled = false,
}: {
  value: AudienceValue;
  onChange: (value: AudienceValue) => void;
  aspects: Aspect[] | undefined;
  error?: string | undefined;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const errorId = useId();
  const groupName = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, containerRef, buttonRef);

  const Icon = visibilityIcons[value.visibility];
  const chosen = aspectNames(aspects, value.aspectIds);
  const summary =
    value.visibility === 'limited'
      ? chosen.length > 0
        ? chosen.join(', ')
        : t('composer.audience.chooseAspects')
      : t(`visibility.${value.visibility}.label`);

  const toggleAspect = (id: string, checked: boolean) => {
    const ids = checked
      ? [...value.aspectIds, id]
      : value.aspectIds.filter((aspectId) => aspectId !== id);
    onChange({ visibility: 'limited', aspectIds: ids });
  };

  return (
    <div ref={containerRef} className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={panelId}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cx(
          'inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors focus-ring',
          'disabled:cursor-not-allowed disabled:opacity-70',
          value.visibility === 'limited'
            ? 'border-accent/50 bg-accent-soft text-accent'
            : 'border-border-strong bg-surface hover:bg-surface-muted',
          error && 'border-danger text-danger',
        )}
      >
        <Icon size={16} />
        <span className="shrink-0 text-fg-muted">{t('composer.audience.shareWith')}</span>
        <span className="truncate font-medium">{summary}</span>
        {!disabled && <ChevronDownIcon size={16} className="shrink-0" />}
      </button>
      {error && (
        <p id={errorId} className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}

      <div
        id={panelId}
        hidden={!open}
        className="absolute left-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] sticker-soft rounded-3xl bg-surface p-2"
      >
        <fieldset>
          <legend className="sr-only">{t('composer.audience.legend')}</legend>
          {visibilityOrder.map((visibility) => {
            const OptionIcon = visibilityIcons[visibility];
            const checked = value.visibility === visibility;
            return (
              <label
                key={visibility}
                className={cx(
                  'flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-muted',
                  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
                  checked && 'bg-accent-soft/60',
                )}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={visibility}
                  checked={checked}
                  onChange={() =>
                    onChange({
                      visibility,
                      aspectIds: visibility === 'limited' ? value.aspectIds : [],
                    })
                  }
                  className="sr-only"
                />
                <OptionIcon size={20} className={cx('mt-0.5 shrink-0', checked && 'text-accent')} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {t(`visibility.${visibility}.label`)}
                  </span>
                  <span className="block text-xs text-fg-muted">
                    {t(`visibility.${visibility}.description`)}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>

        {value.visibility === 'limited' && (
          <fieldset className="mt-1 border-t border-border px-1 pt-2">
            <legend className="px-2 pt-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
              {t('composer.audience.aspectsLegend')}
            </legend>
            {aspects && aspects.length > 0 ? (
              <>
                <div className="flex gap-2 px-2 py-1 text-xs">
                  <button
                    type="button"
                    className="rounded font-medium text-accent hover:underline focus-ring"
                    onClick={() =>
                      onChange({ visibility: 'limited', aspectIds: aspects.map((a) => a.id) })
                    }
                  >
                    {t('composer.audience.selectAll')}
                  </button>
                  <button
                    type="button"
                    className="rounded font-medium text-accent hover:underline focus-ring"
                    onClick={() => onChange({ visibility: 'limited', aspectIds: [] })}
                  >
                    {t('composer.audience.selectNone')}
                  </button>
                </div>
                <ul className="max-h-56 overflow-y-auto">
                  {aspects.map((aspect) => (
                    <li key={aspect.id}>
                      <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-muted">
                        <input
                          type="checkbox"
                          className="size-4 accent-accent focus-ring"
                          checked={value.aspectIds.includes(aspect.id)}
                          onChange={(event) => toggleAspect(aspect.id, event.target.checked)}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">{aspect.name}</span>
                        <span className="text-xs text-fg-muted">
                          {t('aspects.memberCount', { count: aspect.memberCount })}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="px-2 py-2 text-sm text-fg-muted">
                {t('composer.audience.noAspects')}{' '}
                <Link to="/aspects" className="font-medium text-accent hover:underline">
                  {t('composer.audience.createAspect')}
                </Link>
              </p>
            )}
          </fieldset>
        )}
        <div className="mt-1 flex justify-end border-t border-border px-1 pt-2">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              buttonRef.current?.focus();
            }}
            className="rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-surface-muted focus-ring"
          >
            {t('common.done')}
          </button>
        </div>
      </div>

      {value.visibility === 'limited' && chosen.length > 0 && !disabled && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={t('composer.audience.chosen')}>
          {(aspects ?? [])
            .filter((aspect) => value.aspectIds.includes(aspect.id))
            .map((aspect) => (
              <li key={aspect.id}>
                <button
                  type="button"
                  onClick={() => toggleAspect(aspect.id, false)}
                  aria-label={t('composer.audience.removeAspect', { name: aspect.name })}
                  className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/20 focus-ring"
                >
                  {aspect.name}
                  <CloseIcon size={12} />
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
