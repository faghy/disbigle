import { generateKeyPairSync } from 'node:crypto';
import {
  type CoreContext,
  createPost,
  deletePost,
  follow,
  MemoryKeyValueStore,
  registerUser,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import { createTestDatabase } from '@disbigle/db/testing';
import {
  buildHCard,
  buildWebFinger,
  createMagicEnvelope,
  type Entity,
  encryptMagicEnvelope,
  parseEntity,
  serializeEntity,
  unenvelop,
} from '@disbigle/diaspora';
import { and, eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DiasporaBridge } from '../src/bridge.ts';
import { DiasporaPublisher } from '../src/publisher.ts';
import { diasporaRoutes } from '../src/routes.ts';
import { ALICE_PRIVATE_KEY, ALICE_PUBLIC_KEY, COMMENT_XML_ALICE } from './gem-fixtures.ts';
import { newUser, testConfig } from './helpers.ts';

/** Fake remote diaspora* people, served through a mocked `fetch` (WebFinger + hCard). */
interface FakePerson {
  id: string;
  guid: string;
  publicKey: string;
  privateKey: string;
  name: string;
}

function fakePerson(
  id: string,
  guid: string,
  keys?: { publicKey: string; privateKey: string },
): FakePerson {
  const pair =
    keys ??
    (() => {
      const k = generateKeyPairSync('rsa', { modulusLength: 1024 });
      return {
        publicKey: k.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        privateKey: k.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
      };
    })();
  return { id, guid, name: id.split('@')[0] ?? id, ...pair };
}

const people = new Map<string, FakePerson>();
const fakeFetch: typeof fetch = async (input) => {
  const url = new URL(String(input));
  if (url.pathname === '/.well-known/webfinger') {
    const id = (url.searchParams.get('resource') ?? '').replace(/^acct:/, '');
    const person = people.get(id);
    if (!person) return new Response('', { status: 404 });
    const host = id.split('@')[1];
    return Response.json(
      buildWebFinger({
        diasporaId: id,
        hcardUrl: `https://${host}/hcard/users/${person.guid}`,
        seedUrl: `https://${host}/`,
      }),
    );
  }
  const guid = /^\/hcard\/users\/(.+)$/.exec(url.pathname)?.[1];
  const person = [...people.values()].find((p) => p.guid === guid);
  if (!person) return new Response('', { status: 404 });
  return new Response(
    buildHCard({
      guid: person.guid,
      fullName: person.name,
      firstName: person.name,
      lastName: '',
      publicKey: person.publicKey,
      photoLargeUrl: `https://${url.host}/avatar.png`,
      photoMediumUrl: `https://${url.host}/avatar.png`,
      photoSmallUrl: `https://${url.host}/avatar.png`,
      searchable: true,
    }),
  );
};

const alice = fakePerson('alice@pod-a.org', 'aaaaaaaaaaaaaaaa', {
  publicKey: ALICE_PUBLIC_KEY,
  privateKey: ALICE_PRIVATE_KEY,
});
const dave = fakePerson('dave@pod-d.org', 'dddddddddddddddd');
people.set(alice.id, alice);
people.set(dave.id, dave);

const DOMAIN = 'local.example';
let ctx: CoreContext;
let drop: () => Promise<void>;
let bridge: DiasporaBridge;
let app: FastifyInstance;
const sent: Array<{ url: string; body: string; contentType: string }> = [];

beforeAll(async () => {
  const testDb = await createTestDatabase();
  drop = testDb.drop;
  ctx = {
    db: testDb.db,
    config: { ...testConfig, PUBLIC_URL: `https://${DOMAIN}`, LOCAL_DOMAIN: DOMAIN },
    kv: new MemoryKeyValueStore(),
    rsaKeyBits: 1024,
  };
  bridge = new DiasporaBridge({
    ctx,
    fetch: fakeFetch,
    deliver: async (url, body, contentType) => {
      sent.push({ url, body, contentType });
    },
    onError: (error) => {
      throw error;
    },
  });
  ctx.events = new DiasporaPublisher(bridge);
  app = Fastify();
  await app.register(diasporaRoutes, { ctx, bridge });
}, 60_000);

afterAll(async () => {
  await app?.close();
  await drop?.();
});

beforeEach(() => {
  sent.length = 0;
});

async function localUser() {
  const user = newUser();
  const { actorId } = await registerUser(ctx, user);
  const [actor] = await ctx.db.select().from(schema.actors).where(eq(schema.actors.id, actorId));
  if (!actor) throw new Error('no actor');
  return { actor, id: `${actor.username}@${DOMAIN}` };
}

const envelopeFrom = (person: FakePerson, entity: Entity | string) =>
  createMagicEnvelope(
    typeof entity === 'string' ? entity : serializeEntity(entity),
    person.id,
    person.privateKey,
  );

async function postByGuid(guid: string) {
  const [row] = await ctx.db.select().from(schema.posts).where(eq(schema.posts.diasporaGuid, guid));
  return row;
}

describe('gem fixture: relayable comment on a local post', () => {
  it('verifies, stores and relays the comment byte for byte', async () => {
    const bob = await localUser();
    const post = await createPost(ctx, bob.actor.id, { content: 'parent post' });
    await ctx.db
      .update(schema.posts)
      .set({ diasporaGuid: '9e269ae0b41201333b8c0f77ba60fa73' })
      .where(eq(schema.posts.id, post.id));
    // dave (another pod) follows bob, so he must receive the relayed comment.
    const daveRow = await bridge.resolvePerson(dave.id);
    if (!daveRow) throw new Error('dave not resolved');
    await follow(ctx, daveRow.id, bob.actor.id);
    await bridge.idle();
    sent.length = 0;

    // Alice (author, pod-a.org) sends her comment directly to the root author's pod.
    const message = await bridge.receivePublic(envelopeFrom(alice, COMMENT_XML_ALICE));
    expect(message?.entity.type).toBe('Comment');
    const comment = await postByGuid('e21589b0b41101333b870f77ba60fa73');
    expect(comment).toMatchObject({ inReplyToId: post.id, local: false, visibility: 'public' });
    expect(comment?.contentHtml).toContain('this is a very informative comment');

    await bridge.idle();
    const relay = sent.find((s) => s.url === 'https://pod-d.org/receive/public');
    expect(relay?.contentType).toBe('application/magic-envelope+xml');
    const opened = await unenvelop(relay?.body ?? '', {
      fetchPublicKey: () => bob.actor.publicKeyPem,
    });
    expect(opened.sender).toBe(bob.id);
    expect(opened.payloadXml).toBe(COMMENT_XML_ALICE.trim());
    // Not sent back to the author's pod.
    expect(sent.some((s) => s.url.startsWith('https://pod-a.org/'))).toBe(false);
  });

  it('rejects a tampered comment', async () => {
    const tampered = COMMENT_XML_ALICE.replace('informative', 'forged').replace(
      'e21589b0b41101333b870f77ba60fa73',
      'f21589b0b41101333b870f77ba60fa73',
    );
    await expect(bridge.receivePublic(envelopeFrom(alice, tampered))).rejects.toThrow();
    expect(await postByGuid('f21589b0b41101333b870f77ba60fa73')).toBeUndefined();
  });
});

describe('incoming entities', () => {
  it('StatusMessage: markdown, mentions, tags and photos', async () => {
    const bob = await localUser();
    const guid = 'a0000000000000000000000000000001';
    await bridge.receivePublic(
      envelopeFrom(dave, {
        type: 'StatusMessage',
        author: dave.id,
        guid,
        public: true,
        text: `Hello @{Bob; ${bob.id}} **world** #diaspora`,
        photos: [
          {
            type: 'Photo',
            guid: 'b0000000000000000000000000000001',
            author: dave.id,
            remotePhotoPath: 'https://pod-d.org/uploads/images/',
            remotePhotoName: 'x.png',
            width: 10,
            height: 20,
          },
        ],
      }),
    );
    const post = await postByGuid(guid);
    expect(post?.visibility).toBe('public');
    expect(post?.contentHtml).toContain('<strong>world</strong>');
    expect(post?.contentHtml).toContain(`/@${bob.actor.username}`);
    const [media] = await ctx.db
      .select()
      .from(schema.mediaAttachments)
      .where(eq(schema.mediaAttachments.postId, post?.id ?? ''));
    expect(media).toMatchObject({
      remoteUrl: 'https://pod-d.org/uploads/images/x.png',
      mimeType: 'image/png',
    });
    const mentioned = await ctx.db
      .select()
      .from(schema.mentions)
      .where(eq(schema.mentions.postId, post?.id ?? ''));
    expect(mentioned.map((m) => m.actorId)).toEqual([bob.actor.id]);
  });

  it('rejects non-public posts on the public route and accepts them privately', async () => {
    const bob = await localUser();
    const carol = await localUser();
    const guid = 'a0000000000000000000000000000002';
    const entity: Entity = {
      type: 'StatusMessage',
      author: dave.id,
      guid,
      public: false,
      text: 'secret',
    };
    await expect(bridge.receivePublic(envelopeFrom(dave, entity))).rejects.toThrow(/public/);

    const body = (recipient: typeof bob) =>
      encryptMagicEnvelope(envelopeFrom(dave, entity), recipient.actor.publicKeyPem);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/receive/users/${bob.actor.diasporaGuid}`,
          payload: body(bob),
          headers: { 'content-type': 'application/json' },
        })
      ).statusCode,
    ).toBe(202);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/receive/users/ffffffffffffffff',
          payload: body(bob),
          headers: { 'content-type': 'application/json' },
        })
      ).statusCode,
    ).toBe(404);
    await bridge.idle();
    await bridge.receivePrivate(carol.actor, body(carol));
    const post = await postByGuid(guid);
    expect(post?.visibility).toBe('limited');
    const audience = await ctx.db
      .select()
      .from(schema.postAudiences)
      .where(eq(schema.postAudiences.postId, post?.id ?? ''));
    expect(audience.map((r) => r.actorId).sort()).toEqual([bob.actor.id, carol.actor.id].sort());
  });

  it('Contact: sharing follows, not sharing unfollows', async () => {
    const bob = await localUser();
    const contact = (sharing: boolean): Entity => ({
      type: 'Contact',
      author: dave.id,
      recipient: bob.id,
      following: sharing,
      sharing,
    });
    const daveRow = await bridge.resolvePerson(dave.id);
    const isFollowing = async () =>
      (
        await ctx.db
          .select()
          .from(schema.follows)
          .where(
            and(
              eq(schema.follows.actorId, daveRow?.id ?? ''),
              eq(schema.follows.targetActorId, bob.actor.id),
            ),
          )
      ).length === 1;
    await bridge.receivePublic(envelopeFrom(dave, contact(true)));
    expect(await isFollowing()).toBe(true);
    await bridge.receivePublic(envelopeFrom(dave, contact(false)));
    expect(await isFollowing()).toBe(false);
  });

  it('rejects entities whose author is not the sender', async () => {
    const forged: Entity = {
      type: 'StatusMessage',
      author: alice.id,
      guid: 'a0000000000000000000000000000003',
      public: true,
      text: 'x',
    };
    await expect(bridge.receivePublic(envelopeFrom(dave, forged))).rejects.toThrow();
  });

  it('Profile, Retraction and AccountDeletion', async () => {
    const eve = fakePerson('eve@pod-e.org', 'eeeeeeeeeeeeeeee');
    people.set(eve.id, eve);
    await bridge.receivePublic(
      envelopeFrom(eve, { type: 'Profile', author: eve.id, fullName: 'Eve Example', public: true }),
    );
    const row = await bridge.resolvePerson(eve.id);
    expect(row?.displayName).toBe('Eve Example');

    const guid = 'a0000000000000000000000000000004';
    await bridge.receivePublic(
      envelopeFrom(eve, { type: 'StatusMessage', author: eve.id, guid, public: true, text: 'bye' }),
    );
    expect(await postByGuid(guid)).toBeDefined();
    await bridge.receivePublic(
      envelopeFrom(eve, {
        type: 'Retraction',
        author: eve.id,
        targetGuid: guid,
        targetType: 'Post',
      }),
    );
    expect(await postByGuid(guid)).toBeUndefined();

    await bridge.receivePublic(envelopeFrom(eve, { type: 'AccountDeletion', author: eve.id }));
    const [gone] = await ctx.db
      .select()
      .from(schema.actors)
      .where(eq(schema.actors.id, row?.id ?? ''));
    expect(gone).toBeUndefined();
  });
});

describe('outgoing', () => {
  it('sends public posts once per pod and deletions as Retraction', async () => {
    const bob = await localUser();
    const daveRow = await bridge.resolvePerson(dave.id);
    await follow(ctx, daveRow?.id ?? '', bob.actor.id);
    await bridge.idle();
    sent.length = 0;
    const post = await createPost(ctx, bob.actor.id, { content: `hello @${bob.actor.username}` });
    await bridge.idle();
    expect(sent.map((s) => s.url)).toEqual(['https://pod-d.org/receive/public']);
    const opened = await unenvelop(sent[0]?.body ?? '', {
      fetchPublicKey: () => bob.actor.publicKeyPem,
    });
    const entity = parseEntity(opened.payloadXml);
    expect(entity).toMatchObject({ type: 'StatusMessage', author: bob.id, public: true });

    sent.length = 0;
    await deletePost(ctx, bob.actor.id, post.id);
    await bridge.idle();
    const retraction = parseEntity(
      (await unenvelop(sent[0]?.body ?? '', { fetchPublicKey: () => bob.actor.publicKeyPem }))
        .payloadXml,
    );
    expect(retraction).toMatchObject({ type: 'Retraction', targetType: 'Post' });
  });

  it('sends AccountDeletion when a local account is deleted', async () => {
    const bob = await localUser();
    const daveRow = await bridge.resolvePerson(dave.id);
    await follow(ctx, daveRow?.id ?? '', bob.actor.id);
    await bridge.idle();
    sent.length = 0;
    await ctx.events?.publish({ type: 'account.deleted', actorId: bob.actor.id });
    await bridge.idle();
    const entity = parseEntity(
      (await unenvelop(sent[0]?.body ?? '', { fetchPublicKey: () => bob.actor.publicKeyPem }))
        .payloadXml,
    );
    expect(entity).toEqual({ type: 'AccountDeletion', author: bob.id });
  });

  it('serves public posts at /fetch and hides private ones', async () => {
    const bob = await localUser();
    const post = await createPost(ctx, bob.actor.id, { content: 'fetch me' });
    const row = (await ctx.db.select().from(schema.posts).where(eq(schema.posts.id, post.id)))[0];
    const response = await app.inject({ method: 'GET', url: `/fetch/post/${row?.diasporaGuid}` });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/magic-envelope+xml');
    const opened = await unenvelop(response.body, { fetchPublicKey: () => bob.actor.publicKeyPem });
    expect(parseEntity(opened.payloadXml)).toMatchObject({
      type: 'StatusMessage',
      text: 'fetch me',
    });

    const direct = await createPost(ctx, bob.actor.id, {
      content: `@${bob.actor.username} psst`,
      visibility: 'direct',
    }).catch(() => null);
    if (direct) {
      const drow = (
        await ctx.db.select().from(schema.posts).where(eq(schema.posts.id, direct.id))
      )[0];
      expect(
        (await app.inject({ method: 'GET', url: `/fetch/post/${drow?.diasporaGuid}` })).statusCode,
      ).toBe(404);
    }
    expect(
      (await app.inject({ method: 'GET', url: '/fetch/photo/whatever1234567890' })).statusCode,
    ).toBe(404);
  });

  it('serves the hCard and host-meta', async () => {
    const bob = await localUser();
    const hcard = await app.inject({
      method: 'GET',
      url: `/hcard/users/${bob.actor.diasporaGuid}`,
    });
    expect(hcard.body).toContain(`<span class="nickname">${bob.actor.username}</span>`);
    expect(hcard.body).toContain('BEGIN PUBLIC KEY');
    const hostMeta = await app.inject({ method: 'GET', url: '/.well-known/host-meta' });
    expect(hostMeta.body).toContain('rel="lrdd"');
  });
});
