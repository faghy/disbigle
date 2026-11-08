import { describe, expect, it } from 'vitest';
import { form, mastodonUser, useMastodonApp } from './helpers.ts';

const { app } = useMastodonApp();

describe('Mastodon API: conversations as a chat (Disbigle extension)', () => {
  it('pages messages, says who has seen them and who is around', async () => {
    const alice = await mastodonUser(app);
    const bob = await mastodonUser(app);
    const first = (
      await alice.api.post(
        '/api/v1/statuses',
        form({ status: `@${bob.username} ciao`, visibility: 'direct' }),
      )
    ).json();
    const reply = (
      await bob.api.post(
        '/api/v1/statuses',
        form({
          status: `@${alice.username} eccomi`,
          visibility: 'direct',
          in_reply_to_id: first.id,
        }),
      )
    ).json();

    const forAlice = (await alice.api.get(`/api/v1/conversations/${first.id}/messages`)).json();
    expect(forAlice.messages.map((m: { id: string }) => m.id)).toEqual([reply.id, first.id]);
    expect(forAlice.accounts.map((a: { username: string }) => a.username)).toEqual([bob.username]);
    expect(forAlice.seen).toEqual([]);
    expect(forAlice.presence).toEqual({});

    await bob.api.post(`/api/v1/conversations/${first.id}/read`);
    await bob.client.patch('/api/v1/me/settings', { presence: 'auto' });
    expect(
      (await bob.api.post('/api/v1/disbigle/presence', form({ active: 'true' }))).statusCode,
    ).toBe(200);
    const after = (await alice.api.get(`/api/v1/conversations/${first.id}/messages`)).json();
    expect(after.seen).toEqual([{ account_id: bob.account.id, last_read_id: reply.id }]);
    expect(after.presence).toEqual({ [bob.account.id]: 'online' });

    const older = (
      await alice.api.get(`/api/v1/conversations/${first.id}/messages?max_id=${reply.id}`)
    ).json();
    expect(older.messages.map((m: { id: string }) => m.id)).toEqual([first.id]);
  });

  it('previews the Markdown of a post for the apps', async () => {
    const alice = await mastodonUser(app);
    const preview = await alice.api.post(
      '/api/v1/disbigle/preview',
      form({ content: '## Titolo\n\n**forte** e #tag' }),
    );
    expect(preview.statusCode).toBe(200);
    expect(preview.json().html).toContain('<h2>Titolo</h2>');
    expect(preview.json().html).toContain('<strong>forte</strong>');
    expect(preview.json().html).toContain('class="mention hashtag"');
  });
});
