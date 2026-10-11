import { describe, expect, it } from 'vitest';
import { safeRedirect } from './redirect.ts';

describe('safeRedirect', () => {
  it('accepts paths on this site, with query and fragment', () => {
    expect(safeRedirect('/oauth/authorize?client_id=abc&scope=read+write&state=x%2Fy')).toBe(
      '/oauth/authorize?client_id=abc&scope=read+write&state=x%2Fy',
    );
    expect(safeRedirect('/settings/profile#top')).toBe('/settings/profile#top');
    expect(safeRedirect('/')).toBe('/');
  });

  it.each([
    ['another host', 'https://evil.example/'],
    ['protocol-relative', '//evil.example/path'],
    ['backslash trick', '/\\evil.example'],
    ['mixed slashes', '/\\/evil.example'],
    ['javascript URL', 'javascript:alert(1)'],
    ['relative path', 'oauth/authorize'],
    ['tab inside', '/\t/evil.example'],
    ['newline inside', '/oauth\n/x'],
    ['empty', ''],
    ['not a string', 42],
    ['array', ['/a']],
    ['too long', `/${'a'.repeat(2048)}`],
  ])('rejects %s', (_label, value) => {
    expect(safeRedirect(value)).toBeUndefined();
  });

  it('normalises dot segments without leaving the site', () => {
    expect(safeRedirect('/a/../oauth/authorize')).toBe('/oauth/authorize');
    expect(safeRedirect('/../../etc')).toBe('/etc');
  });
});
