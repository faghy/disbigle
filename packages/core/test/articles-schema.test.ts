import { describe, expect, it } from 'vitest';
import { publishArticleSchema } from '../src/social/articles.ts';

describe('article requests (Cleitext "disbigle" plugin)', () => {
  it('takes only the languages the site has, mentions and hashtags', () => {
    const parsed = publishArticleSchema.safeParse({
      translations: {
        en: { title: 'Drafts', summary: 'Kept while you write', url: 'https://site.example/a' },
        es: { title: 'Borradores', url: 'https://site.example/es/a' },
      },
      mentions: ['@u1_ab12@disbigle.test', 'Ersel@disbigle.com'],
      tags: ['news', 'città'],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.translations.es?.summary).toBe('');
  });

  it('refuses an article with no language, an unknown language or a bad mention', () => {
    const page = { title: 'T', url: 'https://site.example/a' };
    expect(publishArticleSchema.safeParse({ translations: {} }).success).toBe(false);
    expect(publishArticleSchema.safeParse({ translations: { xx: page } }).success).toBe(false);
    expect(
      publishArticleSchema.safeParse({ translations: { en: page }, mentions: ['nobody'] }).success,
    ).toBe(false);
  });
});
