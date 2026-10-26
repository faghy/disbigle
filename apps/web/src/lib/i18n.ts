import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import es from '../locales/es.json';
import it from '../locales/it.json';

export const languages = ['en', 'it', 'es'] as const;
export type Language = (typeof languages)[number];

const STORAGE_KEY = 'disbigle.language';

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (languages as readonly string[]).includes(value);
}

/** Saved choice of a signed-out visitor, else the browser language when supported, else English. */
export function detectLanguage(): Language {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (isLanguage(saved)) return saved;
  } catch {
    // Storage can be unavailable (privacy mode); fall through to the browser language.
  }
  const preferred = globalThis.navigator?.languages ?? [globalThis.navigator?.language ?? 'en'];
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLanguage(base)) return base;
  }
  return 'en';
}

/** Switches the interface language; `remember` keeps the choice for signed-out visits. */
export async function setLanguage(language: Language, { remember = false } = {}) {
  if (remember) {
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // Ignore: the choice simply will not survive a reload.
    }
  }
  if (i18n.language !== language) await i18n.changeLanguage(language);
}

export function currentLanguage(): Language {
  return isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'en';
}

i18n.on('languageChanged', (language) => {
  if (typeof document !== 'undefined') document.documentElement.lang = language;
});

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, it: { translation: it }, es: { translation: es } },
  lng: detectLanguage(),
  fallbackLng: 'en',
  supportedLngs: languages,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
