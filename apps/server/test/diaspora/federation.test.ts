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
  poll: { id: string } | null;
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

  it('carries edits of posts and of comments, relayed by the thread author', async () => {
    const alice = await signUp(a);
    const bob = await signUp(b);
    const carol = await signUp(c);
    const bobOnA = await a.bridge.resolvePerson(bob.diasporaId);
    const bobOnC = await c.bridge.resolvePerson(bob.diasporaId);
    if (!bobOnA || !bobOnC) throw new Error('discovery failed');
    await alice.client.post(`/api/v1/accounts/${bobOnA.id}/follow`);
    await carol.client.post(`/api/v1/accounts/${bobOnC.id}/follow`);
    await eventually(async () => {
      const list = (await bob.client.get(`/api/v1/accounts/${bob.account.id}/followers`)).json();
      return list.length === 2;
    });

    const post = (await bob.client.post('/api/v1/statuses', { content: 'Prima stesura' })).json();
    const onA = await eventually(async () =>
      findIn((await alice.client.get('/api/v1/timelines/home')).json(), 'Prima stesura'),
    );
    const onC = await eventually(async () =>
      findIn((await carol.client.get('/api/v1/timelines/home')).json(), 'Prima stesura'),
    );
    const comment = (
      await alice.client.post('/api/v1/statuses', { content: 'commento', inReplyToId: onA.id })
    ).json();
    await eventually(async () => {
      const context = (await carol.client.get(`/api/v1/statuses/${onC.id}/context`)).json();
      return context.descendants?.length === 1;
    });

    // The author edits the post: both pods get the new text.
    await bob.client.request('PUT', `/api/v1/statuses/${post.id}`, { content: 'Versione finale' });
    for (const [reader, id] of [
      [alice, onA.id],
      [carol, onC.id],
    ] as const) {
      const edited = await eventually(async () => {
        const status = (await reader.client.get(`/api/v1/statuses/${id}`)).json();
        return status.content.includes('Versione finale') ? status : null;
      });
      expect(edited.editedAt).not.toBeNull();
    }

    // Alice edits her comment: B applies it and relays the signed new version to C.
    await alice.client.request('PUT', `/api/v1/statuses/${comment.id}`, {
      content: 'commento corretto',
    });
    await eventually(async () => {
      const context = (await bob.client.get(`/api/v1/statuses/${post.id}/context`)).json();
      return context.descendants?.[0]?.content.includes('corretto');
    });
    await eventually(async () => {
      const context = (await carol.client.get(`/api/v1/statuses/${onC.id}/context`)).json();
      return context.descendants?.[0]?.content.includes('corretto');
    });
  }, 90_000);

  it('votes on a poll: counted by the author and relayed to the other pods', async () => {
    const alice = await signUp(a);
    const bob = await signUp(b);
    const carol = await signUp(c);
    const bobOnA = await a.bridge.resolvePerson(bob.diasporaId);
    const bobOnC = await c.bridge.resolvePerson(bob.diasporaId);
    await alice.client.post(`/api/v1/accounts/${bobOnA?.id}/follow`);
    await carol.client.post(`/api/v1/accounts/${bobOnC?.id}/follow`);
    await eventually(async () => {
      const list = (await bob.client.get(`/api/v1/accounts/${bob.account.id}/followers`)).json();
      return list.length === 2;
    });

    const post = (
      await bob.client.post('/api/v1/statuses', {
        content: 'Mare o montagna?',
        poll: { options: ['Mare', 'Montagna'], expiresIn: 3600 },
      })
    ).json();
    const onA = await eventually(async () =>
      findIn((await alice.client.get('/api/v1/timelines/home')).json(), 'Mare o montagna'),
    );
    expect(onA.poll).toMatchObject({
      multiple: false,
      expiresAt: null,
      options: [{ title: 'Mare' }, { title: 'Montagna' }],
    });
    const onC = await eventually(async () =>
      findIn((await carol.client.get('/api/v1/timelines/home')).json(), 'Mare o montagna'),
    );

    const voted = await alice.client.post(`/api/v1/polls/${onA.poll?.id}/votes`, { choices: [1] });
    expect(voted.json().poll).toMatchObject({ voted: true, ownVotes: [1] });
    await eventually(
      async () =>
        (await bob.client.get(`/api/v1/statuses/${post.id}`)).json().poll.options[1].votesCount ===
        1,
    );
    await eventually(async () => {
      const poll = (await carol.client.get(`/api/v1/statuses/${onC.id}`)).json().poll;
      return poll.votersCount === 1 && poll.options[1].votesCount === 1;
    });
  }, 90_000);
});

