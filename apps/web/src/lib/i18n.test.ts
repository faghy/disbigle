import { afterEach, describe, expect, it } from 'vitest';
import { detectLanguage } from './i18n.ts';

afterEach(() => {
  window.history.replaceState(null, '', '/');
  localStorage.clear();
});

describe('interface language', () => {
  it('follows ?lang= from the website, and remembers it', () => {
    window.history.replaceState(null, '', '/register?move=1&lang=es');
    expect(detectLanguage()).toBe('es');
    window.history.replaceState(null, '', '/register');
    expect(detectLanguage()).toBe('es');
  });

  it('ignores languages it does not have', () => {
    localStorage.setItem('disbigle.language', 'it');
    window.history.replaceState(null, '', '/?lang=xx');
    expect(detectLanguage()).toBe('it');
  });
});
