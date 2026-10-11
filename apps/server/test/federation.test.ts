import { createServer } from 'node:net';
import {
  ActivityPubPublisher,
  CompositeEventBus,
  createDisbigleFederation,
} from '@disbigle/activitypub';
import type { Config } from '@disbigle/config';
import { type CoreContext, MemoryKeyValueStore } from '@disbigle/core';
import { createTestDatabase } from '@disbigle/db/testing';
import { MemoryKvStore } from '@fedify/fedify';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { LocalEventBus, StreamingHub } from '../src/streaming.ts';
import { Client, newUser, testConfig } from './helpers.ts';

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

interface Instance {
  app: FastifyInstance;
  domain: string;
  url: string;
  drop: () => Promise<void>;
}

async function startInstance(): Promise<Instance> {
  const port = await freePort();
  const domain = `127.0.0.1:${port}`;
  const url = `http://${domain}`;
  const testDb = await createTestDatabase();
  const config: Config = { ...testConfig, PUBLIC_URL: url, LOCAL_DOMAIN: domain };
  const ctx: CoreContext = {
    db: testDb.db,
    config,
    kv: new MemoryKeyValueStore(),
    rsaKeyBits: 1024,
  };
  const federation = createDisbigleFederation({
    kv: new MemoryKvStore(),
    allowPrivateAddress: true,
  });
  const hub = new StreamingHub(ctx);
  ctx.events = new CompositeEventBus([
    new LocalEventBus(hub),
    new ActivityPubPublisher(federation, ctx),
  ]);
  const app = await buildApp({ ctx, hub, federation, disableRateLimit: true });
  await app.listen({ host: '127.0.0.1', port });
  return { app, domain, url, drop: testDb.drop };
}

