import { describe, expect, it } from 'vitest';
import { extractMentions, extractTags, renderMarkdown } from '../src/index.ts';

const options = {
  resolveMention: (username: string, domain: string | null) =>
    username.toLowerCase() === 'alice' && domain === null ? 'https://d.test/@alice' : null,
  tagUrl: (tag: string) => `https://d.test/tags/${tag}`,
};

describe('content', () => {
  it('extracts mentions and tags, ignoring code and emails', () => {
    const source =
      'Hi @alice and @bob@example.org! #Disbigle #2026 #ok_1 mail me@x.org `@code #code`';
    expect(extractMentions(source).map((m) => m.text)).toEqual(['@alice', '@bob@example.org']);
    expect(extractTags(source)).toEqual(['disbigle', 'ok_1']);
  });

  it('renders markdown with links for known mentions and hashtags', () => {
    const html = renderMarkdown('**Ciao** @alice e @carol #Fediverso', options);
    expect(html).toContain('<strong>Ciao</strong>');
    expect(html).toContain('<a href="https://d.test/@alice" class="u-url mention"');
    expect(html).toContain('@carol');
    expect(html).not.toContain('href="https://d.test/@carol"');
    expect(html).toContain('href="https://d.test/tags/fediverso"');
  });

  it('escapes raw HTML and drops dangerous links', () => {
    const html = renderMarkdown(
      '<script>alert(1)</script> [x](javascript:alert(1)) <b onclick="x">b</b>',
      options,
    );
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/href="javascript/i);
    expect(html).not.toMatch(/<b onclick/);
    expect(html).toContain('&lt;script&gt;');
    const link = renderMarkdown('see [x](javascript:alert(1)) and [ok](https://ok.test)', options);
    expect(link).not.toMatch(/href="javascript/i);
    expect(link).toContain('href="https://ok.test"');
  });

  it('turns inline images into links and keeps line breaks', () => {
    const html = renderMarkdown('one\ntwo ![pic](https://x.test/a.png)', options);
    expect(html).toContain('<br />');
    expect(html).not.toContain('<img');
    expect(html).toContain('href="https://x.test/a.png"');
  });
});
