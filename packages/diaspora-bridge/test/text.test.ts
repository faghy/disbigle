import { describe, expect, it } from 'vitest';
import {
  diasporaMentionsToMarkdown,
  extractMarkdownImages,
  guidFromId,
  htmlToText,
  mentionsToDiaspora,
  mimeTypeFromName,
  parseDiasporaMentions,
} from '../src/text.ts';

describe('mentions', () => {
  it('parses diaspora* mentions with and without names', () => {
    expect(
      parseDiasporaMentions('hi @{Alice Smith; Alice@Example.org} and @{bob@pod.tld:3000}'),
    ).toEqual([
      { name: 'Alice Smith', id: 'alice@example.org' },
      { name: undefined, id: 'bob@pod.tld:3000' },
    ]);
  });

  it('turns known mentions into links and unknown ones into text', () => {
    const md = diasporaMentionsToMarkdown(
      'ciao @{Alice [x]; alice@example.org} e @{bob@pod.tld}',
      (id) => (id === 'alice@example.org' ? 'https://example.org/u/alice' : null),
    );
    expect(md).toBe('ciao [@Alice \\[x\\]](https://example.org/u/alice) e @bob@pod.tld');
  });

  it('writes Disbigle mentions in diaspora* syntax, leaving code alone', () => {
    const text = mentionsToDiaspora('@bob and @carol@pod.tld:3000, `@bob` and @unknown', (u, d) =>
      u === 'bob' && d === null ? 'bob@local.tld' : u === 'carol' ? `carol@${d}` : null,
    );
    expect(text).toBe('@{bob@local.tld} and @{carol@pod.tld:3000}, `@bob` and @unknown');
  });
});

describe('helpers', () => {
  it('converts HTML to text', () => {
    expect(htmlToText('<p>a &amp; b<br>c</p><p>d</p>')).toBe('a & b\nc\n\nd');
  });

  it('guesses MIME types and builds GUIDs', () => {
    expect(mimeTypeFromName('x.PNG')).toBe('image/png');
    expect(mimeTypeFromName('noext')).toBe('image/jpeg');
    expect(guidFromId('0190f5b2-1c2d-7e3f-8a9b-0c1d2e3f4a5b')).toBe(
      '0190f5b21c2d7e3f8a9b0c1d2e3f4a5b',
    );
  });
});

describe('inline images', () => {
  it('takes markdown images out of the text', () => {
    expect(
      extractMarkdownImages('![pet training](https://img.example/a/b.webp "pet training")'),
    ).toEqual({ text: '', images: [{ url: 'https://img.example/a/b.webp', alt: 'pet training' }] });
  });

  it('keeps the text around and the target of linked images', () => {
    expect(
      extractMarkdownImages(
        'Look:\n\n![](https://a.example/1.png)\n\n[![a \\] b](https://a.example/2.jpg)](https://a.example/page) end',
      ),
    ).toEqual({
      text: 'Look:\n\nhttps://a.example/page end',
      images: [
        { url: 'https://a.example/1.png', alt: '' },
        { url: 'https://a.example/2.jpg', alt: 'a ] b' },
      ],
    });
  });

  it('leaves code, plain links and non-http images alone', () => {
    const text =
      '`![x](https://a.example/1.png)` [link](https://a.example) ![y](data:image/png;base64,AA)';
    expect(extractMarkdownImages(text)).toEqual({ text, images: [] });
  });
});
