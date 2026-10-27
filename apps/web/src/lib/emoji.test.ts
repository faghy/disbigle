import { beforeEach, describe, expect, it } from 'vitest';
import { insertAt, loadEmoji, recentEmoji, rememberEmoji, searchEmoji, withTone } from './emoji.ts';

describe('emoji', () => {
  beforeEach(() => localStorage.clear());

  it('loads every emoji by category, without the skin-tone components', async () => {
    const set = await loadEmoji('it');
    expect(set.emojis.length).toBeGreaterThan(1800);
    expect(set.groups.map((g) => g.id)).not.toContain(2);
    expect(set.groups[0]?.name).toBe('smileys & emozione');
    expect(set.emojis.some((e) => e.unicode === '🍕')).toBe(true);
  });

  it('finds emoji by name and keyword in the interface language, accents ignored', async () => {
    const it = await loadEmoji('it');
    expect(searchEmoji(it.emojis, 'ciao').map((e) => e.unicode)).toContain('👋');
    expect(searchEmoji(it.emojis, 'caffe').map((e) => e.unicode)).toContain('☕\uFE0F');
    const es = await loadEmoji('es');
    expect(searchEmoji(es.emojis, 'corazon rojo').map((e) => e.unicode)).toContain('❤️');
    expect(searchEmoji(es.emojis, '   ')).toEqual([]);
  });

  it('applies the skin tone only where there is one', async () => {
    const set = await loadEmoji('en');
    const wave = set.emojis.find((e) => e.unicode === '👋');
    const pizza = set.emojis.find((e) => e.unicode === '🍕');
    expect(wave && withTone(wave, 3)).toBe('👋🏽');
    expect(wave && withTone(wave, 0)).toBe('👋');
    expect(pizza && withTone(pizza, 3)).toBe('🍕');
  });

  it('remembers the latest emoji first, without repeats', () => {
    rememberEmoji('😀');
    rememberEmoji('🍕');
    rememberEmoji('😀');
    expect(recentEmoji()).toEqual(['😀', '🍕']);
  });

  it('inserts at the cursor, replacing the selection', () => {
    expect(insertAt('Ciao mondo', '👋 ', 5, 5)).toEqual({ value: 'Ciao 👋 mondo', cursor: 8 });
    expect(insertAt('Ciao mondo', '🌍', 5, 10)).toEqual({ value: 'Ciao 🌍', cursor: 7 });
  });
});
