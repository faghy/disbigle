import type { Language } from './i18n.ts';

/** One emoji of the picker, with its five skin tones when it has them. */
export interface Emoji {
  unicode: string;
  label: string;
  /** Words to search by, in the interface language. */
  tags: string[];
  group: number;
  skins?: string[];
}

export interface EmojiGroup {
  id: number;
  name: string;
}

export interface EmojiSet {
  emojis: Emoji[];
  groups: EmojiGroup[];
}

interface CompactEmoji {
  unicode: string;
  label: string;
  tags?: string[];
  group?: number;
  order?: number;
  skins?: { unicode: string }[];
}

interface Messages {
  groups: { key: string; message: string; order: number }[];
}

// Each language is its own chunk, loaded the first time the picker opens.
const sources: Record<Language, () => Promise<[CompactEmoji[], Messages]>> = {
  en: () =>
    Promise.all([
      import('emojibase-data/en/compact.json').then((m) => m.default as CompactEmoji[]),
      import('emojibase-data/en/messages.json').then((m) => m.default as Messages),
    ]),
  it: () =>
    Promise.all([
      import('emojibase-data/it/compact.json').then((m) => m.default as CompactEmoji[]),
      import('emojibase-data/it/messages.json').then((m) => m.default as Messages),
    ]),
  es: () =>
    Promise.all([
      import('emojibase-data/es/compact.json').then((m) => m.default as CompactEmoji[]),
      import('emojibase-data/es/messages.json').then((m) => m.default as Messages),
    ]),
};

/** Group 2 holds the skin-tone and hair components: not emoji to pick on their own. */
const COMPONENTS = 2;

const loaded = new Map<Language, Promise<EmojiSet>>();

export function loadEmoji(language: Language): Promise<EmojiSet> {
  let set = loaded.get(language);
  if (!set) {
    set = sources[language]().then(([data, messages]) => ({
      emojis: data
        .filter((e) => e.group !== undefined && e.group !== COMPONENTS)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((e) => ({
          unicode: e.unicode,
          label: e.label,
          tags: e.tags ?? [],
          group: e.group ?? 0,
          // The first five skins are the single tones, light to dark (more follow for couples).
          skins:
            e.skins && e.skins.length >= 5 ? e.skins.slice(0, 5).map((s) => s.unicode) : undefined,
        })),
      groups: messages.groups
        .filter((g) => g.order !== COMPONENTS)
        .map((g) => ({ id: g.order, name: g.message })),
    }));
    // A failed download can be tried again next time.
    set.catch(() => loaded.delete(language));
    loaded.set(language, set);
  }
  return set;
}

const fold = (text: string) =>
  text
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

/** Emoji whose name or tags start with every word of the query (accents ignored). */
export function searchEmoji(emojis: Emoji[], query: string, limit = 200): Emoji[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const results: Emoji[] = [];
  for (const emoji of emojis) {
    const haystack = [emoji.label, ...emoji.tags]
      .map(fold)
      .join(' ')
      .split(/[\s:,]+/);
    if (words.every((word) => haystack.some((part) => part.startsWith(word)))) {
      results.push(emoji);
      if (results.length >= limit) break;
    }
  }
  return results;
}

/** The emoji with the chosen skin tone (0 = default yellow, 1–5 light to dark). */
export function withTone(emoji: Emoji, tone: number): string {
  return tone > 0 && emoji.skins ? (emoji.skins[tone - 1] ?? emoji.unicode) : emoji.unicode;
}

const RECENT_KEY = 'disbigle.emoji.recent';
const TONE_KEY = 'disbigle.emoji.tone';
const RECENT_MAX = 32;

export function recentEmoji(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((e): e is string => typeof e === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberEmoji(unicode: string): string[] {
  const next = [unicode, ...recentEmoji().filter((e) => e !== unicode)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: the recent list lasts until the page is closed.
  }
  return next;
}

export function savedTone(): number {
  try {
    const tone = Number(localStorage.getItem(TONE_KEY));
    return Number.isInteger(tone) && tone >= 0 && tone <= 5 ? tone : 0;
  } catch {
    return 0;
  }
}

export function saveTone(tone: number) {
  try {
    localStorage.setItem(TONE_KEY, String(tone));
  } catch {
    // Not remembered: the default tone comes back next time.
  }
}

/**
 * Puts `text` where the cursor is in a text field (replacing any selection) and returns the new
 * value and the cursor position after it.
 */
export function insertAt(value: string, text: string, start: number, end: number) {
  const before = value.slice(0, start);
  const after = value.slice(end);
  return { value: before + text + after, cursor: start + text.length };
}
