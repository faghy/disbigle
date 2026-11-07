import { describe, expect, it } from 'vitest';
import { StreamingHub } from '../src/streaming.ts';
import { Client, newUser, useTestApp } from './helpers.ts';

const app = useTestApp();

async function signedIn() {
  const client = new Client(app);
  const response = await client.post('/api/v1/auth/register', newUser());
  if (response.statusCode !== 201) throw new Error(`register failed: ${response.body}`);
  return { client, account: response.json().user.account as { id: string; username: string } };
}

type User = Awaited<ReturnType<typeof signedIn>>;

const write = async (from: User, content: string, inReplyToId?: string) =>
  (
    await from.client.post('/api/v1/statuses', {
      content,
      visibility: 'direct',
      ...(inReplyToId ? { inReplyToId } : {}),
    })
  ).json() as { id: string };

const unread = async (user: User) =>
  (await user.client.get('/api/v1/timelines/conversations/unread_count')).json().count;

describe('conversations as a chat', () => {
  it('pages messages, counts unread ones and says who has seen what', async () => {
    const alice = await signedIn();
    const bruno = await signedIn();
    const carla = await signedIn();
    const first = await write(alice, `ciao @${bruno.account.username}`);
    const second = await write(bruno, `ciao a te @${alice.account.username}`, first.id);
    const third = await write(alice, `come va? @${bruno.account.username}`, second.id);

    const page = (
      await bruno.client.get(`/api/v1/timelines/conversations/${first.id}?limit=2`)
    ).json();
    expect(page.messages.map((m: { id: string }) => m.id)).toEqual([third.id, second.id]);
    expect(page.accounts.map((a: { id: string }) => a.id)).toEqual([alice.account.id]);
    const older = (
      await bruno.client.get(`/api/v1/timelines/conversations/${first.id}?maxId=${second.id}`)
    ).json();
    expect(older.messages.map((m: { id: string }) => m.id)).toEqual([first.id]);

    // Unread for Bruno (Alice wrote last), not for Alice.
    expect(await unread(bruno)).toBe(1);
    expect(await unread(alice)).toBe(0);
    let list = (await bruno.client.get('/api/v1/timelines/conversations')).json();
    expect(list[0]).toMatchObject({ id: first.id, unread: true });

    const read = await bruno.client.post(`/api/v1/timelines/conversations/${first.id}/read`);
    expect(read.json()).toEqual({ lastReadId: third.id });
    expect(await unread(bruno)).toBe(0);
    list = (await bruno.client.get('/api/v1/timelines/conversations')).json();
    expect(list[0].unread).toBe(false);
    // Alice sees that Bruno got to her last message.
    const forAlice = (await alice.client.get(`/api/v1/timelines/conversations/${first.id}`)).json();
    expect(forAlice.seen).toEqual([{ accountId: bruno.account.id, lastReadId: third.id }]);

    // Reading again changes nothing; a new message makes it unread again.
    expect(
      (await bruno.client.post(`/api/v1/timelines/conversations/${first.id}/read`)).json(),
    ).toEqual({ lastReadId: null });
    await write(alice, `ci sei? @${bruno.account.username}`, third.id);
    expect(await unread(bruno)).toBe(1);

    // Outsiders get nothing.
    expect((await carla.client.get(`/api/v1/timelines/conversations/${first.id}`)).statusCode).toBe(
      404,
    );
    expect(
      (await carla.client.post(`/api/v1/timelines/conversations/${first.id}/typing`)).statusCode,
    ).toBe(404);
    expect(
      (await bruno.client.post(`/api/v1/timelines/conversations/${first.id}/typing`)).statusCode,
    ).toBe(200);
  });

  it('delivers typing and read receipts only to the people they are for', async () => {
    const alice = await signedIn();
    const hub = new StreamingHub(app.ctx());
    const received: { id: string; messages: string[] }[] = [];
    const listen = (id: string | null, streams: string[]) => {
      const box = { id: id ?? 'anon', messages: [] as string[] };
      received.push(box);
      const connection = hub.add({ readyState: 1, send: (m) => box.messages.push(m) }, id);
      for (const s of streams) connection.streams.add(s);
    };
    listen(alice.account.id, ['user']);
    listen('someone-else', ['user']);
    listen(alice.account.id, ['public']);

    await hub.deliverLive({
      type: 'conversation.typing',
      conversationId: 'c1',
      actorId: alice.account.id,
      recipients: [alice.account.id],
    });
    await hub.deliverLive({
      type: 'conversation.read',
      conversationId: 'c1',
      actorId: alice.account.id,
      lastReadId: 'm1',
      recipients: [alice.account.id],
    });
    const [mine, other, publicOnly] = received.map((r) => r.messages.map((m) => JSON.parse(m)));
    expect(mine).toMatchObject([
      {
        event: 'conversation.typing',
        stream: 'user',
        payload: { conversationId: 'c1', account: { id: alice.account.id } },
      },
      {
        event: 'conversation.read',
        payload: { conversationId: 'c1', accountId: alice.account.id, lastReadId: 'm1' },
      },
    ]);
    expect(other).toEqual([]);
    expect(publicOnly).toEqual([]);
  });
});
