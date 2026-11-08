import { describe, expect, it } from 'vitest';
import { applyFormat } from './markdownFormat.ts';

const p = { text: 'text', link: 'https://' };

describe('formatting buttons', () => {
  it('wraps the selection, or a placeholder, and unwraps it again', () => {
    const bold = applyFormat('ciao mondo', 5, 10, 'bold', p);
    expect(bold).toEqual({ text: 'ciao **mondo**', start: 7, end: 12 });
    expect(applyFormat(bold.text, bold.start, bold.end, 'bold', p).text).toBe('ciao mondo');
    expect(applyFormat('ciao ', 5, 5, 'italic', p)).toEqual({
      text: 'ciao *text*',
      start: 6,
      end: 10,
    });
    expect(applyFormat('x', 0, 1, 'strike', p).text).toBe('~~x~~');
  });

  it('prefixes every selected line, numbering lists, and toggles back', () => {
    const list = applyFormat('uno\ndue\ntre', 0, 11, 'numbered', p);
    expect(list.text).toBe('1. uno\n2. due\n3. tre');
    expect(applyFormat(list.text, 0, list.text.length, 'numbered', p).text).toBe('uno\ndue\ntre');
    // A heading replaces another block format of the line.
    expect(applyFormat('> titolo', 3, 3, 'heading', p).text).toBe('## titolo');
    expect(applyFormat('prima\nseconda', 7, 7, 'quote', p).text).toBe('prima\n> seconda');
  });

  it('makes a link and selects its address to type over', () => {
    const link = applyFormat('vedi qui', 5, 8, 'link', p);
    expect(link.text).toBe('vedi [qui](https://)');
    expect(link.text.slice(link.start, link.end)).toBe('https://');
  });
});
