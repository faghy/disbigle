import { describe, expect, it } from 'vitest';
import { bioToHtml, parseHandle } from '../src/index.ts';

describe('parseHandle', () => {
  it('accepts the usual handle spellings', () => {
    for (const input of [
      'alice@example.org',
      '@alice@example.org',
      'acct:alice@example.org',
      ' @alice@Example.ORG ',
    ]) {
      expect(parseHandle(input)).toEqual({ username: 'alice', domain: 'example.org' });
    }
    expect(parseHandle('bob@127.0.0.1:3000')).toEqual({
      username: 'bob',
      domain: '127.0.0.1:3000',
    });
  });

  it('rejects things that are not handles', () => {
    for (const input of ['alice', 'https://example.org/@alice', 'a@b@c', ''])
      expect(parseHandle(input)).toBeNull();
  });
});

describe('bioToHtml', () => {
  it('escapes HTML and keeps paragraphs and line breaks', () => {
    expect(bioToHtml('Ciao <b>!</b>\nseconda riga\n\nnuovo paragrafo')).toBe(
      '<p>Ciao &lt;b&gt;!&lt;/b&gt;<br>seconda riga</p><p>nuovo paragrafo</p>',
    );
    expect(bioToHtml('   ')).toBe('');
  });
});
