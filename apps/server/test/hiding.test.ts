import { describe, expect, it } from 'vitest';
import { Client, newUser, useTestApp } from './helpers.ts';

const app = useTestApp();

async function signedIn() {
  const client = new Client(app);
  const response = await client.post('/api/v1/auth/register', newUser());
  if (response.statusCode !== 201) throw new Error(`register failed: ${response.body}`);
  return { client, account: response.json().user.account as { id: string } };
}

const home = async (client: Client) =>
  (await client.get('/api/v1/timelines/home')).json().map((s: { content: string }) => s.content);

describe('hiding posts and hashtags', () => {
  it('keeps hidden posts and hashtags out of your timelines, without unfollowing', async () => {
    const alice = await signedIn();
    const bruno = await signedIn();
    const carla = await signedIn();
    for (const someone of [bruno, carla])
      await alice.client.post(`/api/v1/accounts/${someone.account.id}/follow`);
    const boring = (await bruno.client.post('/api/v1/statuses', { content: 'Noioso' })).json();
    await bruno.client.post('/api/v1/statuses', { content: 'Partita #calcio' });
    await bruno.client.post('/api/v1/statuses', { content: 'Gita #montagna' });
    await carla.client.post('/api/v1/statuses', { content: 'Anche io #calcio' });
    await alice.client.post('/api/v1/statuses', { content: 'Il mio #calcio' });

    // One post: gone from Home, still on its own page; back after "unhide".
    await alice.client.post(`/api/v1/statuses/${boring.id}/hide`);
    expect(await home(alice.client)).not.toContainEqual(expect.stringContaining('Noioso'));
    expect((await alice.client.get(`/api/v1/statuses/${boring.id}`)).statusCode).toBe(200);
    await alice.client.post(`/api/v1/statuses/${boring.id}/unhide`);
    expect(await home(alice.client)).toContainEqual(expect.stringContaining('Noioso'));

    // A hashtag from one person only: Bruno's #calcio goes, Carla's stays, and so does his #montagna.
    const own = await alice.client.post('/api/v1/hidden_tags', {
      name: '#Calcio',
      accountId: bruno.account.id,
    });
    expect(own.statusCode).toBe(201);
    expect(own.json()).toMatchObject({ name: 'calcio', account: { id: bruno.account.id } });
    let seen = await home(alice.client);
    expect(seen).not.toContainEqual(expect.stringContaining('Partita'));
    expect(seen).toContainEqual(expect.stringContaining('Anche io'));
    expect(seen).toContainEqual(expect.stringContaining('Gita'));

    // The hashtag from everyone, even if followed; your own posts always show.
    await alice.client.post('/api/v1/tags/calcio/follow');
    const all = (await alice.client.post('/api/v1/hidden_tags', { name: 'calcio' })).json();
    seen = await home(alice.client);
    expect(seen).not.toContainEqual(expect.stringContaining('Anche io'));
    expect(seen).toContainEqual(expect.stringContaining('Il mio'));
    expect((await alice.client.get('/api/v1/tags/calcio')).json()).toMatchObject({
      following: true,
      hidden: true,
    });
    // The hashtag's own page still shows its posts.
    const tagPage = (await alice.client.get('/api/v1/timelines/tag/calcio')).json();
    expect(tagPage.length).toBe(3);

    const list = (await alice.client.get('/api/v1/hidden_tags')).json();
    expect(list.map((h: { account: unknown }) => h.account === null)).toEqual([true, false]);
    await alice.client.delete(`/api/v1/hidden_tags/${all.id}`);
    expect(await home(alice.client)).toContainEqual(expect.stringContaining('Anche io'));

    // Nobody else's list, and not your own posts.
    expect((await bruno.client.delete(`/api/v1/hidden_tags/${own.json().id}`)).statusCode).toBe(
      404,
    );
    const mine = (await alice.client.post('/api/v1/statuses', { content: 'mio' })).json();
    expect((await alice.client.post(`/api/v1/statuses/${mine.id}/hide`)).statusCode).toBe(400);
  });
});
