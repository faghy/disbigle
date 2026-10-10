import { describe, expect, it } from 'vitest';
import { Client, newUser, useTestApp } from './helpers.ts';

const app = useTestApp();

async function signedIn() {
  const client = new Client(app);
  const user = newUser();
  const response = await client.post('/api/v1/auth/register', user);
  if (response.statusCode !== 201)
    throw new Error(`register failed: ${response.statusCode} ${response.body}`);
  return { client, account: response.json().user.account as { id: string; username: string } };
}

describe('statuses and timelines', () => {
  it('creates, reads, likes and deletes a post', async () => {
    const { client } = await signedIn();
    const created = await client.post('/api/v1/statuses', { content: 'Hello **Disbigle** #first' });
    expect(created.statusCode).toBe(201);
    const status = created.json();
    expect(status.content).toContain('<strong>Disbigle</strong>');
    expect(status.tags).toEqual([{ name: 'first' }]);

    const anonymous = await new Client(app).get(`/api/v1/statuses/${status.id}`);
    expect(anonymous.json()).toMatchObject({ id: status.id, liked: false });

    expect((await client.post(`/api/v1/statuses/${status.id}/like`)).json()).toMatchObject({
      liked: true,
      likesCount: 1,
    });
    expect((await client.get('/api/v1/timelines/home')).json()[0].id).toBe(status.id);
    expect(
      (await new Client(app).get('/api/v1/timelines/public?local=true'))
        .json()
        .map((s: { id: string }) => s.id),
    ).toContain(status.id);
    expect((await new Client(app).get('/api/v1/timelines/tag/FIRST')).json()[0].id).toBe(status.id);

    expect((await client.delete(`/api/v1/statuses/${status.id}`)).statusCode).toBe(200);
    expect((await client.get(`/api/v1/statuses/${status.id}`)).statusCode).toBe(404);
  });

  it('lets only the author edit a post', async () => {
    const author = await signedIn();
    const other = await signedIn();
    const post = (await author.client.post('/api/v1/statuses', { content: 'first #draft' })).json();
    expect(
      (await other.client.request('PUT', `/api/v1/statuses/${post.id}`, { content: 'hacked' }))
        .statusCode,
    ).toBe(404);
    const edited = (
      await author.client.request('PUT', `/api/v1/statuses/${post.id}`, {
        content: 'second **version** #final',
      })
    ).json();
    expect(edited.content).toContain('<strong>version</strong>');
    expect(edited.editedAt).not.toBeNull();
    expect(edited.tags).toEqual([{ name: 'final' }]);
  });

  it('follows hashtags into the home timeline', async () => {
    const reader = await signedIn();
    const writer = await signedIn();
    const tag = `t${Date.now().toString(36)}`;
    expect(
      (await reader.client.post(`/api/v1/tags/${tag.toUpperCase()}/follow`)).json(),
    ).toMatchObject({ name: tag, following: true });
    expect((await reader.client.get('/api/v1/tags/followed')).json()).toEqual([tag]);
    const post = (await writer.client.post('/api/v1/statuses', { content: `news #${tag}` })).json();
    await writer.client.post('/api/v1/statuses', {
      content: `quiet #${tag}`,
      visibility: 'unlisted',
    });
    expect(
      (await reader.client.get('/api/v1/timelines/home')).json().map((s: { id: string }) => s.id),
    ).toEqual([post.id]);
    expect((await reader.client.get(`/api/v1/tags/${tag}`)).json().postsCount).toBe(2);
    expect((await reader.client.post(`/api/v1/tags/${tag}/unfollow`)).json().following).toBe(false);
    expect((await reader.client.post('/api/v1/tags/1234/follow')).statusCode).toBe(422);
  });

  it('rejects empty posts and anonymous posting', async () => {
    const { client } = await signedIn();
    expect((await client.post('/api/v1/statuses', { content: '   ' })).statusCode).toBe(422);
    expect((await new Client(app).post('/api/v1/statuses', { content: 'hi' })).statusCode).toBe(
      401,
    );
  });

  it('shares limited posts with aspect members only', async () => {
    const author = await signedIn();
    const friend = await signedIn();
    const stranger = await signedIn();
    const aspects = (await author.client.get('/api/v1/aspects')).json();
    expect(aspects).toHaveLength(4);
    const friends = aspects[1];
    const rel = await author.client.put(`/api/v1/accounts/${friend.account.id}/aspects`, {
      aspectIds: [friends.id],
    });
    expect(rel.json().aspectIds).toEqual([friends.id]);

    const post = (
      await author.client.post('/api/v1/statuses', {
        content: 'friends only',
        visibility: 'limited',
        aspectIds: [friends.id],
      })
    ).json();
    expect(post.aspectIds).toEqual([friends.id]);
    expect((await friend.client.get(`/api/v1/statuses/${post.id}`)).statusCode).toBe(200);
    expect((await stranger.client.get(`/api/v1/statuses/${post.id}`)).statusCode).toBe(404);
    expect((await friend.client.get('/api/v1/timelines/home')).json()[0].id).toBe(post.id);
    expect((await author.client.get(`/api/v1/timelines/aspect/${friends.id}`)).statusCode).toBe(
      200,
    );
  });
});

