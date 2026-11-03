import { describe, expect, it } from 'vitest';
import { Client, newUser, useTestApp } from './helpers.ts';

const app = useTestApp();

async function signedIn() {
  const client = new Client(app);
  const response = await client.post('/api/v1/auth/register', newUser());
  if (response.statusCode !== 201) throw new Error(`register failed: ${response.body}`);
  return client;
}

describe('replies on your own posts', () => {
  it('can be removed by whoever wrote the post, and by nobody else', async () => {
    await signedIn(); // the first account is the administrator
    const alice = await signedIn();
    const bruno = await signedIn();
    const carla = await signedIn();
    const post = (await alice.post('/api/v1/statuses', { content: 'Il mio post' })).json();
    const rude = (
      await bruno.post('/api/v1/statuses', { content: 'maleducato', inReplyToId: post.id })
    ).json();
    const answer = (
      await carla.post('/api/v1/statuses', { content: 'risposta', inReplyToId: rude.id })
    ).json();

    // Carla wrote neither the post nor the reply she answered.
    expect((await carla.delete(`/api/v1/statuses/${rude.id}`)).statusCode).toBe(404);
    // Alice removes Bruno's reply, and Carla's answer deeper in her thread too.
    expect((await alice.delete(`/api/v1/statuses/${rude.id}`)).statusCode).toBe(200);
    expect((await alice.delete(`/api/v1/statuses/${answer.id}`)).statusCode).toBe(200);
    const context = (await alice.get(`/api/v1/statuses/${post.id}/context`)).json();
    expect(context.descendants).toEqual([]);
    expect((await alice.get(`/api/v1/statuses/${post.id}`)).json().repliesCount).toBe(0);
    // Not the post itself, of course.
    expect((await bruno.delete(`/api/v1/statuses/${post.id}`)).statusCode).toBe(404);
  });
});
