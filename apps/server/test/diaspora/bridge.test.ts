import {
  ActivityPubPublisher,
  CompositeEventBus,
  createDisbigleFederation,
} from '@disbigle/activitypub';
import { type CoreContext, MemoryKeyValueStore } from '@disbigle/core';
import { createTestDatabase } from '@disbigle/db/testing';
import { DiasporaBridge, DiasporaPublisher, diasporaRoutes } from '@disbigle/diaspora-bridge';
import { MemoryKvStore } from '@fedify/fedify';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import {
  eventually,
  freePort,
  type Instance,
  signUp,
  startInstance,
  testConfig,
} from './helpers.ts';

interface Server {
  app: FastifyInstance;
  domain: string;
  url: string;
  close: () => Promise<void>;
}

/** A server like a production one: ActivityPub and diaspora* both published. */
async function startHub(): Promise<Instance> {
  const port = await freePort();
  const domain = `127.0.0.1:${port}`;
  const url = `http://${domain}`;
  const testDb = await createTestDatabase();
  const ctx: CoreContext = {
    db: testDb.db,
    config: { ...testConfig, PUBLIC_URL: url, LOCAL_DOMAIN: domain },
    kv: new MemoryKeyValueStore(),
    rsaKeyBits: 1024,
  };
  const federation = createDisbigleFederation({
    kv: new MemoryKvStore(),
    allowPrivateAddress: true,
  });
  const bridge = new DiasporaBridge({
    ctx,
    allowHttp: true,
    allowPrivateAddress: true,
    onError: (error) => console.error(`[hub ${domain}]`, error),
  });
  ctx.events = new CompositeEventBus([
    new ActivityPubPublisher(federation, ctx),
    new DiasporaPublisher(bridge),
  ]);
  ctx.resolveAccount = bridge.resolveAccount;
  const app = await buildApp({ ctx, federation, disableRateLimit: true });
  await app.register(diasporaRoutes, { ctx, bridge });
  await app.listen({ host: '127.0.0.1', port });
  return {
    app,
    ctx,
    bridge,
    domain,
    url,
    close: async () => {
      await app.close();
      await bridge.idle();
      await testDb.drop();
    },
  };
}

/** A server that speaks ActivityPub only. */
async function startActivityPubOnly(): Promise<Server> {
  const port = await freePort();
  const domain = `127.0.0.1:${port}`;
  const url = `http://${domain}`;
  const testDb = await createTestDatabase();
  const ctx: CoreContext = {
    db: testDb.db,
    config: { ...testConfig, PUBLIC_URL: url, LOCAL_DOMAIN: domain },
    kv: new MemoryKeyValueStore(),
    rsaKeyBits: 1024,
  };
  const federation = createDisbigleFederation({
    kv: new MemoryKvStore(),
    allowPrivateAddress: true,
  });
  ctx.events = new ActivityPubPublisher(federation, ctx);
  const app = await buildApp({ ctx, federation, disableRateLimit: true });
  await app.listen({ host: '127.0.0.1', port });
  return {
    app,
    domain,
    url,
    close: async () => {
      await app.close();
      await testDb.drop();
    },
  };
}

let hub: Instance;
let pod: Instance;
let ap: Server;

beforeAll(async () => {
  [hub, pod, ap] = await Promise.all([startHub(), startInstance(), startActivityPubOnly()]);
}, 90_000);

afterAll(async () => {
  await Promise.all([hub?.close(), pod?.close(), ap?.close()]);
});

const textOf = (html: string) => html.replace(/<[^>]+>/g, '');

