import { useSyncExternalStore } from 'react';

/** Light, dark, black (pure black for OLED screens) or the system's choice. */
export const themes = ['light', 'dark', 'black', 'system'] as const;
export type Theme = (typeof themes)[number];

/** Accent colours (styles.css, `data-accent`); `orange` is Disbigle's own. */
export const accents = [
  'orange',
  'red',
  'pink',
  'purple',
  'blue',
  'teal',
  'green',
  'grey',
] as const;
export type Accent = (typeof accents)[number];

const STORAGE_KEY = 'disbigle-theme';
const ACCENT_KEY = 'disbigle-accent';
const THEME_COLORS = { light: '#cf3200', dark: '#170e0b', black: '#000000' };
const listeners = new Set<() => void>();

const isTheme = (value: unknown): value is Theme => themes.includes(value as Theme);
const isAccent = (value: unknown): value is Accent => accents.includes(value as Accent);

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
}

/** The chosen theme; light unless the user picked another one on this device. */
export function getTheme(): Theme {
  const stored = read(STORAGE_KEY);
  return isTheme(stored) ? stored : 'light';
}

/** The chosen accent colour; Disbigle orange unless the user picked another one. */
export function getAccent(): Accent {
  const stored = read(ACCENT_KEY);
  return isAccent(stored) ? stored : 'orange';
}

const systemDark = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

/**
 * Applies theme and accent to the page: `data-theme` and `data-accent` on <html> (see
 * styles.css) and the browser bar colour.
 */
export function applyTheme(theme: Theme = getTheme(), accent: Accent = getAccent()): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  if (accent === 'orange') delete root.dataset.accent;
  else root.dataset.accent = accent;
  const color =
    theme === 'black'
      ? THEME_COLORS.black
      : theme === 'dark' || (theme === 'system' && systemDark())
        ? THEME_COLORS.dark
        : THEME_COLORS.light;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = color;
  }
}

const changed = () => {
  applyTheme();
  for (const listener of listeners) listener();
};

export function setTheme(theme: Theme): void {
  write(STORAGE_KEY, theme);
  changed();
}

export function setAccent(accent: Accent): void {
  write(ACCENT_KEY, accent);
  changed();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, () => 'light');
}

export function useAccent(): Accent {
  return useSyncExternalStore(subscribe, getAccent, () => 'orange');
}
