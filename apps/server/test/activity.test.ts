import { describe, expect, it } from 'vitest';
import { Client, newUser, useTestApp } from './helpers.ts';

const app = useTestApp();

async function signedIn() {
  const client = new Client(app);
  const response = await client.post('/api/v1/auth/register', newUser());
  if (response.statusCode !== 201) throw new Error(`register failed: ${response.body}`);
  return { client, account: response.json().user.account as { id: string } };
}

type Item = { id: string; type: string; status: { id: string; content: string } };

describe('my activity', () => {
  it('lists likes, replies, reshares and saved posts by when you did them', async () => {
    const alice = await signedIn();
    const bruno = await signedIn();
    const first = (await bruno.client.post('/api/v1/statuses', { content: 'Primo' })).json();
    const second = (await bruno.client.post('/api/v1/statuses', { content: 'Secondo' })).json();

    // Done in this order, on the older post first: the list follows the actions, not the posts.
    await alice.client.post(`/api/v1/statuses/${first.id}/like`);
    const reply = (
      await alice.client.post('/api/v1/statuses', { content: 'Risposta', inReplyToId: second.id })
    ).json();
    await alice.client.post(`/api/v1/statuses/${second.id}/reblog`);
    await alice.client.post(`/api/v1/statuses/${first.id}/bookmark`);

    const all = (await alice.client.get('/api/v1/timelines/activity')).json();
    expect(all.items.map((i: Item) => [i.type, i.status.id])).toEqual([
      ['bookmark', first.id],
      ['reblog', second.id],
      ['reply', reply.id],
      ['like', first.id],
    ]);
    expect(all.next).toBeNull();

    const liked = (await alice.client.get('/api/v1/timelines/activity?type=like')).json();
    expect(liked.items.map((i: Item) => i.type)).toEqual(['like']);

    // Page by page with the cursor.
    const one = (await alice.client.get('/api/v1/timelines/activity?limit=2')).json();
    expect(one.items).toHaveLength(2);
    const two = (
      await alice.client.get(`/api/v1/timelines/activity?limit=2&maxId=${one.next}`)
    ).json();
    expect(two.items.map((i: Item) => i.type)).toEqual(['reply', 'like']);

    // Someone else's activity is not yours.
    expect((await bruno.client.get('/api/v1/timelines/activity')).json().items).toEqual([]);
    expect((await new Client(app).get('/api/v1/timelines/activity')).statusCode).toBe(401);
    expect((await alice.client.get('/api/v1/timelines/activity?maxId=nonsense')).statusCode).toBe(
      422,
    );
  });
});
