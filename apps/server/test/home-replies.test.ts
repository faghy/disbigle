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

type Person = Awaited<ReturnType<typeof signedIn>>;

const post = async (who: Person, content: string, inReplyToId?: string) =>
  (
    await who.client.post('/api/v1/statuses', { content, ...(inReplyToId ? { inReplyToId } : {}) })
  ).json() as { id: string };

const home = async (who: Person) =>
  ((await who.client.get('/api/v1/timelines/home')).json() as { id: string }[]).map((s) => s.id);

describe('replies on the home timeline (issue #30)', () => {
  it('shows by default only replies whose context the reader follows', async () => {
    const me = await signedIn();
    const bob = await signedIn(); // followed
    const dan = await signedIn(); // followed
    const carol = await signedIn(); // not followed
    await me.client.post(`/api/v1/accounts/${bob.account.id}/follow`);
    await me.client.post(`/api/v1/accounts/${dan.account.id}/follow`);

    const top = await post(bob, 'A post of mine');
    const carols = await post(carol, 'Something by Carol');
    const dans = await post(dan, 'Something by Dan');
    const toCarol = await post(bob, 'Reply to Carol', carols.id);
    const toDan = await post(bob, 'Reply to Dan', dans.id);
    const toSelf = await post(bob, 'And more', top.id);
    const mine = await post(me, 'My own post');
    const toMe = await post(bob, 'Reply to me', mine.id);

    expect((await me.client.get('/api/v1/me')).json().homeReplies).toBe('following');
    const shown = await home(me);
    expect(shown).toEqual(expect.arrayContaining([top.id, dans.id, toDan.id, toSelf.id, toMe.id]));
    expect(shown).not.toContain(toCarol.id);

    // Everything, as before.
    await me.client.patch('/api/v1/me/settings', { homeReplies: 'all' });
    expect(await home(me)).toContain(toCarol.id);

    // No replies at all, except those addressed to the reader.
    await me.client.patch('/api/v1/me/settings', { homeReplies: 'none' });
    const plain = await home(me);
    expect(plain).toEqual(expect.arrayContaining([top.id, dans.id, toMe.id]));
    expect(plain).not.toContain(toCarol.id);
    expect(plain).not.toContain(toDan.id);
    expect(plain).not.toContain(toSelf.id);

    expect((await me.client.patch('/api/v1/me/settings', { homeReplies: 'some' })).statusCode).toBe(
      422,
    );
  });
});
