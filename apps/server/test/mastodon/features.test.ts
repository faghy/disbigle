import { describe, expect, it } from 'vitest';
import { form, mastodonUser, useMastodonApp } from './helpers.ts';

const { app } = useMastodonApp();

const ids = (response: { json: () => unknown }) =>
  (response.json() as { id: string }[]).map((s) => s.id);

describe('Mastodon API: pins', () => {
  it('pins and unpins posts and lists them on the profile', async () => {
    const alice = await mastodonUser(app);
    const bob = await mastodonUser(app);
    const first = (await alice.api.post('/api/v1/statuses', { status: 'first' })).json();
    const second = (await alice.api.post('/api/v1/statuses', { status: 'second' })).json();
    expect(first.pinned).toBe(false);

    const pinned = await alice.api.post(`/api/v1/statuses/${first.id}/pin`);
    expect(pinned.statusCode).toBe(200);
    expect(pinned.json()).toMatchObject({ id: first.id, pinned: true });
    await alice.api.post(`/api/v1/statuses/${second.id}/pin`);

    const profile = await bob.api.get(`/api/v1/accounts/${alice.account.id}/statuses?pinned=true`);
    expect(ids(profile)).toEqual([second.id, first.id]);
    expect(profile.headers.link).toBeUndefined();
    expect((await alice.api.get(`/api/v1/statuses/${first.id}`)).json().pinned).toBe(true);

    const unpinned = await alice.api.post(`/api/v1/statuses/${second.id}/unpin`);
    expect(unpinned.json().pinned).toBe(false);
    expect(
      ids(await bob.api.get(`/api/v1/accounts/${alice.account.id}/statuses?pinned=true`)),
    ).toEqual([first.id]);

    // Not your post, or not public: refused the Mastodon way.
    expect((await bob.api.post(`/api/v1/statuses/${first.id}/pin`)).statusCode).toBe(404);
    const quiet = (
      await alice.api.post('/api/v1/statuses', { status: 'quiet', visibility: 'private' })
    ).json();
    const refused = await alice.api.post(`/api/v1/statuses/${quiet.id}/pin`);
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error).toMatch(/^Validation failed/);
    expect((await alice.api.get('/api/v1/endorsements')).json()).toEqual([]);
  });
});

describe('Mastodon API: filters', () => {
  it('creates v2 filters with one keyword and hides matching posts on the server', async () => {
    const alice = await mastodonUser(app);
    const bob = await mastodonUser(app);
    await alice.api.post(`/api/v1/accounts/${bob.account.id}/follow`);

    const created = await alice.api.post(
      '/api/v2/filters',
      form({
        title: 'Spoilers',
        'context[]': ['home', 'notifications', 'account'],
        filter_action: 'warn',
        'keywords_attributes[][keyword]': 'spoiler',
        'keywords_attributes[][whole_word]': 'true',
      }),
    );
    expect(created.statusCode).toBe(200);
    const filter = created.json();
    expect(filter).toMatchObject({
      title: 'spoiler',
      context: ['home', 'account', 'notifications'],
      filter_action: 'hide',
      keywords: [{ keyword: 'spoiler', whole_word: true }],
      expires_at: null,
    });

    const hidden = (await bob.api.post('/api/v1/statuses', { status: 'big spoiler ahead' })).json();
    const shown = (await bob.api.post('/api/v1/statuses', { status: 'spoilers? no' })).json();
    const home = ids(await alice.api.get('/api/v1/timelines/home'));
    expect(home).toContain(shown.id);
    expect(home).not.toContain(hidden.id);
    // `account` is folded into `home`: profiles read through the API are filtered too.
    const profile = ids(await alice.api.get(`/api/v1/accounts/${bob.account.id}/statuses`));
    expect(profile).toEqual([shown.id]);

    const mine = (await alice.api.post('/api/v1/statuses', { status: 'hello' })).json();
    await bob.api.post('/api/v1/statuses', {
      status: `@${alice.username} spoiler for you`,
      in_reply_to_id: mine.id,
    });
    const notifications = (await alice.api.get('/api/v1/notifications?types[]=mention')).json();
    expect(notifications).toEqual([]);

    expect(
      (await alice.api.get('/api/v2/filters')).json().map((f: { id: string }) => f.id),
    ).toEqual([filter.id]);
    const edited = await alice.api.put(`/api/v2/filters/${filter.id}`, {
      context: ['public'],
      keywords_attributes: [{ id: filter.id, keyword: 'leak', whole_word: false }],
    });
    expect(edited.json()).toMatchObject({
      id: filter.id,
      context: ['public'],
      keywords: [{ keyword: 'leak', whole_word: false }],
    });
    expect(ids(await alice.api.get('/api/v1/timelines/home'))).toContain(hidden.id);
    expect((await alice.api.get(`/api/v2/filters/${filter.id}/keywords`)).json()).toEqual([
      { id: filter.id, keyword: 'leak', whole_word: false },
    ]);

    // One keyword per filter.
    const two = await alice.api.post('/api/v2/filters', {
      title: 'x',
      context: ['home'],
      keywords_attributes: [{ keyword: 'a' }, { keyword: 'b' }],
    });
    expect(two.statusCode).toBe(422);
    const adding = await alice.api.put(`/api/v2/filters/${filter.id}`, {
      keywords_attributes: [{ keyword: 'second' }],
    });
    expect(adding.statusCode).toBe(422);
    const none = await alice.api.post('/api/v2/filters', { title: 'x', context: ['home'] });
    expect(none.statusCode).toBe(422);

    expect((await alice.api.delete(`/api/v2/filters/${filter.id}`)).statusCode).toBe(200);
    expect((await alice.api.get(`/api/v2/filters/${filter.id}`)).statusCode).toBe(404);
    expect((await bob.api.get(`/api/v2/filters/${filter.id}`)).statusCode).toBe(404);
  });

  it('supports the v1 filter API', async () => {
    const alice = await mastodonUser(app);
    const created = await alice.api.post(
      '/api/v1/filters',
      form({ phrase: 'crypto', 'context[]': ['home', 'public'], expires_in: '3600' }),
    );
    expect(created.json()).toMatchObject({
      phrase: 'crypto',
      context: ['home', 'account', 'public'],
      whole_word: true,
      irreversible: true,
    });
    const id = created.json().id;
    expect(created.json().expires_at).not.toBeNull();
    const updated = await alice.api.put(`/api/v1/filters/${id}`, {
      phrase: 'nft',
      context: ['thread'],
    });
    expect(updated.json()).toMatchObject({ phrase: 'nft', context: ['thread'] });
    expect((await alice.api.get('/api/v1/filters')).json()).toHaveLength(1);
    expect((await alice.api.post('/api/v1/filters', { phrase: 'x', context: [] })).statusCode).toBe(
      422,
    );
    await alice.api.delete(`/api/v1/filters/${id}`);
    expect((await alice.api.get('/api/v1/filters')).json()).toEqual([]);
  });
});
