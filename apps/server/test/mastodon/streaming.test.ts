import { describe, expect, it } from 'vitest';
import { mastodonUser, useMastodonApp } from './helpers.ts';

const { app } = useMastodonApp();

/** Opens a test WebSocket, collecting messages from the start (before `open` resolves). */
async function connect(path: string, headers: Record<string, string> = {}) {
  const messages: Record<string, unknown>[] = [];
  const ws = await app().injectWS(
    path,
    { headers },
    {
      onInit: (socket) => {
        socket.on('message', (data: Buffer) => messages.push(JSON.parse(data.toString())));
      },
    },
  );
  return {
    ws,
    async waitFor(count: number) {
      for (let i = 0; i < 100 && messages.length < count; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return messages;
    },
  };
}

describe('Mastodon streaming', () => {
  it('streams home updates, notifications and deletes in Mastodon format', async () => {
    const alice = await mastodonUser(app);
    const bob = await mastodonUser(app);
    await alice.api.post(`/api/v1/accounts/${bob.account.id}/follow`);

    const inbox = await connect(`/api/v1/streaming?stream=user&access_token=${alice.api.token}`);
    const { ws } = inbox;
    // The web client on the same path, with its session cookie: native format.
    const web = await connect('/api/v1/streaming?stream=user', {
      cookie: alice.client.cookieHeader ?? '',
    });
    const tagSubscription = { type: 'subscribe', stream: 'hashtag', tag: 'Streams' };
    ws.send(JSON.stringify(tagSubscription));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const post = (await bob.api.post('/api/v1/statuses', { status: 'live! #streams' })).json();
    await bob.api.post(`/api/v1/statuses/${post.id}/favourite`);
    const own = (await alice.api.post('/api/v1/statuses', { status: 'mine' })).json();
    await bob.api.post(`/api/v1/statuses/${own.id}/favourite`);
    await bob.api.delete(`/api/v1/statuses/${post.id}`);

    const messages = await inbox.waitFor(5);
    ws.terminate();
    const native = await web.waitFor(1);
    web.ws.terminate();
    expect(native[0]).toMatchObject({ event: 'update', stream: 'user', payload: { id: post.id } });

    const updates = messages.filter((m) => m.event === 'update');
    expect(updates.map((m) => m.stream)).toEqual([['user'], ['hashtag', 'streams'], ['user']]);
    for (const update of updates) expect(typeof update.payload).toBe('string');
    const status = JSON.parse(updates[0]?.payload as string);
    expect(status).toMatchObject({
      id: post.id,
      account: { id: bob.account.id },
      favourited: false,
    });

    const notification = messages.find((m) => m.event === 'notification');
    expect(notification?.stream).toEqual(['user']);
    expect(JSON.parse(notification?.payload as string)).toMatchObject({
      type: 'favourite',
      account: { id: bob.account.id },
      status: { id: own.id },
    });
    expect(messages.find((m) => m.event === 'delete')).toEqual({
      stream: ['user'],
      event: 'delete',
      payload: post.id,
    });
  });

  it('refuses the user stream without a token and invalid tokens before upgrading', async () => {
    const anonymous = await connect('/api/v1/streaming?stream=user', {
      'x-disbigle-api': 'mastodon',
    });
    const [error] = await anonymous.waitFor(1);
    anonymous.ws.terminate();
    expect(error).toEqual({ error: 'Missing access token', status: 401 });

    await expect(
      app().injectWS('/api/v1/streaming?stream=user&access_token=wrong'),
    ).rejects.toThrow(/401/);
  });

  it('needs the matching read scope for private streams', async () => {
    const carol = await mastodonUser(app, 'read:notifications');
    const socket = await connect(`/api/v1/streaming?stream=user&access_token=${carol.api.token}`);
    const [error] = await socket.waitFor(1);
    expect(error).toEqual({ error: 'This stream is outside the authorized scopes', status: 403 });
    socket.ws.send(JSON.stringify({ type: 'subscribe', stream: 'user:notification' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await socket.waitFor(2)).toHaveLength(1);
    socket.ws.terminate();
  });

  it('ignores the session cookie on handshakes from other sites', async () => {
    const dan = await mastodonUser(app);
    const socket = await connect('/api/v1/streaming?stream=user', {
      cookie: dan.client.cookieHeader ?? '',
      origin: 'https://evil.example',
    });
    const [error] = await socket.waitFor(1);
    socket.ws.terminate();
    expect(error).toMatchObject({ error: 'invalid_stream', stream: 'user' });
  });

  it('answers the streaming health check', async () => {
    const health = await app().inject({ method: 'GET', url: '/api/v1/streaming/health' });
    expect(health.body).toBe('OK');
  });
});
