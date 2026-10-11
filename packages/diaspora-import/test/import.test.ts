import { createSign, createVerify } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '@disbigle/config';
import {
  type CoreContext,
  DomainError,
  getStatus,
  getStatusContext,
  homeTimeline,
  LocalMediaStorage,
  MemoryKeyValueStore,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import { createTestDatabase } from '@disbigle/db/testing';
import { and, eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPostgresReader,
  DIASPORA_BCRYPT_PREFIX,
  type ImportSummary,
  importDiasporaPod,
  verifyDiasporaPassword,
} from '../src/index.ts';
import { createDiasporaPod, deviseHash, PASSWORDS, POD_DOMAIN, type Pod } from './pod.ts';

const {
  actors,
  users,
  posts,
  follows,
  aspects,
  aspectMemberships,
  postAudiences,
  postAspects,
  polls,
  pollVotes,
} = schema;

const config: Config = {
  NODE_ENV: 'test',
  PUBLIC_URL: `https://${POD_DOMAIN}`,
  LOCAL_DOMAIN: POD_DOMAIN,
  HOST: '127.0.0.1',
  PORT: 0,
  DATABASE_URL: '',
  REDIS_URL: '',
  SESSION_SECRET: 'test-secret-test-secret-test-secret-test',
  REGISTRATION_MODE: 'open',
  MEDIA_DIR: '/tmp/disbigle-import-test-media',
  INSTANCE_TITLE: 'Disbigle Test',
  INSTANCE_DESCRIPTION: '',
  MAIL_FROM: 'Disbigle <noreply@diaspo.test>',
};

let pod: Pod;
let ctx: CoreContext;
let mediaDir: string;
let first: ImportSummary;
let second: ImportSummary;
const drops: (() => Promise<void>)[] = [];

async function newTarget(): Promise<CoreContext> {
  const testDb = await createTestDatabase();
  drops.push(testDb.drop);
  return { db: testDb.db, config, kv: new MemoryKeyValueStore() };
}

async function runImport(target: CoreContext, dryRun = false) {
  const reader = createPostgresReader(pod.url);
  try {
    return await importDiasporaPod({
      source: reader,
      target,
      options: {
        uploadsDir: pod.uploadsDir,
        mediaStorage: new LocalMediaStorage(mediaDir),
        batchSize: 2, // small batches exercise pagination
        dryRun,
      },
    });
  } finally {
    await reader.close();
  }
}

beforeAll(async () => {
  pod = await createDiasporaPod();
  mediaDir = await mkdtemp(join(tmpdir(), 'disbigle-media-'));
  ctx = await newTarget();
  first = await runImport(ctx);
  second = await runImport(ctx);
});

afterAll(async () => {
  for (const drop of drops) await drop();
  await pod?.drop();
  if (pod) await rm(pod.uploadsDir, { recursive: true, force: true });
  if (mediaDir) await rm(mediaDir, { recursive: true, force: true });
});

const actorByGuid = async (guid: string) => {
  const [actor] = await ctx.db.select().from(actors).where(eq(actors.diasporaGuid, guid));
  if (!actor) throw new Error(`actor ${guid} missing`);
  return actor;
};
const postByGuid = async (guid: string) => {
  const [post] = await ctx.db.select().from(posts).where(eq(posts.diasporaGuid, guid));
  if (!post) throw new Error(`post ${guid} missing`);
  return post;
};
const ids = async () => {
  const [alice, bob, carol, dave] = await Promise.all(
    (['alice', 'bob', 'carol', 'dave'] as const).map((n) => actorByGuid(pod.guids.people[n])),
  );
  if (!alice || !bob || !carol || !dave) throw new Error('people missing');
  return { alice, bob, carol, dave };
};
const notFound = async (promise: Promise<unknown>) => {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
  await expect(promise).rejects.toMatchObject({ code: 'not_found' });
};

describe('people', () => {
  it('keeps local handles, GUIDs and federation URLs', async () => {
    const { alice, bob } = await ids();
    expect(alice.username).toBe('alice');
    expect(alice.domain).toBeNull();
    expect(alice.apUri).toBe(`https://${POD_DOMAIN}/users/alice`);
    expect(alice.diasporaReceiveUrl).toBe(
      `https://${POD_DOMAIN}/receive/users/${pod.guids.people.alice}`,
    );
    expect(alice.protocols).toEqual(['activitypub', 'diaspora']);
    expect(alice.displayName).toBe('Alice Rossi');
    expect(alice.summary).toBe('Amo *diaspora*');
    expect(alice.fields).toEqual([
      { name: 'Location', value: 'Roma' },
      { name: 'Birthday', value: '07-15' },
    ]);
    expect(alice.createdAt.toISOString()).toBe('2015-03-01T10:00:00.000Z');
    // Bob's profile details are for contacts only in diaspora*: not published.
    expect(bob.displayName).toBe('Bob');
    expect(bob.summary).toBe('');
    expect(bob.fields).toEqual([]);
    expect(bob.discoverable).toBe(false);
  });

  it('imports the RSA key pairs in the formats Disbigle uses, and they still match', async () => {
    for (const name of ['alice', 'bob'] as const) {
      const actor = await actorByGuid(pod.guids.people[name]);
      const [user] = await ctx.db.select().from(users).where(eq(users.actorId, actor.id));
      expect(user?.privateKeyPem).toContain('BEGIN PRIVATE KEY');
      expect(actor.publicKeyPem).toContain('BEGIN PUBLIC KEY');
      expect(actor.publicKeyPem).toBe(pod.keys[name].spki);
      const signature = createSign('sha256')
        .update('hello')
        .sign(user?.privateKeyPem ?? '');
      expect(createVerify('sha256').update('hello').verify(actor.publicKeyPem, signature)).toBe(
        true,
      );
      // The original diaspora* key verifies signatures made with the imported one.
      expect(
        createVerify('sha256').update('hello').verify(pod.keys[name].publicPem, signature),
      ).toBe(true);
    }
  });

  it('keeps passwords usable, roles and locales', async () => {
    const { alice, bob } = await ids();
    const [aliceUser] = await ctx.db.select().from(users).where(eq(users.actorId, alice.id));
    const [bobUser] = await ctx.db.select().from(users).where(eq(users.actorId, bob.id));
    expect(aliceUser?.passwordHash.startsWith(DIASPORA_BCRYPT_PREFIX)).toBe(true);
    expect(await verifyDiasporaPassword(aliceUser?.passwordHash ?? '', PASSWORDS.alice)).toBe(true);
    expect(await verifyDiasporaPassword(aliceUser?.passwordHash ?? '', PASSWORDS.bob)).toBe(false);
    expect(await verifyDiasporaPassword(bobUser?.passwordHash ?? '', PASSWORDS.bob)).toBe(true);
    expect(aliceUser?.email).toBe('alice@example.org');
    expect(aliceUser?.role).toBe('admin');
    expect(bobUser?.role).toBe('user');
    expect(aliceUser?.locale).toBe('it');
    expect(bobUser?.locale).toBe('en');
    expect(aliceUser?.ed25519PrivateKeyPem).toBeNull();
  });

  it('copies local avatars into media storage and keeps remote ones as URLs', async () => {
    const { alice, carol, dave } = await ids();
    expect(alice.avatarUrl).toBe(
      `https://${POD_DOMAIN}/media/diaspora/avatars/thumb_large_avatara.jpg`,
    );
    expect(await readFile(join(mediaDir, 'diaspora/avatars/thumb_large_avatara.jpg'), 'utf8')).toBe(
      'avatar of alice',
    );
    expect(carol.avatarUrl).toBe('https://remote.example/uploads/images/thumb_large_carol.jpg');
    expect(dave.avatarUrl).toBe('http://other.example:3000/uploads/images/thumb_large_dave.jpg');
  });

  it('stores remote people as diaspora* actors', async () => {
    const { carol, dave } = await ids();
    expect(carol.username).toBe('carol');
    expect(carol.domain).toBe('remote.example');
    expect(carol.protocols).toEqual(['diaspora']);
    expect(carol.preferredProtocol).toBe('diaspora');
    expect(carol.diasporaReceiveUrl).toBe(
      `https://remote.example/receive/users/${pod.guids.people.carol}`,
    );
    expect(carol.publicKeyPem).toBe(pod.keys.carol.spki);
    expect(carol.displayName).toBe('Carol Remote');
    expect(carol.summary).toBe('<p>Hi</p>');
    expect(dave.diasporaReceiveUrl).toBe(
      `http://other.example:3000/receive/users/${pod.guids.people.dave}`,
    );
    expect(dave.displayName).toBe('dave');
  });
});

describe('contacts and aspects', () => {
  it('maps sharing to "user follows person" and receiving to "person follows user"', async () => {
    const { alice, bob, carol, dave } = await ids();
    const rows = await ctx.db.select().from(follows);
    const pairs = new Set(rows.map((f) => `${f.actorId}>${f.targetActorId}`));
    const has = (a: { id: string }, b: { id: string }) => pairs.has(`${a.id}>${b.id}`);
    expect(has(alice, carol)).toBe(true);
    expect(has(carol, alice)).toBe(true);
    expect(has(bob, alice)).toBe(true);
    expect(has(dave, alice)).toBe(true);
    expect(has(bob, dave)).toBe(true);
    expect(has(alice, bob)).toBe(false);
    expect(has(alice, dave)).toBe(false);
    expect(rows).toHaveLength(5);
  });

  it('imports aspects with their members, without default aspects', async () => {
    const { alice, bob, carol, dave } = await ids();
    const owned = await ctx.db.select().from(aspects).where(eq(aspects.ownerActorId, alice.id));
    expect(owned.map((a) => a.name).sort()).toEqual(['Amici', 'Famiglia']);
    const members = async (name: string) => {
      const aspect = owned.find((a) => a.name === name);
      const rows = await ctx.db
        .select()
        .from(aspectMemberships)
        .where(eq(aspectMemberships.aspectId, aspect?.id ?? ''));
      return rows.map((r) => r.actorId).sort();
    };
    expect(await members('Famiglia')).toEqual([bob.id, dave.id].sort());
    expect(await members('Amici')).toEqual([carol.id]);
    const bobs = await ctx.db.select().from(aspects).where(eq(aspects.ownerActorId, bob.id));
    expect(bobs.map((a) => a.name)).toEqual(['Friends']);
  });
});

describe('posts', () => {
  it('imports a public post with mentions, tags, photo and original GUID and date', async () => {
    const { alice, bob, carol } = await ids();
    const post = await postByGuid(pod.guids.posts.p1);
    expect(post.local).toBe(true);
    expect(post.apUri).toBe(`${alice.apUri}/statuses/${post.id}`);
    expect(post.apUrl).toBe(`https://${POD_DOMAIN}/@alice/${post.id}`);
    expect(post.createdAt.toISOString()).toBe(pod.times.p1.toISOString());
    expect(post.source).toBe('Ciao @carol@remote.example e @bob! #Diaspora\n\n*benvenuti*');

    const status = await getStatus(ctx, null, post.id);
    expect(status.visibility).toBe('public');
    expect(status.content).toContain(`href="${carol.apUrl}"`);
    expect(status.content).toContain('<em>benvenuti</em>');
    expect(status.mentions.map((m) => m.id).sort()).toEqual([bob.id, carol.id].sort());
    expect(status.tags).toEqual([{ name: 'diaspora' }]);
    expect(status.media).toHaveLength(1);
    expect(status.media[0]?.url).toBe(`https://${POD_DOMAIN}/media/diaspora/images/abc123.jpg`);
    expect(status.media[0]?.previewUrl).toBe(
      `https://${POD_DOMAIN}/media/diaspora/images/scaled_full_abc123.jpg`,
    );
    expect(status.media[0]?.description).toBe('Il Colosseo');
    expect(status.media[0]?.width).toBe(800);
    expect(existsSync(join(mediaDir, 'diaspora/images/abc123.jpg'))).toBe(true);
    // Counters recomputed: one comment, two likes (the dislike is ignored), one reshare.
    expect(status.repliesCount).toBe(1);
    expect(status.likesCount).toBe(2);
    expect(status.reblogsCount).toBe(1);
  });

  it('orders imported posts by their original date', async () => {
    const p1 = await postByGuid(pod.guids.posts.p1);
    const p2 = await postByGuid(pod.guids.posts.p2);
    expect(p1.id < p2.id).toBe(true);
  });

  it('keeps aspect posts limited to the aspect members', async () => {
    const { bob, carol, dave } = await ids();
    const amici = await postByGuid(pod.guids.posts.p2);
    expect(amici.visibility).toBe('limited');
    const audience = await ctx.db
      .select()
      .from(postAudiences)
      .where(eq(postAudiences.postId, amici.id));
    expect(audience.map((a) => a.actorId)).toEqual([carol.id]);
    const aspectRows = await ctx.db
      .select()
      .from(postAspects)
      .where(eq(postAspects.postId, amici.id));
    expect(aspectRows).toHaveLength(1);
    await notFound(getStatus(ctx, bob.id, amici.id));
    await notFound(getStatus(ctx, null, amici.id));

    const famiglia = await postByGuid(pod.guids.posts.p3);
    const famAudience = await ctx.db
      .select()
      .from(postAudiences)
      .where(eq(postAudiences.postId, famiglia.id));
    expect(famAudience.map((a) => a.actorId).sort()).toEqual([bob.id, dave.id].sort());
    expect((await getStatus(ctx, bob.id, famiglia.id)).visibility).toBe('limited');
    // The photo file is missing from the uploads: the old URL is kept.
    const status = await getStatus(ctx, bob.id, famiglia.id);
    expect(status.media[0]?.url).toBe(`https://${POD_DOMAIN}/uploads/images/missing1.jpg`);
  });

  it('shows users what they saw on diaspora*', async () => {
    const { alice, bob } = await ids();
    const bobHome = (await homeTimeline(ctx, bob.id, { limit: 40 })).map((s) => s.id);
    const aliceHome = (await homeTimeline(ctx, alice.id, { limit: 40 })).map((s) => s.id);
    const p2 = await postByGuid(pod.guids.posts.p2);
    const p3 = await postByGuid(pod.guids.posts.p3);
    const p4 = await postByGuid(pod.guids.posts.p4);
    const p5 = await postByGuid(pod.guids.posts.p5);
    expect(bobHome).toContain(p3.id);
    expect(bobHome).toContain(p5.id);
    expect(bobHome).not.toContain(p2.id);
    expect(aliceHome).toContain(p2.id);
    expect(aliceHome).toContain(p4.id);
    expect(aliceHome).not.toContain(p5.id);
    await notFound(getStatus(ctx, alice.id, p5.id));
  });

  it('keeps remote posts and photos remote', async () => {
    const { carol } = await ids();
    const post = await postByGuid(pod.guids.posts.p4);
    expect(post.local).toBe(false);
    expect(post.actorId).toBe(carol.id);
    expect(post.source).toBeNull();
    expect(post.apUri).toBeNull();
    const status = await getStatus(ctx, null, post.id);
    expect(status.media[0]?.url).toBe('https://remote.example/uploads/images/carolpic.png');
  });

  it('turns reshares into reblogs', async () => {
    const { bob } = await ids();
    const reshare = await postByGuid(pod.guids.posts.reshare);
    const original = await postByGuid(pod.guids.posts.p1);
    expect(reshare.reblogOfId).toBe(original.id);
    expect(reshare.actorId).toBe(bob.id);
    expect(reshare.apUri).toBe(`${bob.apUri}/statuses/${reshare.id}/activity`);
  });

  it('imports polls with their votes', async () => {
    const { alice, bob, carol, dave } = await ids();
    const post = await postByGuid(pod.guids.posts.poll);
    expect(post.source).toBe('Che ne dite?\n\n**Pizza o pasta?**');
    const [poll] = await ctx.db.select().from(polls).where(eq(polls.postId, post.id));
    expect(poll?.diasporaGuid).toBe(pod.guids.polls.poll);
    expect(poll?.multiple).toBe(false);
    expect(poll?.expiresAt).toBeNull();

    const forAlice = (await getStatus(ctx, alice.id, post.id)).poll;
    expect(forAlice).toMatchObject({
      expired: false,
      multiple: false,
      votersCount: 3,
      votesCount: 3,
      voted: false,
      ownVotes: [],
      options: [
        { title: 'Pizza', votesCount: 2 },
        { title: 'Pasta', votesCount: 1 },
      ],
    });
    expect((await getStatus(ctx, bob.id, post.id)).poll).toMatchObject({
      voted: true,
      ownVotes: [0],
    });
    expect((await getStatus(ctx, dave.id, post.id)).poll?.ownVotes).toEqual([1]);
    expect((await getStatus(ctx, null, post.id)).poll?.voted).toBe(false);

    const votes = await ctx.db
      .select()
      .from(pollVotes)
      .where(eq(pollVotes.pollId, poll?.id ?? ''));
    const byActor = new Map(votes.map((v) => [v.actorId, v]));
    expect(byActor.get(bob.id)?.diasporaGuid).toBe(pod.guids.votes.bob);
    expect(byActor.get(bob.id)?.apUri).toBe(`${bob.apUri}#votes/${byActor.get(bob.id)?.id}`);
    expect(byActor.get(carol.id)?.diasporaGuid).toBe(pod.guids.votes.carol);
    expect(byActor.get(carol.id)?.apUri).toBeNull();
  });

  it('keeps polls with fewer than two answers as text', async () => {
    const post = await postByGuid(pod.guids.posts.shortPoll);
    expect(post.source).toContain('**Only one?**');
    expect(post.source).toContain('- Yes (0 votes)');
    expect((await getStatus(ctx, null, post.id)).poll).toBeNull();
  });
});

describe('comments, likes, conversations', () => {
  it('imports comments as replies that inherit the visibility of their post', async () => {
    const { alice, bob, dave } = await ids();
    const p1 = await postByGuid(pod.guids.posts.p1);
    const c1 = await postByGuid(pod.guids.comments.c1);
    expect(c1.inReplyToId).toBe(p1.id);
    expect(c1.threadRootId).toBe(p1.id);
    expect(c1.visibility).toBe('public');
    const context = await getStatusContext(ctx, null, p1.id);
    expect(context.descendants.map((s) => s.id)).toEqual([c1.id]);

    const c2 = await postByGuid(pod.guids.comments.c2);
    expect(c2.visibility).toBe('limited');
    expect(c2.local).toBe(true);
    const audience = await ctx.db
      .select()
      .from(postAudiences)
      .where(eq(postAudiences.postId, c2.id));
    expect(audience.map((a) => a.actorId).sort()).toEqual([alice.id, dave.id].sort());
    await notFound(getStatus(ctx, null, c2.id));
    expect((await getStatus(ctx, alice.id, c2.id)).account.id).toBe(bob.id);
  });

  it('imports likes on posts and comments', async () => {
    const c1 = await postByGuid(pod.guids.comments.c1);
    expect((await getStatus(ctx, null, c1.id)).likesCount).toBe(1);
  });

  it('turns a conversation into a direct thread visible to its participants only', async () => {
    const { alice, bob, carol, dave } = await ids();
    const root = await postByGuid(pod.guids.conversation);
    expect(root.visibility).toBe('direct');
    expect(root.actorId).toBe(alice.id);
    expect(root.source).toBe('**Cena**\n\nVenite sabato?');
    const reply = await postByGuid(pod.guids.messages.m2);
    expect(reply.inReplyToId).toBe(root.id);
    expect(reply.source).toBe('Sì, @alice!');
    for (const viewer of [alice, bob, carol]) {
      expect((await getStatus(ctx, viewer.id, root.id)).id).toBe(root.id);
      expect((await getStatus(ctx, viewer.id, reply.id)).id).toBe(reply.id);
    }
    await notFound(getStatus(ctx, dave.id, root.id));
    await notFound(getStatus(ctx, dave.id, reply.id));
    expect(first.counts.messages.created).toBe(2);
  });
});

describe('runs', () => {
  it('reports what it imported', () => {
    expect(first.counts.localUsers.created).toBe(2);
    expect(first.counts.remotePeople.created).toBe(2);
    expect(first.counts.posts.created).toBe(7);
    expect(first.counts.polls.created).toBe(1);
    expect(first.counts.pollVotes.created).toBe(3);
    expect(first.counts.reshares.created).toBe(1);
    expect(first.counts.comments.created).toBe(3);
    expect(first.counts.likes.created).toBe(3);
    expect(first.counts.conversations.created).toBe(1);
    expect(first.filesCopied).toBe(3);
    expect(first.filesMissing).toBe(1);
    expect(first.warnings.some((w) => w.includes('missing1.jpg'))).toBe(true);
  });

  it('is idempotent: a second run creates nothing', async () => {
    for (const [name, counts] of Object.entries(second.counts)) {
      expect({ name, created: counts.created }).toEqual({ name, created: 0 });
    }
    expect(second.counts.localUsers.existing).toBe(2);
    expect(second.counts.posts.existing).toBe(7);
    expect(second.counts.polls.existing).toBe(1);
    expect(second.counts.pollVotes.existing).toBe(3);
    const [{ n } = { n: 0 }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(posts);
    // 7 status messages + 1 reshare + 3 comments + 2 conversation posts.
    expect(n).toBe(13);
    const [{ v } = { v: 0 }] = await ctx.db
      .select({ v: sql<number>`count(*)::int` })
      .from(pollVotes);
    expect(v).toBe(3);
  });

  it('refreshes the password of accounts not yet used on Disbigle', async () => {
    const { bob } = await ids();
    const [user] = await ctx.db
      .select()
      .from(users)
      .where(and(eq(users.actorId, bob.id)));
    expect(user?.passwordHash.startsWith(DIASPORA_BCRYPT_PREFIX)).toBe(true);
  });

  it('picks up what changed on the pod at the switch-over run', async () => {
    const source = postgres(pod.url, { max: 1, onnotice: () => {} });
    const newGuid = 'f'.repeat(32);
    await source`update users set encrypted_password = ${deviseHash('new-bob-password')} where id = 2`;
    await source`insert into comments (id, text, commentable_id, author_id, guid, created_at, updated_at)
      values (100, 'Late comment', 1, 2, ${newGuid}, ${'2024-02-01T00:00:00Z'}, ${'2024-02-01T00:00:00Z'})`;
    // Alice votes in her own poll after the first import.
    await source`insert into poll_participations (poll_answer_id, author_id, poll_id, guid, created_at, updated_at)
      values (2, 1, 1, ${'e'.repeat(32)}, ${'2024-02-01T00:00:00Z'}, ${'2024-02-01T00:00:00Z'})`;
    await source.end();
    const third = await runImport(ctx);
    expect(third.counts.comments.created).toBe(1);
    expect(third.counts.pollVotes.created).toBe(1);
    expect(third.counts.pollVotes.existing).toBe(3);
    const pollPost = await postByGuid(pod.guids.posts.poll);
    const { alice } = await ids();
    expect((await getStatus(ctx, alice.id, pollPost.id)).poll).toMatchObject({
      votersCount: 4,
      ownVotes: [1],
      options: [
        { title: 'Pizza', votesCount: 2 },
        { title: 'Pasta', votesCount: 2 },
      ],
    });
    expect(third.counts.posts.created).toBe(0);
    const { bob } = await ids();
    const [user] = await ctx.db.select().from(users).where(eq(users.actorId, bob.id));
    expect(await verifyDiasporaPassword(user?.passwordHash ?? '', 'new-bob-password')).toBe(true);
    const p1 = await postByGuid(pod.guids.posts.p1);
    expect((await getStatus(ctx, null, p1.id)).repliesCount).toBe(2);
  });

  it('writes nothing in a dry run', async () => {
    const target = await newTarget();
    const dryMedia = await mkdtemp(join(tmpdir(), 'disbigle-dry-'));
    const reader = createPostgresReader(pod.url);
    const summary = await importDiasporaPod({
      source: reader,
      target,
      options: {
        uploadsDir: pod.uploadsDir,
        mediaStorage: new LocalMediaStorage(dryMedia),
        dryRun: true,
      },
    }).finally(() => reader.close());
    expect(summary.dryRun).toBe(true);
    expect(summary.counts.posts.created).toBe(7);
    expect(summary.counts.follows.created).toBe(5);
    for (const table of [actors, users, posts, follows, aspects]) {
      const [{ n } = { n: -1 }] = await target.db
        .select({ n: sql<number>`count(*)::int` })
        .from(table);
      expect(n).toBe(0);
    }
    expect(existsSync(join(dryMedia, 'diaspora'))).toBe(false);
    await rm(dryMedia, { recursive: true, force: true });
  });

  it('refuses to run on another domain', async () => {
    const target = await newTarget();
    await expect(
      importDiasporaPod({
        source: pod.url,
        target: {
          ...target,
          config: { ...config, LOCAL_DOMAIN: 'other.test', PUBLIC_URL: 'https://other.test' },
        },
      }),
    ).rejects.toThrow(/same domain/);
  });
});
