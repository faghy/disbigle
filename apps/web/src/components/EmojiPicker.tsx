import { type RefObject, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type Emoji,
  type EmojiSet,
  insertAt,
  loadEmoji,
  recentEmoji,
  rememberEmoji,
  savedTone,
  saveTone,
  searchEmoji,
  withTone,
} from '../lib/emoji.ts';
import { currentLanguage } from '../lib/i18n.ts';
import { SmileIcon } from './icons.tsx';
import { cx } from './ui.tsx';

/** Shown on each category tab. */
const GROUP_ICONS: Record<number, string> = {
  0: '😀',
  1: '👋',
  3: '🐻',
  4: '🍝',
  5: '✈️',
  6: '⚽',
  7: '💡',
  8: '❤️',
  9: '🏳️',
};

const TONE_SWATCHES = ['✋', '✋🏻', '✋🏼', '✋🏽', '✋🏾', '✋🏿'];

/**
 * The emoji button of a text field: a panel with every Unicode emoji by category, search in the
 * interface language, recent ones and skin tones. The choice goes where the cursor is.
 */
export function EmojiButton({
  textarea,
  onChange,
  disabled = false,
}: {
  textarea: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  /** Called with the field's new value. */
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    // Esc closes it from the text too, where the cursor goes back after each pick.
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const pick = (emoji: string) => {
    const field = textarea.current;
    if (!field) return;
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    const next = insertAt(field.value, emoji, start, end);
    onChange(next.value);
    // After React has written the new value: the cursor goes right after the emoji.
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(next.cursor, next.cursor);
    });
  };

  return (
    <div ref={wrapper} className="relative">
      <button
        ref={button}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={t('emoji.button')}
        title={t('emoji.button')}
        onClick={() => setOpen((value) => !value)}
        className={cx(
          'inline-flex size-9 items-center justify-center rounded-full focus-ring disabled:opacity-40',
          open
            ? 'bg-accent-soft text-accent'
            : 'text-fg-muted hover:bg-surface-muted hover:text-fg',
        )}
      >
        <SmileIcon />
      </button>
      {open && (
        <EmojiPanel
          id={panelId}
          onPick={pick}
          onClose={() => {
            setOpen(false);
            button.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function EmojiPanel({
  id,
  onPick,
  onClose,
}: {
  id: string;
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const language = currentLanguage();
  const [set, setSet] = useState<EmojiSet | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [tone, setTone] = useState(savedTone);
  const [recent, setRecent] = useState(recentEmoji);
  const [group, setGroup] = useState<number | 'recent'>(() =>
    recentEmoji().length > 0 ? 'recent' : 0,
  );
  const search = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current = true;
    setFailed(false);
    loadEmoji(language).then(
      (loaded) => current && setSet(loaded),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [language]);

  useEffect(() => {
    search.current?.focus();
  }, []);

  const results = useMemo(
    () => (set && query.trim() ? searchEmoji(set.emojis, query) : null),
    [set, query],
  );
  const shown: Emoji[] = useMemo(() => {
    if (!set) return [];
    if (results) return results;
    if (group === 'recent') return [];
    return set.emojis.filter((e) => e.group === group);
  }, [set, results, group]);

  const choose = (unicode: string) => {
    setRecent(rememberEmoji(unicode));
    onPick(unicode);
  };

  const groupName =
    results !== null
      ? t('emoji.results')
      : group === 'recent'
        ? t('emoji.recent')
        : (set?.groups.find((g) => g.id === group)?.name ?? '');

  return (
    <div
      id={id}
      role="dialog"
      aria-label={t('emoji.button')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
      className="absolute top-11 left-0 z-30 flex w-[min(22rem,calc(100vw-2rem))] flex-col rounded-2xl border border-border bg-surface shadow-lg"
    >
      <div className="flex items-center gap-2 border-b border-border p-2">
        <input
          ref={search}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('emoji.search')}
          aria-label={t('emoji.search')}
          className="input-base h-9 flex-1 py-1 text-sm"
        />
        <ToneMenu
          tone={tone}
          onChange={(value) => {
            setTone(value);
            saveTone(value);
          }}
        />
      </div>

      {!results && (
        <div
          role="tablist"
          aria-label={t('emoji.categories')}
          className="flex gap-0.5 overflow-x-auto border-b border-border px-1 py-1"
        >
          {recent.length > 0 && (
            <Tab
              selected={group === 'recent'}
              label={t('emoji.recent')}
              onClick={() => setGroup('recent')}
            >
              🕘
            </Tab>
          )}
          {set?.groups.map((g) => (
            <Tab
              key={g.id}
              selected={group === g.id}
              label={g.name}
              onClick={() => {
                setGroup(g.id);
                grid.current?.scrollTo(0, 0);
              }}
            >
              {GROUP_ICONS[g.id] ?? '•'}
            </Tab>
          ))}
        </div>
      )}

      <div ref={grid} className="h-64 overflow-y-auto p-2">
        <p className="px-1 pb-1 text-xs font-bold uppercase tracking-wide text-fg-muted">
          {groupName}
        </p>
        {failed ? (
          <p className="p-3 text-sm text-fg-muted">{t('emoji.failed')}</p>
        ) : !set ? (
          <p className="p-3 text-sm text-fg-muted">{t('common.loading')}</p>
        ) : results?.length === 0 ? (
          <p className="p-3 text-sm text-fg-muted">{t('emoji.noResults')}</p>
        ) : (
          <div className="grid grid-cols-8 gap-0.5">
            {group === 'recent' && !results
              ? recent.map((unicode) => (
                  <Cell
                    key={unicode}
                    emoji={unicode}
                    label={labelOf(set, unicode)}
                    onPick={choose}
                  />
                ))
              : shown.map((emoji) => {
                  const unicode = withTone(emoji, tone);
                  return (
                    <Cell key={emoji.unicode} emoji={unicode} label={emoji.label} onPick={choose} />
                  );
                })}
          </div>
        )}
      </div>
    </div>
  );
}

function labelOf(set: EmojiSet, unicode: string): string {
  return (
    set.emojis.find((e) => e.unicode === unicode || e.skins?.includes(unicode))?.label ?? unicode
  );
}

function Tab({
  selected,
  label,
  onClick,
  children,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cx(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-lg focus-ring',
        selected ? 'bg-accent-soft' : 'hover:bg-surface-muted',
      )}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

function Cell({
  emoji,
  label,
  onPick,
}: {
  emoji: string;
  label: string;
  onPick: (emoji: string) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => onPick(emoji)}
      className="inline-flex aspect-square items-center justify-center rounded-lg text-2xl leading-none hover:bg-surface-muted focus-ring"
    >
      {emoji}
    </button>
  );
}

function ToneMenu({ tone, onChange }: { tone: number; onChange: (tone: number) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label={t('emoji.skinTone')}
        title={t('emoji.skinTone')}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex size-9 items-center justify-center rounded-lg text-xl hover:bg-surface-muted focus-ring"
      >
        {TONE_SWATCHES[tone]}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-10 flex gap-0.5 rounded-xl border border-border bg-surface p-1 shadow-lg">
          {TONE_SWATCHES.map((swatch, index) => (
            <button
              key={swatch}
              type="button"
              aria-pressed={tone === index}
              aria-label={t(`emoji.tones.${index}`)}
              title={t(`emoji.tones.${index}`)}
              onClick={() => {
                onChange(index);
                setOpen(false);
              }}
              className={cx(
                'inline-flex size-9 items-center justify-center rounded-lg text-xl focus-ring',
                tone === index ? 'bg-accent-soft' : 'hover:bg-surface-muted',
              )}
            >
              {swatch}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
