import { describe, expect, it } from 'vitest';
import { form, mastodonUser, useMastodonApp } from './helpers.ts';

const { app } = useMastodonApp();

type User = Awaited<ReturnType<typeof mastodonUser>>;

const accountOf = async (user: User) =>
  (await user.api.get('/api/v1/accounts/verify_credentials')).json().id as string;

const home = async (user: User) =>
  (await user.api.get('/api/v1/timelines/home')).json().map((s: { content: string }) => s.content);

describe('Mastodon API: hiding posts and hashtags', () => {
  it('hides posts and hashtags, from everyone or from one person', async () => {
    const alice = await mastodonUser(app);
    const bruno = await mastodonUser(app);
    const carla = await mastodonUser(app);
    const brunoId = await accountOf(bruno);
    for (const id of [brunoId, await accountOf(carla)])
      await alice.api.post(`/api/v1/accounts/${id}/follow`);
    const boring = (await bruno.api.post('/api/v1/statuses', form({ status: 'Noioso' }))).json();
    await bruno.api.post('/api/v1/statuses', form({ status: 'Partita #calcio' }));
    await carla.api.post('/api/v1/statuses', form({ status: 'Anche io #calcio' }));

    expect((await alice.api.post(`/api/v1/statuses/${boring.id}/hide`)).statusCode).toBe(200);
    expect(await home(alice)).not.toContainEqual(expect.stringContaining('Noioso'));
    await alice.api.post(`/api/v1/statuses/${boring.id}/unhide`);
    expect(await home(alice)).toContainEqual(expect.stringContaining('Noioso'));

    const fromBruno = await alice.api.post(
      '/api/v1/hidden_tags',
      form({ name: '#Calcio', account_id: brunoId }),
    );
    expect(fromBruno.statusCode).toBe(200);
    expect(fromBruno.json()).toMatchObject({ name: 'calcio', account: { id: brunoId } });
    let shown = await home(alice);
    expect(shown).not.toContainEqual(expect.stringContaining('Partita'));
    expect(shown).toContainEqual(expect.stringContaining('Anche io'));

    const everyone = (await alice.api.post('/api/v1/hidden_tags', form({ name: 'calcio' }))).json();
    expect(everyone).toMatchObject({ name: 'calcio', account: null });
    expect((await alice.api.get('/api/v1/tags/calcio')).json()).toMatchObject({ hidden: true });
    shown = await home(alice);
    expect(shown).not.toContainEqual(expect.stringContaining('Anche io'));

    const list = (await alice.api.get('/api/v1/hidden_tags')).json();
    expect(list.map((h: { account: unknown }) => h.account === null)).toEqual([true, false]);

    expect((await alice.api.delete(`/api/v1/hidden_tags/${everyone.id}`)).statusCode).toBe(200);
    expect(await home(alice)).toContainEqual(expect.stringContaining('Anche io'));
    expect((await bruno.api.delete(`/api/v1/hidden_tags/${fromBruno.json().id}`)).statusCode).toBe(
      404,
    );
  });

  it('refuses hiding your own posts', async () => {
    const alice = await mastodonUser(app);
    const own = (await alice.api.post('/api/v1/statuses', form({ status: 'Mio' }))).json();
    expect((await alice.api.post(`/api/v1/statuses/${own.id}/hide`)).statusCode).toBe(400);
  });
});