describe('public groups on diaspora*', () => {
  it('are found, joined by adding them to an aspect, and reshare what is written in them', async () => {
    const alice = await signUp(a);
    const bob = await signUp(b);
    const handle = `club_${Math.random().toString(36).slice(2, 7)}`;
    const group = (
      await alice.client.post('/api/v1/groups', { name: 'Club', handle, privacy: 'public' })
    ).json();

    // Found like a person, through WebFinger and the hCard.
    const clubOnB = await b.bridge.resolvePerson(`${handle}@${a.domain}`);
    expect(clubOnB).toMatchObject({ username: handle, protocols: ['diaspora'] });
    if (!clubOnB) throw new Error('discovery failed');

    // Following it (adding it to an aspect) is joining it.
    await bob.client.post(`/api/v1/accounts/${clubOnB.id}/follow`);
    await eventually(async () => {
      const members = (await alice.client.get(`/api/v1/groups/${group.id}/members`)).json();
      return members.some((m: { account: { acct: string } }) => m.account.acct === bob.diasporaId);
    });

    // A post in the group reaches Bob as the group's reshare.
    const post = (
      await alice.client.post('/api/v1/statuses', {
        content: 'Benvenuti nel club',
        groupId: group.id,
      })
    ).json();
    const reshare = await eventually(async () => {
      const home = (await bob.client.get('/api/v1/timelines/home')).json();
      return home.find((s: { reblog: { content: string } | null }) =>
        s.reblog?.content.includes('Benvenuti'),
      );
    });
    expect(reshare.account.acct).toBe(`${handle}@${a.domain}`);
    expect(reshare.reblog.account.acct).toBe(alice.diasporaId);

    // Bob's comment joins the group's discussion.
    await bob.client.post('/api/v1/statuses', {
      content: 'Grazie!',
      inReplyToId: reshare.reblog.id,
    });
    const answer = await eventually(async () => {
      const context = (await alice.client.get(`/api/v1/statuses/${post.id}/context`)).json();
      return context.descendants?.[0];
    });
    expect(answer).toMatchObject({
      content: expect.stringContaining('Grazie'),
      group: { id: group.id },
    });

    // Naming the group in a public post writes in it.
    await bob.client.post('/api/v1/statuses', {
      content: `Domanda per @${handle}@${a.domain}: chi viene?`,
    });
    const inGroup = await eventually(async () => {
      const timeline = (await alice.client.get(`/api/v1/groups/${group.id}/timeline`)).json();
      return timeline.find((s: { content: string }) => s.content.includes('chi viene'));
    });
    expect(inGroup.account.acct).toBe(bob.diasporaId);

    // Removing it from the aspects is leaving.
    await bob.client.post(`/api/v1/accounts/${clubOnB.id}/unfollow`);
    await eventually(async () => {
      const members = (await alice.client.get(`/api/v1/groups/${group.id}/members`)).json();
      return !members.some((m: { account: { acct: string } }) => m.account.acct === bob.diasporaId);
    });
  });

  it('keeps private groups off diaspora*', async () => {
    const alice = await signUp(a);
    const handle = `hush_${Math.random().toString(36).slice(2, 7)}`;
    await alice.client.post('/api/v1/groups', { name: 'Hush', handle, privacy: 'private' });
    // Its WebFinger answers 404, as for nobody at all.
    const found = await b.bridge.resolvePerson(`${handle}@${a.domain}`).catch(() => null);
    expect(found).toBeNull();
    const finger = await fetch(
      `${a.url}/.well-known/webfinger?resource=acct:${handle}@${a.domain}`,
    );
    expect(finger.status).toBe(404);
  });
});
