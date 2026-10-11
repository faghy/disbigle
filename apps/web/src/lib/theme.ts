import { useSyncExternalStore } from 'react';

export const themes = ['light', 'dark', 'system'] as const;
export type Theme = (typeof themes)[number];

const STORAGE_KEY = 'disbigle-theme';
const THEME_COLORS = { light: '#6d4aff', dark: '#19181d' };
const listeners = new Set<() => void>();

const isTheme = (value: unknown): value is Theme => themes.includes(value as Theme);

/** The chosen theme; light unless the user picked another one on this device. */
export function getTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : 'light';
  } catch {
    return 'light';
  }
}

const systemDark = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

/** Applies a theme to the page: `data-theme` on <html> (see styles.css) and the browser bar colour. */
export function applyTheme(theme: Theme = getTheme()): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const dark = theme === 'dark' || (theme === 'system' && systemDark());
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = dark ? THEME_COLORS.dark : THEME_COLORS.light;
  }
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  applyTheme(theme);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, () => 'light');
}
