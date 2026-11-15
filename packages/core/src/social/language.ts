import type { eld as Eld } from 'eld/extrasmall';

/** Below this many letters a guess is not worth much ("ok", "grazie!"). */
const MIN_LETTERS = 20;
/** Chinese, Japanese and Korean say a lot in few characters: "你好，最近怎么样？" is a sentence. */
const MIN_CJK = 4;

/**
 * Chinese, Japanese or Korean, told apart by their scripts, for texts mostly written in them:
 * the letter count that guards other languages would leave most of their messages unknown.
 */
function cjkLanguage(text: string, letters: number): string | null {
  const han = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  const kana = text.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0;
  const hangul = text.match(/\p{Script=Hangul}/gu)?.length ?? 0;
  const cjk = han + kana + hangul;
  if (cjk < MIN_CJK || cjk * 2 < letters) return null;
  if (hangul > han + kana) return 'ko';
  if (kana > 0) return 'ja';
  return 'zh';
}

let detector: typeof Eld | null = null;
let loading: Promise<typeof Eld> | null = null;

/** Loads the language detector (about 1 MB of n-grams) on first use. */
export async function loadLanguageDetector(): Promise<void> {
  loading ??= import('eld/extrasmall').then((module) => {
    detector = module.eld;
    return module.eld;
  });
  await loading;
}

/** `it` for `it`, `it-IT` or `it_IT`; null for anything that isn't a language tag. */
export function baseLanguage(tag: string | null | undefined): string | null {
  const base = tag?.trim().toLowerCase().split(/[-_]/)[0];
  return base && /^[a-z]{2,3}$/.test(base) ? base : null;
}

/** The words of a post's HTML: without tags, links, mentions and hashtags. */
export function plainTextForLanguage(html: string): string {
  return html
    .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[#\w]+;/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[@#][\p{L}\p{N}_.@-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The language of a post's text (ISO 639-1), when the detector is loaded and sure enough;
 * null for short or mixed texts.
 */
export function guessLanguage(html: string, summary = ''): string | null {
  if (!detector) return null;
  const text = `${plainTextForLanguage(summary)} ${plainTextForLanguage(html)}`.trim();
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const script = cjkLanguage(text, letters);
  if (script) return script;
  if (letters < MIN_LETTERS) return null;
  const result = detector.detect(text);
  return result.language && result.isReliable() ? result.language : null;
}
