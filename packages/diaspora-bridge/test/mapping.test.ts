import { generateKeyPairSync } from 'node:crypto';
import { isIP } from 'node:net';
import {
  type CoreContext,
  createPost,
  deletePost,
  follow,
  MemoryKeyValueStore,
  registerUser,
  votePoll,
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
  signAccountMigration,
  signRelayable,
  unenvelop,
  verifyAccountMigrationSignature,
  verifyRelayableSignature,
} from '@disbigle/diaspora';
import { validatePublicUrl } from '@fedify/vocab-runtime';
import { and, eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DiasporaBridge } from '../src/bridge.ts';
import { relayStored } from '../src/incoming.ts';
import { UnsafeUrlError } from '../src/net.ts';
import { answerGuid, answerGuids, pollOfPost } from '../src/polls.ts';
import { DiasporaPublisher } from '../src/publisher.ts';
import { diasporaRoutes } from '../src/routes.ts';
import { ALICE_PRIVATE_KEY, ALICE_PUBLIC_KEY, COMMENT_XML_ALICE } from './gem-fixtures.ts';
import { newUser, testConfig } from './helpers.ts';

/** Fake remote diaspora* people, served through a mocked `fetch` (WebFinger + hCard). */
interface FakePerson {
  id: string;
  guid: string;
  /** Overrides for hostile WebFinger documents. */
  hcardUrl?: string;
  seedUrl?: string;
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
        hcardUrl: person.hcardUrl ?? `https://${host}/hcard/users/${person.guid}`,
        seedUrl: person.seedUrl ?? `https://${host}/`,
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
const failures: unknown[] = [];

/** Real address check for IP literals; names are accepted without DNS (offline tests). */
const validateUrl = async (url: string) => {
  if (isIP(new URL(url).hostname.replace(/^\[|\]$/g, ''))) await validatePublicUrl(url);
};

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
    validateUrl,
    onError: (error) => {
      failures.push(error);
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

describe('stored relayables', () => {
  it('keeps received comments as signed, serves them at /fetch and relays them again', async () => {
    const guid = 'e21589b0b41101333b870f77ba60fa73';
    const record = await bridge.relayables.get(guid);
    expect(record).toMatchObject({ entityType: 'Comment', author: alice.id });
    expect(record?.xml).toBe(COMMENT_XML_ALICE.trim());

    const comment = await postByGuid(guid);
    const root = (
      await ctx.db
        .select()
        .from(schema.posts)
        .where(eq(schema.posts.id, comment?.inReplyToId ?? ''))
    )[0];
    const [rootAuthor] = await ctx.db
      .select()
      .from(schema.actors)
      .where(eq(schema.actors.id, root?.actorId ?? ''));
    const fetched = await app.inject({ method: 'GET', url: `/fetch/comment/${guid}` });
    expect(fetched.statusCode).toBe(200);
    const opened = await unenvelop(fetched.body, {
      fetchPublicKey: () => rootAuthor?.publicKeyPem ?? null,
    });
    expect(opened.payloadXml).toBe(COMMENT_XML_ALICE.trim());

    sent.length = 0;
    expect(await relayStored(bridge, guid)).toBe(true);
    await bridge.idle();
    expect(sent.map((s) => s.url)).toContain('https://pod-d.org/receive/public');
    expect(sent.some((s) => s.url.startsWith('https://pod-a.org/'))).toBe(false);
  });

  it('forgets a relayable when it is retracted', async () => {
    const guid = 'e21589b0b41101333b870f77ba60fa73';
    await bridge.receivePublic(
      envelopeFrom(alice, {
        type: 'Retraction',
        author: alice.id,
        targetGuid: guid,
        targetType: 'Comment',
      }),
    );
    expect(await bridge.relayables.get(guid)).toBeNull();
    expect(await postByGuid(guid)).toBeUndefined();
  });
});

describe('AccountMigration', () => {
  const oldFrank = fakePerson('frank@pod-f.org', 'ffffffffffffff01');
  const newFrank = fakePerson('frank@pod-g.org', 'ffffffffffffff02');
  people.set(oldFrank.id, oldFrank);
  people.set(newFrank.id, newFrank);

  const migration = (signWith: FakePerson) =>
    signAccountMigration(
      {
        type: 'AccountMigration',
        author: oldFrank.id,
        profile: { type: 'Profile', author: newFrank.id, fullName: 'Frank Moved' },
      },
      signWith.privateKey,
    );

  it('rejects a migration not signed by the new identity', async () => {
    const reader = await localUser();
    const origin = await bridge.resolvePerson(oldFrank.id);
    await follow(ctx, reader.actor.id, origin?.id ?? '');
    await expect(
      bridge.receivePublic(envelopeFrom(oldFrank, migration(oldFrank))),
    ).rejects.toThrow();
    const [row] = await ctx.db
      .select()
      .from(schema.actors)
      .where(eq(schema.actors.id, origin?.id ?? ''));
    expect(row?.movedToActorId).toBeNull();
  });

  it('moves local followers to the new identity', async () => {
    const reader = await localUser();
    const origin = await bridge.resolvePerson(oldFrank.id);
    await follow(ctx, reader.actor.id, origin?.id ?? '');
    await bridge.receivePublic(envelopeFrom(oldFrank, migration(newFrank)));
    await bridge.idle();
    const target = await bridge.resolvePerson(newFrank.id);
    expect(target?.displayName).toBe('Frank Moved');
    const following = await ctx.db
      .select({ id: schema.follows.targetActorId })
      .from(schema.follows)
      .where(eq(schema.follows.actorId, reader.actor.id));
    expect(following.map((f) => f.id)).toEqual([target?.id]);
    const [row] = await ctx.db
      .select()
      .from(schema.actors)
      .where(eq(schema.actors.id, origin?.id ?? ''));
    expect(row?.movedToActorId).toBe(target?.id);
    // The follow of the new identity was announced with a Contact.
    expect(sent.some((s) => s.url === 'https://pod-g.org/receive/users/ffffffffffffff02')).toBe(
      true,
    );
  });

  it('announces a move between two local accounts to diaspora* contacts', async () => {
    const origin = await localUser();
    const target = await localUser();
    const daveRow = await bridge.resolvePerson(dave.id);
    await follow(ctx, daveRow?.id ?? '', origin.actor.id);
    await bridge.idle();
    sent.length = 0;
    await ctx.events?.publish({
      type: 'account.moved',
      actorId: origin.actor.id,
      targetActorId: target.actor.id,
    });
    await bridge.idle();
    const delivery = sent.find((s) => s.url === 'https://pod-d.org/receive/public');
    const opened = await unenvelop(delivery?.body ?? '', {
      fetchPublicKey: () => origin.actor.publicKeyPem,
    });
    expect(opened.sender).toBe(origin.id);
    const entity = parseEntity(opened.payloadXml);
    if (entity.type !== 'AccountMigration') throw new Error('not a migration');
    expect(entity.author).toBe(origin.id);
    expect(entity.profile.author).toBe(target.id);
    expect(verifyAccountMigrationSignature(entity, target.actor.publicKeyPem)).toBe(true);
  });
});

describe('SSRF protection', () => {
  it('refuses a WebFinger that points the hCard at a private address', async () => {
    const eve = fakePerson('evil@pod-x.org', 'eeeeeeeeeeee0001');
    eve.hcardUrl = 'http://127.0.0.1:6380/hcard/users/eeeeeeeeeeee0001';
    people.set(eve.id, eve);
    await expect(bridge.resolvePerson(eve.id)).rejects.toThrow(UnsafeUrlError);
  });

  it('never POSTs to a receive URL on a private address', async () => {
    const mallory = fakePerson('mallory@pod-m.org', 'mmmmmmmmmmmm0001');
    mallory.seedUrl = 'https://10.0.0.5/';
    people.set(mallory.id, mallory);
    const bob = await localUser();
    await bridge.receivePublic(
      envelopeFrom(mallory, {
        type: 'Contact',
        author: mallory.id,
        recipient: bob.id,
        following: true,
        sharing: true,
      }),
    );
    sent.length = 0;
    failures.length = 0;
    await createPost(ctx, bob.actor.id, { content: 'for my followers' });
    await bridge.idle();
    expect(sent.some((s) => s.url.includes('10.0.0.5'))).toBe(false);
    expect(failures.some((e) => (e as Error).cause instanceof UnsafeUrlError)).toBe(true);
  });
});

describe('polls', () => {
  it('stores incoming diaspora* polls as single choice, without expiry, with answer guids', async () => {
    const guid = 'c0000000000000000000000000000001';
    await bridge.receivePublic(
      envelopeFrom(dave, {
        type: 'StatusMessage',
        author: dave.id,
        guid,
        public: true,
        text: 'Mare o montagna?',
        poll: {
          type: 'Poll',
          guid: 'c0000000000000000000000000000002',
          question: 'Mare o montagna?',
          pollAnswers: [
            { type: 'PollAnswer', guid: 'c0000000000000000000000000000003', answer: 'Mare' },
            { type: 'PollAnswer', guid: 'c0000000000000000000000000000004', answer: 'Montagna' },
          ],
        },
      }),
    );
    const post = await postByGuid(guid);
    expect(post?.contentHtml).not.toContain('Montagna');
    const poll = await pollOfPost(ctx, post?.id ?? '');
    expect(poll).toMatchObject({
      multiple: false,
      expiresAt: null,
      diasporaGuid: 'c0000000000000000000000000000002',
    });
    expect(poll?.options.map((o) => o.title)).toEqual(['Mare', 'Montagna']);
    expect(poll && answerGuids(poll, false)).toEqual([
      'c0000000000000000000000000000003',
      'c0000000000000000000000000000004',
    ]);

    // A local vote goes to the author's pod as a signed PollParticipation.
    const voter = await localUser();
    sent.length = 0;
    await votePoll(ctx, voter.actor.id, poll?.id ?? '', [1]);
    await bridge.idle();
    const delivery = sent.find((s) => s.url === 'https://pod-d.org/receive/public');
    const opened = await unenvelop(delivery?.body ?? '', {
      fetchPublicKey: () => voter.actor.publicKeyPem,
    });
    const participation = parseEntity(opened.payloadXml);
    if (participation.type !== 'PollParticipation') throw new Error('not a vote');
    expect(participation).toMatchObject({
      author: voter.id,
      parentGuid: 'c0000000000000000000000000000002',
      pollAnswerGuid: 'c0000000000000000000000000000004',
    });
    expect(verifyRelayableSignature(participation, voter.actor.publicKeyPem)).toBe(true);
  });

  it('sends local single-choice polls as <poll> and multiple choice as text', async () => {
    const bob = await localUser();
    const daveRow = await bridge.resolvePerson(dave.id);
    await follow(ctx, daveRow?.id ?? '', bob.actor.id);
    await bridge.idle();
    sent.length = 0;
    await createPost(ctx, bob.actor.id, {
      content: 'Pizza o pasta?',
      poll: { options: ['Pizza', 'Pasta'], expiresIn: 3600, multiple: false },
    });
    await createPost(ctx, bob.actor.id, {
      content: 'Cosa porti?',
      poll: { options: ['Vino', 'Dolce'], expiresIn: 3600, multiple: true },
    });
    await bridge.idle();
    const entities = await Promise.all(
      sent.map(async (s) =>
        parseEntity(
          (await unenvelop(s.body, { fetchPublicKey: () => bob.actor.publicKeyPem })).payloadXml,
        ),
      ),
    );
    const single = entities.find((e) => e.type === 'StatusMessage' && e.text?.includes('Pizza'));
    const multiple = entities.find((e) => e.type === 'StatusMessage' && e.text?.includes('Cosa'));
    if (single?.type !== 'StatusMessage' || multiple?.type !== 'StatusMessage') {
      throw new Error('posts not sent');
    }
    expect(single.poll?.question).toBe('Pizza o pasta?');
    expect(single.poll?.pollAnswers.map((a) => a.answer)).toEqual(['Pizza', 'Pasta']);
    expect(single.poll?.pollAnswers[0]?.guid).toBe(answerGuid(single.poll?.guid ?? '', 0));
    expect(multiple.poll).toBeUndefined();
    expect(multiple.text).toContain('- [ ] Vino');
  });

  it('counts a diaspora* vote on a local poll and relays it', async () => {
    const bob = await localUser();
    const daveRow = await bridge.resolvePerson(dave.id);
    await follow(ctx, daveRow?.id ?? '', bob.actor.id);
    const post = await createPost(ctx, bob.actor.id, {
      content: 'Si o no?',
      poll: { options: ['Si', 'No'], expiresIn: 3600, multiple: false },
    });
    const poll = await pollOfPost(ctx, post.id);
    await bridge.idle();
    sent.length = 0;
    const vote = signRelayable(
      {
        type: 'PollParticipation',
        author: alice.id,
        guid: 'c0000000000000000000000000000010',
        parentGuid: poll?.diasporaGuid ?? '',
        pollAnswerGuid: answerGuid(poll?.diasporaGuid ?? '', 1),
      },
      alice.privateKey,
    );
    await bridge.receivePublic(envelopeFrom(alice, vote));
    await bridge.idle();
    const counted = await pollOfPost(ctx, post.id);
    expect(counted?.options.map((o) => o.votesCount)).toEqual([0, 1]);
    expect(counted?.votersCount).toBe(1);
    const relay = sent.find((s) => s.url === 'https://pod-d.org/receive/public');
    const opened = await unenvelop(relay?.body ?? '', {
      fetchPublicKey: () => bob.actor.publicKeyPem,
    });
    expect(opened.payloadXml).toBe(serializeEntity(vote));
    expect(await bridge.relayables.get(vote.guid)).toMatchObject({
      entityType: 'PollParticipation',
    });
  });
});