async function eventually<T>(
  check: () => Promise<T | null | undefined | false>,
  timeoutMs = 10_000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('Condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

let a: Instance;
let b: Instance;

beforeAll(async () => {
  [a, b] = await Promise.all([startInstance(), startInstance()]);
}, 60_000);

afterAll(async () => {
  await Promise.all([a?.app.close(), b?.app.close()]);
  await Promise.all([a?.drop(), b?.drop()]);
});

async function signUp(instance: Instance) {
  const client = new Client(() => instance.app);
  const user = newUser();
  const response = await client.post('/api/v1/auth/register', user);
  expect(response.statusCode).toBe(201);
  return { client, account: response.json().user.account as { id: string; username: string } };
}

describe('discovery', () => {
  it('lets servers check the instance actor through WebFinger, as Mastodon does', async () => {
    const actor = (await (
      await fetch(`${a.url}/users/~actor`, { headers: { accept: 'application/activity+json' } })
    ).json()) as { id: string; preferredUsername: string };
    const finger = await fetch(
      `${a.url}/.well-known/webfinger?resource=acct:${actor.preferredUsername}@${a.domain}`,
    );
    expect(finger.status).toBe(200);
    const jrd = (await finger.json()) as { links: { rel: string; href?: string }[] };
    expect(jrd.links.find((l) => l.rel === 'self')?.href).toBe(actor.id);
  });

  it('serves WebFinger with ActivityPub and diaspora links, and NodeInfo with both protocols', async () => {
    const { account } = await signUp(a);
    const finger = await fetch(
      `${a.url}/.well-known/webfinger?resource=acct:${account.username}@${a.domain}`,
    );
    expect(finger.status).toBe(200);
    const jrd = (await finger.json()) as { links: { rel: string }[] };
    const rels = jrd.links.map((l: { rel: string }) => l.rel);
    expect(rels).toEqual(
      expect.arrayContaining([
        'self',
        'http://microformats.org/profile/hcard',
        'http://joindiaspora.com/seed_location',
      ]),
    );

    const actor = await fetch(`${a.url}/users/${account.username}`, {
      headers: { accept: 'application/activity+json' },
    });
    const person = (await actor.json()) as { publicKey: { publicKeyPem: string } };
    expect(person).toMatchObject({
      type: 'Person',
      preferredUsername: account.username,
      inbox: expect.any(String),
    });
    expect(person.publicKey.publicKeyPem).toContain('BEGIN PUBLIC KEY');

    const browser = await fetch(`${a.url}/users/${account.username}`, {
      headers: { accept: 'text/html' },
      redirect: 'manual',
    });
    expect(browser.status).toBe(302);
    expect(browser.headers.get('location')).toBe(`/@${account.username}`);

    const links = (await (await fetch(`${a.url}/.well-known/nodeinfo`)).json()) as {
      links: { href: string }[];
    };
    const nodeinfo = (await (await fetch(links.links[0]?.href ?? '')).json()) as {
      software: { name: string };
      protocols: string[];
    };
    expect(nodeinfo.software.name).toBe('disbigle');
    expect(nodeinfo.protocols).toEqual(['activitypub', 'diaspora']);
  });
});

describe('federation between two instances', () => {
  it('follows, delivers posts, likes, replies and deletions both ways', async () => {
    const alice = await signUp(a);
    const bob = await signUp(b);

    // Alice finds Bob on the other server.
    const resolved = await alice.client.post('/api/v1/search/resolve', {
      q: `${b.url}/users/${bob.account.username}`,
    });
    expect(resolved.statusCode).toBe(200);
    const remoteBob = resolved.json();
    expect(remoteBob).toMatchObject({
      username: bob.account.username,
      acct: `${bob.account.username}@${b.domain}`,
      local: false,
    });

    // Follow: request, then accepted by Bob's server.
    await alice.client.post(`/api/v1/accounts/${remoteBob.id}/follow`);
    await eventually(async () => {
      const rel = (
        await alice.client.get(`/api/v1/accounts/relationships?id[]=${remoteBob.id}`)
      ).json();
      return rel[0]?.following;
    });
    const bobFollowers = (
      await bob.client.get(`/api/v1/accounts/${bob.account.id}/followers`)
    ).json();
    expect(bobFollowers.map((f: { acct: string }) => f.acct)).toEqual([
      `${alice.account.username}@${a.domain}`,
    ]);

    // Bob posts; Alice receives it in her home timeline.
    const post = (
      await bob.client.post('/api/v1/statuses', { content: 'Ciao dal **server B** #federation' })
    ).json();
    const received = await eventually(async () => {
      const home = (await alice.client.get('/api/v1/timelines/home')).json();
      return home.find((s: { uri: string }) => s.uri === post.uri);
    });
    expect(received.content).toContain('<strong>server B</strong>');
    expect(received.account.acct).toBe(`${bob.account.username}@${b.domain}`);
    expect(received.tags).toEqual([{ name: 'federation' }]);

    // Bob edits it; Alice's copy follows.
    await bob.client.request('PUT', `/api/v1/statuses/${post.id}`, {
      content: 'Ciao dal **server B** (modificato) #federation',
    });
    await eventually(async () =>
      (await alice.client.get(`/api/v1/statuses/${received.id}`))
        .json()
        .content.includes('modificato'),
    );

    // Alice likes it; Bob's server counts the like and notifies Bob.
    await alice.client.post(`/api/v1/statuses/${received.id}/like`);
    await eventually(
      async () => (await bob.client.get(`/api/v1/statuses/${post.id}`)).json().likesCount === 1,
    );
    const bobNotes = (await bob.client.get('/api/v1/notifications')).json();
    expect(bobNotes.map((n: { type: string }) => n.type)).toEqual(
      expect.arrayContaining(['follow', 'like']),
    );

    // Alice replies; the reply reaches Bob's thread.
    const reply = (
      await alice.client.post('/api/v1/statuses', {
        content: `@${bob.account.username}@${b.domain} bellissimo!`,
        inReplyToId: received.id,
      })
    ).json();
    expect(reply.mentions[0]?.acct).toBe(`${bob.account.username}@${b.domain}`);
    const context = await eventually(async () => {
      const ctx = (await bob.client.get(`/api/v1/statuses/${post.id}/context`)).json();
      return ctx.descendants.length === 1 ? ctx : null;
    });
    expect(context.descendants[0].account.acct).toBe(`${alice.account.username}@${a.domain}`);

    // Bob deletes the post; it disappears on Alice's server.
    await bob.client.delete(`/api/v1/statuses/${post.id}`);
    await eventually(
      async () => (await alice.client.get(`/api/v1/statuses/${received.id}`)).statusCode === 404,
    );
  });

  it('delivers aspect-limited posts only to the chosen remote people', async () => {
    const alice = await signUp(a);
    const carol = await signUp(a);
    const bob = await signUp(b);
    const remoteAlice = (
      await bob.client.post('/api/v1/search/resolve', {
        q: `${a.url}/users/${alice.account.username}`,
      })
    ).json();
    const remoteCarol = (
      await bob.client.post('/api/v1/search/resolve', {
        q: `${a.url}/users/${carol.account.username}`,
      })
    ).json();
    // Carol follows Bob but is not in the aspect.
    await bob.client.post(`/api/v1/accounts/${remoteCarol.id}/follow`); // irrelevant direction; ensures actor known
    const aspects = (await bob.client.get('/api/v1/aspects')).json();
    await bob.client.put(`/api/v1/accounts/${remoteAlice.id}/aspects`, {
      aspectIds: [aspects[0].id],
    });

    const post = (
      await bob.client.post('/api/v1/statuses', {
        content: 'solo per la famiglia',
        visibility: 'limited',
        aspectIds: [aspects[0].id],
      })
    ).json();
    const received = await eventually(async () => {
      const home = (await alice.client.get('/api/v1/timelines/home')).json();
      return home.find((s: { uri: string }) => s.uri === post.uri);
    });
    expect(['limited', 'direct']).toContain(received.visibility);
    const carolHome = (await carol.client.get('/api/v1/timelines/home')).json();
    expect(carolHome.find((s: { uri: string }) => s.uri === post.uri)).toBeUndefined();
    expect((await carol.client.get(`/api/v1/statuses/${received.id}`)).statusCode).toBe(404);
  });

  it('fetches the missing parent of a reply so the thread is complete', async () => {
    const alice = await signUp(a);
    const bob = await signUp(b);
    const dave = await signUp(b);
    const remoteBob = (
      await alice.client.post('/api/v1/search/resolve', {
        q: `${b.url}/users/${bob.account.username}`,
      })
    ).json();
    await alice.client.post(`/api/v1/accounts/${remoteBob.id}/follow`);
    await eventually(
      async () =>
        (await alice.client.get(`/api/v1/accounts/relationships?id[]=${remoteBob.id}`)).json()[0]
          ?.following,
    );

    // Alice's server knows nothing about Dave or his post.
    const davePost = (
      await dave.client.post('/api/v1/statuses', { content: 'una domanda' })
    ).json();
    const reply = (
      await bob.client.post('/api/v1/statuses', {
        content: 'una risposta',
        inReplyToId: davePost.id,
      })
    ).json();

    const received = await eventually(async () => {
      const home = (await alice.client.get('/api/v1/timelines/home')).json();
      return home.find((s: { uri: string }) => s.uri === reply.uri);
    });
    expect(received.inReplyToId).not.toBeNull();
    const context = (await alice.client.get(`/api/v1/statuses/${received.id}/context`)).json();
    expect(context.ancestors.map((s: { uri: string }) => s.uri)).toEqual([davePost.uri]);
  });

  it('tells other servers when an account is deleted', async () => {
    const alice = await signUp(a);
    const bob = await signUp(b);
    const remoteBob = (
      await alice.client.post('/api/v1/search/resolve', {
        q: `${b.url}/users/${bob.account.username}`,
      })
    ).json();
    await alice.client.post(`/api/v1/accounts/${remoteBob.id}/follow`);
    await eventually(
      async () =>
        (await alice.client.get(`/api/v1/accounts/relationships?id[]=${remoteBob.id}`)).json()[0]
          ?.following,
    );
    await bob.client.post('/api/v1/statuses', { content: 'addio' });
    await eventually(
      async () => (await alice.client.get('/api/v1/timelines/home')).json().length > 0,
    );

    // Alice deletes her account: Bob's server forgets her.
    const remoteAlice = (
      await bob.client.get(`/api/v1/accounts/${bob.account.id}/followers`)
    ).json()[0];
    expect(remoteAlice.acct).toBe(`${alice.account.username}@${a.domain}`);
    await alice.client.post('/api/v1/me/delete', { password: 'correct horse battery staple' });
    await eventually(
      async () => (await bob.client.get(`/api/v1/accounts/${remoteAlice.id}`)).statusCode === 404,
    );
    const gone = await fetch(`${a.url}/users/${alice.account.username}`, {
      headers: { accept: 'application/activity+json' },
    });
    expect(gone.status).toBe(410);
  });

  it('moves an account to another server, taking its followers along', async () => {
    const carol = await signUp(a); // moving away from server A
    const dan = await signUp(a); // follower on the same server
    const bob = await signUp(b); // follower on the other server
    const carla = await signUp(b); // Carol's new account on server B

    const remoteCarol = (
      await bob.client.post('/api/v1/search/resolve', {
        q: `${a.url}/users/${carol.account.username}`,
      })
    ).json();
    await bob.client.post(`/api/v1/accounts/${remoteCarol.id}/follow`);
    await eventually(
      async () =>
        (await bob.client.get(`/api/v1/accounts/relationships?id[]=${remoteCarol.id}`)).json()[0]
          ?.following,
    );
    await dan.client.post(`/api/v1/accounts/${carol.account.id}/follow`);

    // The new account declares the old one as an alias, then the old one moves.
    const alias = await carla.client.post('/api/v1/me/migration/aliases', {
      accounts: [`${a.url}/users/${carol.account.username}`],
    });
    expect(alias.json().aliases).toEqual([`${a.url}/users/${carol.account.username}`]);
    const remoteCarla = (
      await carol.client.post('/api/v1/search/resolve', {
        q: `${b.url}/users/${carla.account.username}`,
      })
    ).json();
    expect(
      (
        await carol.client.post('/api/v1/me/migration/move', {
          target: `${b.url}/users/${carla.account.username}`,
          password: 'wrong',
        })
      ).statusCode,
    ).toBe(403);
    const moved = await carol.client.post('/api/v1/me/migration/move', {
      target: `${b.url}/users/${carla.account.username}`,
      password: 'correct horse battery staple',
    });
    expect(moved.statusCode).toBe(200);

    // Dan (same server as Carol) now follows Carla; Bob (on Carla's server) too.
    await eventually(
      async () =>
        (await dan.client.get(`/api/v1/accounts/relationships?id[]=${remoteCarla.id}`)).json()[0]
          ?.following,
    );
    await eventually(
      async () =>
        (await bob.client.get(`/api/v1/accounts/relationships?id[]=${carla.account.id}`)).json()[0]
          ?.following,
    );
    expect(
      (await bob.client.get(`/api/v1/accounts/relationships?id[]=${remoteCarol.id}`)).json()[0]
        ?.following,
    ).toBe(false);
    expect((await dan.client.get(`/api/v1/accounts/${carol.account.id}`)).json().movedToId).toBe(
      remoteCarla.id,
    );
  });

  it("shows a remote account's earlier public posts on first visit", async () => {
    const alice = await signUp(a);
    const bob = await signUp(b);
    const older = (await bob.client.post('/api/v1/statuses', { content: 'scritto prima' })).json();
    await bob.client.post('/api/v1/statuses', {
      content: 'solo follower',
      visibility: 'followers',
    });

    const remoteBob = (
      await alice.client.post('/api/v1/search/resolve', {
        q: `${b.url}/users/${bob.account.username}`,
      })
    ).json();
    const statuses = (await alice.client.get(`/api/v1/accounts/${remoteBob.id}/statuses`)).json();
    expect(statuses.map((s: { uri: string }) => s.uri)).toEqual([older.uri]);
  });

  it('federates polls and their votes', async () => {
    const alice = await signUp(a);
    const bob = await signUp(b);
    const remoteBob = (
      await alice.client.post('/api/v1/search/resolve', {
        q: `${b.url}/users/${bob.account.username}`,
      })
    ).json();
    await alice.client.post(`/api/v1/accounts/${remoteBob.id}/follow`);
    await eventually(
      async () =>
        (await alice.client.get(`/api/v1/accounts/relationships?id[]=${remoteBob.id}`)).json()[0]
          ?.following,
    );

    const post = (
      await bob.client.post('/api/v1/statuses', {
        content: 'Mare o montagna?',
        poll: { options: ['Mare', 'Montagna'], expiresIn: 3600 },
      })
    ).json();
    const received = await eventually(async () =>
      (await alice.client.get('/api/v1/timelines/home'))
        .json()
        .find((s: { uri: string }) => s.uri === post.uri),
    );
    expect(received.poll).toMatchObject({
      multiple: false,
      options: [{ title: 'Mare' }, { title: 'Montagna' }],
    });

    const voted = await alice.client.post(`/api/v1/polls/${received.poll.id}/votes`, {
      choices: [1],
    });
    expect(voted.json().poll).toMatchObject({ voted: true, ownVotes: [1] });
    // Bob's server counts the vote and sends back the new totals.
    await eventually(
      async () =>
        (await bob.client.get(`/api/v1/statuses/${post.id}`)).json().poll.options[1].votesCount ===
        1,
    );
    await eventually(async () => {
      const poll = (await alice.client.get(`/api/v1/statuses/${received.id}`)).json().poll;
      return poll.votersCount === 1 && poll.options[1].votesCount === 1;
    });

    // Multiple choice: one vote object per choice, all of them counted.
    const multi = (
      await bob.client.post('/api/v1/statuses', {
        content: 'Cosa porti?',
        poll: { options: ['Pane', 'Vino', 'Olio'], expiresIn: 3600, multiple: true },
      })
    ).json();
    const multiReceived = await eventually(async () =>
      (await alice.client.get('/api/v1/timelines/home'))
        .json()
        .find((s: { uri: string }) => s.uri === multi.uri),
    );
    await alice.client.post(`/api/v1/polls/${multiReceived.poll.id}/votes`, { choices: [0, 2] });
    await eventually(async () => {
      const poll = (await bob.client.get(`/api/v1/statuses/${multi.id}`)).json().poll;
      return (
        poll.votersCount === 1 &&
        poll.options[0].votesCount === 1 &&
        poll.options[2].votesCount === 1
      );
    });
  });

  it('imports a remote post by URL', async () => {
    const alice = await signUp(a);
    const bob = await signUp(b);
    const post = (
      await bob.client.post('/api/v1/statuses', { content: 'trovami per link' })
    ).json();
    const resolved = await alice.client.post('/api/v1/search/resolve_status', { q: post.uri });
    expect(resolved.json()).toMatchObject({
      uri: post.uri,
      content: expect.stringContaining('trovami'),
    });
    expect(
      (await alice.client.post(`/api/v1/statuses/${resolved.json().id}/like`)).json().liked,
    ).toBe(true);
    await eventually(
      async () => (await bob.client.get(`/api/v1/statuses/${post.id}`)).json().likesCount === 1,
    );
  });
});
