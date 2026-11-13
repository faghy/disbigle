import { describe, expect, it } from 'vitest';
import { mapLocale } from '../src/text.ts';

describe('mapLocale', () => {
  it('keeps the languages Disbigle ships and falls back to English', () => {
    expect(mapLocale('de')).toBe('de');
    expect(mapLocale('zh_CN')).toBe('zh');
    expect(mapLocale('fr-CA')).toBe('fr');
    expect(mapLocale('pt-BR')).toBe('en');
    expect(mapLocale(null)).toBe('en');
  });
});
