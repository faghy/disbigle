import { describe, expect, it } from 'vitest';
import { Client, newUser, useTestApp } from './helpers.ts';

const app = useTestApp();

async function signedIn() {
  const client = new Client(app);
  const response = await client.post('/api/v1/auth/register', newUser());
  if (response.statusCode !== 201) throw new Error(`register failed: ${response.body}`);
  return { client, account: response.json().user.account as { id: string } };
}

describe('who liked and reshared a post', () => {
  it('lists the people, newest first, for whoever may see the post', async () => {
    const alice = await signedIn();
    const bruno = await signedIn();
    const carla = await signedIn();
    const post = (await alice.client.post('/api/v1/statuses', { content: 'Ciao' })).json();
    await bruno.client.post(`/api/v1/statuses/${post.id}/like`);
    await carla.client.post(`/api/v1/statuses/${post.id}/like`);
    await carla.client.post(`/api/v1/statuses/${post.id}/reblog`);

    const liked = await alice.client.get(`/api/v1/statuses/${post.id}/liked_by`);
    expect(liked.statusCode).toBe(200);
    expect(liked.json().map((a: { id: string }) => a.id)).toEqual([
      carla.account.id,
      bruno.account.id,
    ]);
    const reshared = (await bruno.client.get(`/api/v1/statuses/${post.id}/reshared_by`)).json();
    expect(reshared.map((a: { id: string }) => a.id)).toEqual([carla.account.id]);
    const paged = (
      await alice.client.get(`/api/v1/statuses/${post.id}/liked_by?limit=1&offset=1`)
    ).json();
    expect(paged.map((a: { id: string }) => a.id)).toEqual([bruno.account.id]);

    const hidden = (
      await alice.client.post('/api/v1/statuses', {
        content: 'Solo amici',
        visibility: 'followers',
      })
    ).json();
    expect((await bruno.client.get(`/api/v1/statuses/${hidden.id}/liked_by`)).statusCode).toBe(404);
  });
});