describe('accounts and notifications', () => {
  it('follows an account and reports relationships and notifications', async () => {
    const a = await signedIn();
    const b = await signedIn();
    expect((await a.client.post(`/api/v1/accounts/${b.account.id}/follow`)).json()).toMatchObject({
      following: true,
    });
    const rels = (await a.client.get(`/api/v1/accounts/relationships?id[]=${b.account.id}`)).json();
    expect(rels).toEqual([expect.objectContaining({ id: b.account.id, following: true })]);
    expect((await b.client.get(`/api/v1/accounts/${b.account.id}/followers`)).json()[0].id).toBe(
      a.account.id,
    );
    expect((await b.client.get('/api/v1/notifications/unread_count')).json()).toEqual({ count: 1 });
    expect((await b.client.get('/api/v1/notifications')).json()[0]).toMatchObject({
      type: 'follow',
    });
    await b.client.post('/api/v1/notifications/read');
    expect((await b.client.get('/api/v1/notifications/unread_count')).json()).toEqual({ count: 0 });
  });

  it('manages aspects', async () => {
    const { client } = await signedIn();
    const created = await client.post('/api/v1/aspects', { name: 'Pod admins' });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect((await client.patch(`/api/v1/aspects/${id}`, { name: 'Admins' })).json().name).toBe(
      'Admins',
    );
    expect((await client.post('/api/v1/aspects', { name: 'admins' })).statusCode).toBe(409);
    expect((await client.delete(`/api/v1/aspects/${id}`)).statusCode).toBe(200);
  });

  it('lists an account statuses', async () => {
    const { client, account } = await signedIn();
    await client.post('/api/v1/statuses', { content: 'one' });
    await client.post('/api/v1/statuses', { content: 'two', visibility: 'followers' });
    expect(
      (await new Client(app).get(`/api/v1/accounts/${account.id}/statuses`)).json(),
    ).toHaveLength(1);
    expect((await client.get(`/api/v1/accounts/${account.id}/statuses`)).json()).toHaveLength(2);
  });
});

describe('streaming', () => {
  it('pushes new posts and notifications to connected followers', async () => {
    const author = await signedIn();
    const reader = await signedIn();
    await reader.client.post(`/api/v1/accounts/${author.account.id}/follow`);

    const messages: { event: string; stream: string; payload: { id?: string; type?: string } }[] =
      [];
    const ws = await app().injectWS('/api/v1/streaming?stream=user', {
      headers: { cookie: reader.client.cookieHeader ?? '' },
    });
    ws.on('message', (data: Buffer) => messages.push(JSON.parse(data.toString())));

    const post = (await author.client.post('/api/v1/statuses', { content: 'live!' })).json();
    await author.client.post(`/api/v1/statuses/${post.id}/like`); // self-like: no notification
    const mention = (
      await author.client.post('/api/v1/statuses', { content: `hey @${reader.account.username}` })
    ).json();

    await new Promise((resolve) => setTimeout(resolve, 200));
    ws.terminate();

    const updates = messages.filter((m) => m.event === 'update').map((m) => m.payload.id);
    expect(updates).toEqual([post.id, mention.id]);
    const notifications = messages
      .filter((m) => m.event === 'notification')
      .map((m) => m.payload.type);
    expect(notifications).toEqual(['mention']);
  });

  it('streams public posts to anonymous clients but refuses the user stream', async () => {
    const author = await signedIn();
    const messages: { event: string; stream: string; error?: string }[] = [];
    const ws = await app().injectWS('/api/v1/streaming?stream=public:local');
    ws.on('message', (data: Buffer) => messages.push(JSON.parse(data.toString())));
    ws.send(JSON.stringify({ type: 'subscribe', stream: 'user' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await author.client.post('/api/v1/statuses', { content: 'for everyone' });
    await author.client.post('/api/v1/statuses', {
      content: 'not for everyone',
      visibility: 'followers',
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    ws.terminate();
    expect(messages.filter((m) => m.error === 'invalid_stream')).toHaveLength(1);
    expect(messages.filter((m) => m.event === 'update')).toHaveLength(1);
  });

  it('only tells clients that could see a private post about its deletion', async () => {
    const author = await signedIn();
    const friend = await signedIn();
    const stranger = await signedIn();
    const aspects = (await author.client.get('/api/v1/aspects')).json();
    await author.client.put(`/api/v1/accounts/${friend.account.id}/aspects`, {
      aspectIds: [aspects[0].id],
    });
    const post = (
      await author.client.post('/api/v1/statuses', {
        content: 'secret',
        visibility: 'limited',
        aspectIds: [aspects[0].id],
      })
    ).json();

    const listen = async (cookie: string | undefined) => {
      const received: string[] = [];
      const ws = await app().injectWS('/api/v1/streaming?stream=user', {
        headers: { cookie: cookie ?? '' },
      });
      ws.on('message', (data: Buffer) => {
        const message = JSON.parse(data.toString());
        if (message.event === 'delete') received.push(message.payload);
      });
      return { ws, received };
    };
    const friendSocket = await listen(friend.client.cookieHeader);
    const strangerSocket = await listen(stranger.client.cookieHeader);
    await author.client.delete(`/api/v1/statuses/${post.id}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    friendSocket.ws.terminate();
    strangerSocket.ws.terminate();
    expect(friendSocket.received).toEqual([post.id]);
    expect(strangerSocket.received).toEqual([]);
  });
});