describe('bridge identities', () => {
  it('carries comments between diaspora* and ActivityPub on a local thread', async () => {
    const alice = await signUp(hub);
    const dora = await signUp(pod); // diaspora* only
    const paul = await signUp(ap as unknown as Instance); // ActivityPub only

    // dora follows alice over diaspora*, paul over ActivityPub.
    const aliceOnPod = await pod.bridge.resolvePerson(`${alice.account.username}@${hub.domain}`);
    if (!aliceOnPod) throw new Error('alice not found from the pod');
    await dora.client.post(`/api/v1/accounts/${aliceOnPod.id}/follow`);
    const aliceOnAp = (
      await paul.client.post('/api/v1/search/resolve', {
        q: `${hub.url}/users/${alice.account.username}`,
      })
    ).json();
    await paul.client.post(`/api/v1/accounts/${aliceOnAp.id}/follow`);
    await eventually(async () => {
      const list = (
        await alice.client.get(`/api/v1/accounts/${alice.account.id}/followers`)
      ).json();
      return list.length === 2;
    });

    const post = (
      await alice.client.post('/api/v1/statuses', { content: 'Una domanda per tutti' })
    ).json();
    const onPod = await eventually(async () =>
      (await dora.client.get('/api/v1/timelines/home'))
        .json()
        .find((s: { content: string }) => s.content.includes('Una domanda')),
    );
    const onAp = await eventually(async () =>
      (await paul.client.get('/api/v1/timelines/home'))
        .json()
        .find((s: { content: string }) => s.content.includes('Una domanda')),
    );

    // paul (ActivityPub) answers: dora sees it, from paul's bridge identity on the hub.
    const paulReply = (
      await paul.client.post('/api/v1/statuses', {
        content: 'Risposta da ActivityPub',
        inReplyToId: onAp.id,
      })
    ).json();
    const bridgedToPod = await eventually(async () => {
      const context = (await dora.client.get(`/api/v1/statuses/${onPod.id}/context`)).json();
      return context.descendants?.find((s: { content: string }) =>
        textOf(s.content).includes('Risposta da ActivityPub'),
      );
    });
    expect(bridgedToPod.account.acct).toMatch(
      new RegExp(
        `^${paul.account.username}_at_127\\.0\\.0\\.1_\\d+@${hub.domain.replace(/\./g, '\\.')}$`,
      ),
    );
    expect(bridgedToPod.account.displayName).toBe(paul.account.username);

    // dora (diaspora*) answers: paul sees it, from dora's bridge identity on the hub.
    const doraReply = (
      await dora.client.post('/api/v1/statuses', {
        content: 'Risposta da diaspora',
        inReplyToId: onPod.id,
      })
    ).json();
    const bridgedToAp = await eventually(async () => {
      const context = (await paul.client.get(`/api/v1/statuses/${onAp.id}/context`)).json();
      return context.descendants?.find((s: { content: string }) =>
        textOf(s.content).includes('Risposta da diaspora'),
      );
    });
    expect(bridgedToAp.account.acct).toMatch(
      new RegExp(
        `^${dora.account.username}_at_127\\.0\\.0\\.1_\\d+@${hub.domain.replace(/\./g, '\\.')}$`,
      ),
    );

    // paul likes alice's post, then changes his mind: dora's copy follows along.
    await paul.client.post(`/api/v1/statuses/${onAp.id}/like`);
    await eventually(
      async () => (await dora.client.get(`/api/v1/statuses/${onPod.id}`)).json().likesCount === 1,
    );
    await paul.client.post(`/api/v1/statuses/${onAp.id}/unlike`);
    await eventually(
      async () => (await dora.client.get(`/api/v1/statuses/${onPod.id}`)).json().likesCount === 0,
    );

    // paul likes dora's reply (a bridged Note for him): the like reaches dora on diaspora*.
    await paul.client.post(`/api/v1/statuses/${bridgedToAp.id}/like`);
    await eventually(async () => {
      const context = (await dora.client.get(`/api/v1/statuses/${onPod.id}/context`)).json();
      return context.descendants?.find(
        (s: { content: string; likesCount: number }) =>
          textOf(s.content).includes('Risposta da diaspora') && s.likesCount === 1,
      );
    });

    // On the hub itself, both replies come from the real accounts, not the bridges.
    const onHub = (await alice.client.get(`/api/v1/statuses/${post.id}/context`)).json();
    expect(
      onHub.descendants.map((s: { account: { acct: string } }) => s.account.acct).sort(),
    ).toEqual(
      [`${dora.account.username}@${pod.domain}`, `${paul.account.username}@${ap.domain}`].sort(),
    );

    // The bridge actor tells what it is, and a browser is sent to the real profile.
    const bridgeName = bridgedToAp.account.acct.split('@')[0];
    const actor = (await (
      await fetch(`${hub.url}/users/${bridgeName}`, {
        headers: { accept: 'application/activity+json' },
      })
    ).json()) as { summary: string };
    expect(actor.summary).toContain('Bridge account');
    const page = await fetch(`${hub.url}/users/${bridgeName}`, { redirect: 'manual' });
    expect(page.headers.get('location')).toBe(`/@${dora.account.username}@${pod.domain}`);

    // Deletions cross too: each side loses the other's reply.
    const replies = async (client: typeof dora.client, id: string) =>
      (await client.get(`/api/v1/statuses/${id}/context`))
        .json()
        .descendants.map((s: { content: string }) => textOf(s.content));
    await paul.client.delete(`/api/v1/statuses/${paulReply.id}`);
    await eventually(
      async () =>
        !(await replies(dora.client, onPod.id)).some((t: string) => t.includes('ActivityPub')),
    );
    await dora.client.delete(`/api/v1/statuses/${doraReply.id}`);
    await eventually(
      async () =>
        !(await replies(paul.client, onAp.id)).some((t: string) => t.includes('diaspora')),
    );
  }, 120_000);
});
