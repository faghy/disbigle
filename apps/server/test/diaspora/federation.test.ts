import { parseHCard, parseWebFinger } from '@disbigle/diaspora';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventually, type Instance, signUp, startInstance } from './helpers.ts';

let a: Instance;
let b: Instance;
let c: Instance;

beforeAll(async () => {
  [a, b, c] = await Promise.all([startInstance(), startInstance(), startInstance()]);
}, 90_000);

afterAll(async () => {
  await Promise.all([a?.close(), b?.close(), c?.close()]);
});

type Status = {
  id: string;
  content: string;
  likesCount: number;
  visibility: string;
  account: { acct: string };
};

const findIn = (list: Status[], text: string) => list.find((s) => s.content.includes(text));

describe('discovery documents', () => {
  it('WebFinger served by Fedify and the hCard are enough for diaspora* discovery', async () => {
    const alice = await signUp(a);
    const finger = await fetch(`${a.url}/.well-known/webfinger?resource=acct:${alice.diasporaId}`);
    const info = parseWebFinger(await finger.text(), {
      expectedDiasporaId: alice.diasporaId,
      requireDiaspora: true,
    });
    expect(info.seedUrl).toBe(`${a.url}/`);
    const hcard = parseHCard(await (await fetch(info.hcardUrl ?? '')).text());
    expect(hcard.nickname).toBe(alice.account.username);
    expect(hcard.publicKey).toContain('BEGIN PUBLIC KEY');

    const hostMeta = await (await fetch(`${a.url}/.well-known/host-meta`)).text();
    expect(hostMeta).toContain(`template="${a.url}/.well-known/webfinger?resource={uri}"`);
    expect((await fetch(`${a.url}/hcard/users/0000000000000000`)).status).toBe(404);
  });
});

describe('federation over diaspora* between three Disbigle instances', () => {
  it('follows, posts, comments (relayed), likes, private posts and retractions', async () => {
    const alice = await signUp(a);
    const bob = await signUp(b);
    const carol = await signUp(c);

    // Discovery: WebFinger + hCard.
    const bobOnA = await a.bridge.resolvePerson(bob.diasporaId);
    const bobOnC = await c.bridge.resolvePerson(bob.diasporaId);
    expect(bobOnA).toMatchObject({ username: bob.account.username, protocols: ['diaspora'] });
    expect(bobOnA?.diasporaReceiveUrl).toMatch(/\/receive\/users\/[0-9a-f]{16}$/);
    if (!bobOnA || !bobOnC) throw new Error('discovery failed');

    // Follow: a Contact, effective at once (no accept step in diaspora*).
    await alice.client.post(`/api/v1/accounts/${bobOnA.id}/follow`);
    await carol.client.post(`/api/v1/accounts/${bobOnC.id}/follow`);
    const relationship = (
      await alice.client.get(`/api/v1/accounts/relationships?id[]=${bobOnA.id}`)
    ).json();
    expect(relationship[0]).toMatchObject({ following: true, requested: false });
    const followers = await eventually(async () => {
      const list = (await bob.client.get(`/api/v1/accounts/${bob.account.id}/followers`)).json();
      return list.length === 2 ? list : null;
    });
    expect(followers.map((f: { acct: string }) => f.acct).sort()).toEqual(
      [alice.diasporaId, carol.diasporaId].sort(),
    );

    // Public post, delivered once per server.
    const post = (
      await bob.client.post('/api/v1/statuses', { content: 'Ciao dal **pod B** #diaspora' })
    ).json();
    const onA = await eventually(async () =>
      findIn((await alice.client.get('/api/v1/timelines/home')).json(), 'pod B'),
    );
    expect(onA.content).toContain('<strong>pod B</strong>');
    expect(onA.account.acct).toBe(bob.diasporaId);
    const onC = await eventually(async () =>
      findIn((await carol.client.get('/api/v1/timelines/home')).json(), 'pod B'),
    );

    // Alice comments: B (root author) stores it and relays it to C.
    await alice.client.post('/api/v1/statuses', {
      content: 'bellissimo!',
      inReplyToId: onA.id,
    });
    await eventually(async () => {
      const context = (await bob.client.get(`/api/v1/statuses/${post.id}/context`)).json();
      return context.descendants?.length === 1;
    });
    const relayed = await eventually(async () => {
      const context = (await carol.client.get(`/api/v1/statuses/${onC.id}/context`)).json();
      return context.descendants?.[0];
    });
    expect(relayed.content).toContain('bellissimo!');
    expect(relayed.account.acct).toBe(alice.diasporaId);

    // Carol likes her copy: B counts it and relays the like to A.
    await carol.client.post(`/api/v1/statuses/${onC.id}/like`);
    await eventually(
      async () => (await bob.client.get(`/api/v1/statuses/${post.id}`)).json().likesCount === 1,
    );
    await eventually(
      async () => (await alice.client.get(`/api/v1/statuses/${onA.id}`)).json().likesCount === 1,
    );
    // ...and takes it back (Retraction of the like, relayed too).
    await carol.client.post(`/api/v1/statuses/${onC.id}/unlike`);
    await eventually(
      async () => (await bob.client.get(`/api/v1/statuses/${post.id}`)).json().likesCount === 0,
    );
    await eventually(
      async () => (await alice.client.get(`/api/v1/statuses/${onA.id}`)).json().likesCount === 0,
    );

    // Aspect-limited post: encrypted, only for Alice.
    const aliceOnB = followers.find((f: { acct: string }) => f.acct === alice.diasporaId);
    const aspects = (await bob.client.get('/api/v1/aspects')).json();
    await bob.client.put(`/api/v1/accounts/${aliceOnB.id}/aspects`, {
      aspectIds: [aspects[0].id],
    });
    await bob.client.post('/api/v1/statuses', {
      content: 'solo per la famiglia',
      visibility: 'limited',
      aspectIds: [aspects[0].id],
    });
    const secret = await eventually(async () =>
      findIn((await alice.client.get('/api/v1/timelines/home')).json(), 'solo per la famiglia'),
    );
    expect(secret.visibility).toBe('limited');
    await b.bridge.idle();
    await c.bridge.idle();
    const carolHome = (await carol.client.get('/api/v1/timelines/home')).json();
    expect(findIn(carolHome, 'solo per la famiglia')).toBeUndefined();

    // Alice deletes her comment: retraction reaches B and, relayed, C.
    const aliceComment = (await alice.client.get(`/api/v1/statuses/${onA.id}/context`)).json()
      .descendants[0];
    await alice.client.delete(`/api/v1/statuses/${aliceComment.id}`);
    await eventually(async () => {
      const context = (await carol.client.get(`/api/v1/statuses/${onC.id}/context`)).json();
      return context.descendants?.length === 0;
    });
    expect(
      (await bob.client.get(`/api/v1/statuses/${post.id}/context`)).json().descendants,
    ).toEqual([]);

    // Bob deletes the post: it disappears everywhere.
    await bob.client.delete(`/api/v1/statuses/${post.id}`);
    await eventually(
      async () => (await alice.client.get(`/api/v1/statuses/${onA.id}`)).statusCode === 404,
    );
    await eventually(
      async () => (await carol.client.get(`/api/v1/statuses/${onC.id}`)).statusCode === 404,
    );

    // Unfollow: Contact with sharing=false.
    await carol.client.post(`/api/v1/accounts/${bobOnC.id}/unfollow`);
    await eventually(async () => {
      const list = (await bob.client.get(`/api/v1/accounts/${bob.account.id}/followers`)).json();
      return list.length === 1;
    });
  }, 90_000);
});
