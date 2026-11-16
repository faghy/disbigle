import { describe, expect, it } from 'vitest';
import { mastodonUser, signUp, useMastodonApp } from './helpers.ts';

const { app } = useMastodonApp();

// Sent out of order on purpose: the links always come in the same order.
const translations = {
  es: { title: 'Borradores guardados', url: 'https://site.example/es/2026/borradores' },
  en: {
    title: 'Drafts saved while you write',
    summary: 'The composer keeps what you write.',
    url: 'https://site.example/2026/drafts',
  },
  it: { title: 'Bozze salvate mentre scrivi', url: 'https://site.example/it/2026/bozze' },
};

type Notification = { type: string; status: { id: string } | null };

describe('articles from a website (Cleitext "disbigle" plugin)', () => {
  it('announces an article and tells each mentioned person in their own language', async () => {
    const site = await mastodonUser(app);
    const ersel = await signUp(app);
    const bob = await signUp(app);
    await ersel.client.patch('/api/v1/me/settings', { locale: 'es' });

    const response = await site.api.post(
      '/api/v1/disbigle/articles',
      {
        translations,
        mentions: [
          `@${ersel.username}@disbigle.test`,
          `${bob.username}@disbigle.test`,
          // The site's own account, named in the article: never mentioned.
          `${site.username}@disbigle.test`,
        ],
        tags: ['news'],
      },
      { 'idempotency-key': 'article-1' },
    );
    expect(response.statusCode).toBe(200);
    const { status, replies } = response.json();

    // The public post: English, every language linked, Bob (English) mentioned there.
    expect(status.visibility).toBe('public');
    expect(status.language).toBe('en');
    expect(status.content).toContain('https://site.example/2026/drafts');
    expect(status.content).toContain('https://site.example/it/2026/bozze');
    expect(status.content).toContain('https://site.example/es/2026/borradores');
    expect(status.content.indexOf('/it/2026/bozze')).toBeLessThan(
      status.content.indexOf('/es/2026/borradores'),
    );
    expect(status.tags.map((t: { name: string }) => t.name)).toEqual(['news']);
    const mentioned = (s: { mentions: { username: string }[] }) =>
      s.mentions.map((m) => m.username);
    expect(mentioned(status)).toEqual([bob.username]);
    expect(status.content).not.toContain(`@${site.username}@`);

    // Ersel reads Disbigle in Spanish: a quiet reply in Spanish, mentioning only her.
    expect(replies).toHaveLength(1);
    expect(replies[0].language).toBe('es');
    expect(replies[0].status).toMatchObject({
      visibility: 'unlisted',
      in_reply_to_id: status.id,
      language: 'es',
    });
    expect(replies[0].status.content).toContain('https://site.example/es/2026/borradores');
    expect(mentioned(replies[0].status)).toEqual([ersel.username]);

    const mentions = async (who: typeof ersel) =>
      ((await who.client.get('/api/v1/notifications')).json() as Notification[]).filter(
        (n) => n.type === 'mention',
      );
    expect((await mentions(ersel)).map((n) => n.status?.id)).toEqual([replies[0].status.id]);
    expect((await mentions(bob)).map((n) => n.status?.id)).toEqual([status.id]);

    // A retry with the same key returns the same posts instead of posting again.
    const again = await site.api.post(
      '/api/v1/disbigle/articles',
      { translations, mentions: [] },
      { 'idempotency-key': 'article-1' },
    );
    expect(again.json().status.id).toBe(status.id);
  });

  it('refuses an article without any language and needs a token that can post', async () => {
    const site = await mastodonUser(app);
    expect(
      (await site.api.post('/api/v1/disbigle/articles', { translations: {} })).statusCode,
    ).toBe(422);
    const reader = await mastodonUser(app, 'read');
    expect((await reader.api.post('/api/v1/disbigle/articles', { translations })).statusCode).toBe(
      403,
    );
  });
});
