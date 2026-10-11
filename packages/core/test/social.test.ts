import { schema } from '@disbigle/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  acceptFollowRequest,
  aspectTimeline,
  block,
  createAspect,
  createPost,
  deleteAspect,
  deletePost,
  follow,
  getRelationship,
  getStatus,
  getStatusContext,
  homeTimeline,
  like,
  listAspects,
  listNotifications,
  mute,
  publicTimeline,
  reblog,
  registerUser,
  renameAspect,
  setAspectMemberships,
  tagTimeline,
  unfollow,
  unlike,
  unreblog,
  updateProfile,
} from '../src/index.ts';
import { uniqueUser, useTestContext } from './helpers.ts';

const ctx = useTestContext();

async function newActor(locale: 'en' | 'it' = 'en') {
  const input = uniqueUser();
  const { actorId } = await registerUser(ctx(), { ...input, locale });
  return { id: actorId, username: input.username };
}

const visibleIds = async (viewer: string | null, ids: string[]) => {
  const result: string[] = [];
  for (const id of ids) {
    try {
      await getStatus(ctx(), viewer, id);
      result.push(id);
    } catch {
      // not visible
    }
  }
  return result;
};

describe('relationships', () => {
  it('follows and unfollows, notifying the target', async () => {
    const a = await newActor();
    const b = await newActor();
    expect(await follow(ctx(), a.id, b.id)).toMatchObject({ following: true, requested: false });
    expect(await getRelationship(ctx(), b.id, a.id)).toMatchObject({
      followedBy: true,
      following: false,
    });
    const notes = await listNotifications(ctx(), b.id);
    expect(notes[0]).toMatchObject({ type: 'follow', account: { id: a.id } });
    expect(await unfollow(ctx(), a.id, b.id)).toMatchObject({ following: false });
  });

  it('sends a request to locked accounts, which can accept it', async () => {
    const a = await newActor();
    const b = await newActor();
    await updateProfile(ctx(), b.id, { locked: true });
    expect(await follow(ctx(), a.id, b.id)).toMatchObject({ following: false, requested: true });
    expect((await listNotifications(ctx(), b.id))[0]?.type).toBe('follow_request');
    await acceptFollowRequest(ctx(), b.id, a.id);
    expect(await getRelationship(ctx(), a.id, b.id)).toMatchObject({
      following: true,
      requested: false,
    });
  });

  it('blocking removes follows both ways and prevents following back', async () => {
    const a = await newActor();
    const b = await newActor();
    await follow(ctx(), a.id, b.id);
    await follow(ctx(), b.id, a.id);
    expect(await block(ctx(), a.id, b.id)).toMatchObject({
      blocking: true,
      following: false,
      followedBy: false,
    });
    await expect(follow(ctx(), b.id, a.id)).rejects.toMatchObject({ code: 'forbidden' });
    const post = await createPost(ctx(), a.id, { content: 'public but not for b' });
    expect(await visibleIds(b.id, [post.id])).toEqual([]);
    expect(await visibleIds(null, [post.id])).toEqual([post.id]);
  });
});

describe('aspects', () => {
  it('creates the default aspects in the user language', async () => {
    const it = await newActor('it');
    expect((await listAspects(ctx(), it.id)).map((a) => a.name)).toEqual([
      'Famiglia',
      'Amici',
      'Lavoro',
      'Conoscenti',
    ]);
  });

  it('creates, renames and deletes aspects, rejecting duplicate names', async () => {
    const a = await newActor();
    const created = await createAspect(ctx(), a.id, 'Pod admins');
    await expect(createAspect(ctx(), a.id, 'pod ADMINS')).rejects.toMatchObject({
      code: 'conflict',
    });
    expect((await renameAspect(ctx(), a.id, created.id, 'Admins')).name).toBe('Admins');
    await deleteAspect(ctx(), a.id, created.id);
    expect((await listAspects(ctx(), a.id)).some((x) => x.id === created.id)).toBe(false);
  });

  it('sets memberships and reports them in the relationship', async () => {
    const a = await newActor();
    const b = await newActor();
    const [family, friends] = await listAspects(ctx(), a.id);
    await setAspectMemberships(ctx(), a.id, b.id, [family?.id ?? '', friends?.id ?? '']);
    expect((await getRelationship(ctx(), a.id, b.id)).aspectIds.sort()).toEqual(
      [family?.id, friends?.id].sort(),
    );
    await setAspectMemberships(ctx(), a.id, b.id, [friends?.id ?? '']);
    expect((await getRelationship(ctx(), a.id, b.id)).aspectIds).toEqual([friends?.id]);
    // b never sees a's aspects
    expect((await getRelationship(ctx(), b.id, a.id)).aspectIds).toEqual([]);
  });
});

describe('post visibility', () => {
  it('enforces public, followers, limited and direct audiences', async () => {
    const author = await newActor();
    const follower = await newActor();
    const friend = await newActor();
    const stranger = await newActor();
    await follow(ctx(), follower.id, author.id);
    const [, friends] = await listAspects(ctx(), author.id);
    await setAspectMemberships(ctx(), author.id, friend.id, [friends?.id ?? '']);

    const pub = await createPost(ctx(), author.id, {
      content: 'hello world',
      visibility: 'public',
    });
    const unlisted = await createPost(ctx(), author.id, {
      content: 'quiet',
      visibility: 'unlisted',
    });
    const fol = await createPost(ctx(), author.id, {
      content: 'followers',
      visibility: 'followers',
    });
    const lim = await createPost(ctx(), author.id, {
      content: 'friends only',
      visibility: 'limited',
      aspectIds: [friends?.id ?? ''],
    });
    const dm = await createPost(ctx(), author.id, {
      content: `psst @${stranger.username}`,
      visibility: 'direct',
    });
    const all = [pub.id, unlisted.id, fol.id, lim.id, dm.id];

    expect(await visibleIds(null, all)).toEqual([pub.id, unlisted.id]);
    expect(await visibleIds(follower.id, all)).toEqual([pub.id, unlisted.id, fol.id]);
    expect(await visibleIds(friend.id, all)).toEqual([pub.id, unlisted.id, lim.id]);
    expect(await visibleIds(stranger.id, all)).toEqual([pub.id, unlisted.id, dm.id]);
    expect(await visibleIds(author.id, all)).toEqual(all);
  });

  it('shows the selected aspects to the author only', async () => {
    const author = await newActor();
    const friend = await newActor();
    const [family] = await listAspects(ctx(), author.id);
    await setAspectMemberships(ctx(), author.id, friend.id, [family?.id ?? '']);
    const post = await createPost(ctx(), author.id, {
      content: 'family',
      visibility: 'limited',
      aspectIds: [family?.id ?? ''],
    });
    expect(post.aspectIds).toEqual([family?.id]);
    expect((await getStatus(ctx(), friend.id, post.id)).aspectIds).toBeUndefined();
  });

  it('keeps new aspect members out of earlier limited posts', async () => {
    const author = await newActor();
    const late = await newActor();
    const [family] = await listAspects(ctx(), author.id);
    const post = await createPost(ctx(), author.id, {
      content: 'before',
      visibility: 'limited',
      aspectIds: [family?.id ?? ''],
    });
    await setAspectMemberships(ctx(), author.id, late.id, [family?.id ?? '']);
    expect(await visibleIds(late.id, [post.id])).toEqual([]);
  });

  it('requires an aspect for limited posts and a mention for direct posts', async () => {
    const author = await newActor();
    await expect(
      createPost(ctx(), author.id, { content: 'x', visibility: 'limited' }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(
      createPost(ctx(), author.id, { content: 'x', visibility: 'direct' }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('keeps replies to limited posts inside the original audience', async () => {
    const author = await newActor();
    const friend = await newActor();
    const other = await newActor();
    const [family] = await listAspects(ctx(), author.id);
    await setAspectMemberships(ctx(), author.id, friend.id, [family?.id ?? '']);
    const post = await createPost(ctx(), author.id, {
      content: 'family news',
      visibility: 'limited',
      aspectIds: [family?.id ?? ''],
    });
    const reply = await createPost(ctx(), friend.id, {
      content: 'congrats',
      inReplyToId: post.id,
      visibility: 'public',
    });
    expect(reply.visibility).toBe('limited');
    expect(await visibleIds(author.id, [reply.id])).toEqual([reply.id]);
    expect(await visibleIds(other.id, [reply.id])).toEqual([]);
    expect((await getStatus(ctx(), author.id, post.id)).repliesCount).toBe(1);
    expect((await listNotifications(ctx(), author.id))[0]).toMatchObject({
      type: 'reply',
      status: { id: reply.id },
    });
  });
});

describe('interactions', () => {
  it('likes and unlikes with counters and a notification', async () => {
    const a = await newActor();
    const b = await newActor();
    const post = await createPost(ctx(), a.id, { content: 'like me' });
    expect(await like(ctx(), b.id, post.id)).toMatchObject({ liked: true, likesCount: 1 });
    expect(await like(ctx(), b.id, post.id)).toMatchObject({ likesCount: 1 });
    expect((await listNotifications(ctx(), a.id))[0]).toMatchObject({
      type: 'like',
      account: { id: b.id },
    });
    expect(await unlike(ctx(), b.id, post.id)).toMatchObject({ liked: false, likesCount: 0 });
  });

  it('reshares public posts only, and deleting the original removes reshares', async () => {
    const a = await newActor();
    const b = await newActor();
    const post = await createPost(ctx(), a.id, { content: 'share me' });
    expect(await reblog(ctx(), b.id, post.id)).toMatchObject({ reblogged: true, reblogsCount: 1 });
    expect(await unreblog(ctx(), b.id, post.id)).toMatchObject({
      reblogged: false,
      reblogsCount: 0,
    });
    await reblog(ctx(), b.id, post.id);

    const fol = await createPost(ctx(), a.id, { content: 'followers', visibility: 'followers' });
    await follow(ctx(), b.id, a.id);
    await expect(reblog(ctx(), b.id, fol.id)).rejects.toMatchObject({ code: 'forbidden' });

    await deletePost(ctx(), a.id, post.id);
    const reblogs = await ctx()
      .db.select()
      .from(schema.posts)
      .where(eq(schema.posts.reblogOfId, post.id));
    expect(reblogs).toEqual([]);
    const [tomb] = await ctx()
      .db.select()
      .from(schema.tombstones)
      .where(eq(schema.tombstones.uri, post.uri ?? ''));
    expect(tomb).toBeDefined();
  });

  it('only lets the author delete a post', async () => {
    const a = await newActor();
    const b = await newActor();
    const post = await createPost(ctx(), a.id, { content: 'mine' });
    await expect(deletePost(ctx(), b.id, post.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('notifies mentioned users and links the mention', async () => {
    const a = await newActor();
    const b = await newActor();
    const post = await createPost(ctx(), a.id, { content: `ciao @${b.username}` });
    expect(post.mentions.map((m) => m.id)).toEqual([b.id]);
    expect(post.content).toContain('class="u-url mention"');
    expect((await listNotifications(ctx(), b.id))[0]).toMatchObject({
      type: 'mention',
      status: { id: post.id },
    });
  });

  it('returns thread context in order', async () => {
    const a = await newActor();
    const b = await newActor();
    const root = await createPost(ctx(), a.id, { content: 'root' });
    const r1 = await createPost(ctx(), b.id, { content: 'r1', inReplyToId: root.id });
    const r2 = await createPost(ctx(), a.id, { content: 'r2', inReplyToId: r1.id });
    const r3 = await createPost(ctx(), b.id, { content: 'r3', inReplyToId: root.id });
    const context = await getStatusContext(ctx(), null, r1.id);
    expect(context.ancestors.map((s) => s.id)).toEqual([root.id]);
    expect(context.descendants.map((s) => s.id)).toEqual([r2.id]);
    const full = await getStatusContext(ctx(), null, root.id);
    expect(full.descendants.map((s) => s.id)).toEqual([r1.id, r2.id, r3.id]);
  });
});

describe('timelines', () => {
  it('builds the home timeline from follows, own posts and posts shared with you', async () => {
    const me = await newActor();
    const followed = await newActor();
    const sharer = await newActor();
    const stranger = await newActor();
    await follow(ctx(), me.id, followed.id);
    const [family] = await listAspects(ctx(), sharer.id);
    await setAspectMemberships(ctx(), sharer.id, me.id, [family?.id ?? '']);

    const own = await createPost(ctx(), me.id, { content: 'mine' });
    const fromFollowed = await createPost(ctx(), followed.id, {
      content: 'followed',
      visibility: 'followers',
    });
    const shared = await createPost(ctx(), sharer.id, {
      content: 'shared with you',
      visibility: 'limited',
      aspectIds: [family?.id ?? ''],
    });
    await createPost(ctx(), stranger.id, { content: 'not in my home' });

    const home = await homeTimeline(ctx(), me.id);
    expect(home.map((s) => s.id)).toEqual([shared.id, fromFollowed.id, own.id]);

    await mute(ctx(), me.id, followed.id);
    expect((await homeTimeline(ctx(), me.id)).map((s) => s.id)).toEqual([shared.id, own.id]);
  });

  it('paginates with maxId and minId', async () => {
    const a = await newActor();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await createPost(ctx(), a.id, { content: `p${i}` })).id);
    const first = await homeTimeline(ctx(), a.id, { limit: 2 });
    expect(first.map((s) => s.id)).toEqual([ids[4], ids[3]]);
    const next = await homeTimeline(ctx(), a.id, { limit: 2, maxId: first.at(-1)?.id });
    expect(next.map((s) => s.id)).toEqual([ids[2], ids[1]]);
    const newer = await homeTimeline(ctx(), a.id, { limit: 2, minId: ids[1] });
    expect(newer.map((s) => s.id)).toEqual([ids[3], ids[2]]);
  });

  it('public timeline shows only public top-level posts; tag timeline filters by tag', async () => {
    const a = await newActor();
    const tag = `t${Date.now()}`;
    const pub = await createPost(ctx(), a.id, { content: `public #${tag}` });
    const unl = await createPost(ctx(), a.id, {
      content: `unlisted #${tag}`,
      visibility: 'unlisted',
    });
    const local = await publicTimeline(ctx(), null, { local: true, limit: 40 });
    expect(local.map((s) => s.id)).toContain(pub.id);
    expect(local.map((s) => s.id)).not.toContain(unl.id);
    expect((await tagTimeline(ctx(), null, tag.toUpperCase())).map((s) => s.id)).toEqual([pub.id]);
  });

  it('aspect timeline shows posts by the aspect members', async () => {
    const me = await newActor();
    const member = await newActor();
    const outsider = await newActor();
    const [family] = await listAspects(ctx(), me.id);
    await setAspectMemberships(ctx(), me.id, member.id, [family?.id ?? '']);
    const p1 = await createPost(ctx(), member.id, { content: 'member' });
    await createPost(ctx(), outsider.id, { content: 'outsider' });
    expect((await aspectTimeline(ctx(), me.id, family?.id ?? '')).map((s) => s.id)).toEqual([
      p1.id,
    ]);
    await expect(aspectTimeline(ctx(), member.id, family?.id ?? '')).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('remote mentions', () => {
  it('resolves unknown remote accounts through the federation hook', async () => {
    const { upsertRemoteActor } = await import('../src/index.ts');
    const author = await newActor();
    const lookups: string[] = [];
    ctx().resolveAccount = async (username, domain) => {
      lookups.push(`${username}@${domain}`);
      const actor = await upsertRemoteActor(ctx(), {
        username,
        domain,
        publicKeyPem: 'test-key',
        apUri: `https://${domain}/users/${username}`,
        apUrl: `https://${domain}/@${username}`,
        apInbox: `https://${domain}/users/${username}/inbox`,
        protocol: 'activitypub',
      });
      return actor.id;
    };
    try {
      const post = await createPost(ctx(), author.id, {
        content: 'ciao @gargron@mastodon.example',
      });
      expect(lookups).toEqual(['gargron@mastodon.example']);
      expect(post.mentions[0]?.acct).toBe('gargron@mastodon.example');
      expect(post.content).toContain('href="https://mastodon.example/@gargron"');
      // Second time the account is already known: no network lookup.
      await createPost(ctx(), author.id, { content: 'again @gargron@mastodon.example' });
      expect(lookups).toHaveLength(1);
    } finally {
      ctx().resolveAccount = undefined;
    }
  });
});

describe('polls', () => {
  it('creates a poll, counts votes once per person and closes on time', async () => {
    const { votePoll } = await import('../src/index.ts');
    const author = await newActor();
    const voter = await newActor();
    const other = await newActor();
    const post = await createPost(ctx(), author.id, {
      content: 'Pizza o pasta?',
      poll: { options: ['Pizza', 'Pasta', 'Entrambe'], expiresIn: 3600, multiple: false },
    });
    expect(post.poll).toMatchObject({
      multiple: false,
      expired: false,
      voted: false,
      votesCount: 0,
    });
    const pollId = post.poll?.id ?? '';

    await expect(votePoll(ctx(), voter.id, pollId, [0, 1])).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(votePoll(ctx(), voter.id, pollId, [7])).rejects.toMatchObject({
      code: 'validation_failed',
    });
    const afterVote = await votePoll(ctx(), voter.id, pollId, [1]);
    expect(afterVote.poll).toMatchObject({ voted: true, ownVotes: [1], votersCount: 1 });
    expect(afterVote.poll?.options.map((o) => o.votesCount)).toEqual([0, 1, 0]);
    await expect(votePoll(ctx(), voter.id, pollId, [0])).rejects.toMatchObject({
      code: 'conflict',
    });
    await votePoll(ctx(), other.id, pollId, [1]);
    expect((await getStatus(ctx(), author.id, post.id)).poll).toMatchObject({
      votersCount: 2,
      voted: false,
    });

    await ctx()
      .db.update(schema.polls)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.polls.id, pollId));
    expect((await getStatus(ctx(), null, post.id)).poll?.expired).toBe(true);
    await expect(votePoll(ctx(), author.id, pollId, [0])).rejects.toMatchObject({
      code: 'bad_request',
    });
  });

  it('notifies voters and the author once when a poll ends', async () => {
    const { votePoll, notifyEndedPolls } = await import('../src/index.ts');
    const author = await newActor();
    const voter = await newActor();
    const post = await createPost(ctx(), author.id, {
      content: 'Si o no?',
      poll: { options: ['Si', 'No'], expiresIn: 3600, multiple: false },
    });
    await votePoll(ctx(), voter.id, post.poll?.id ?? '', [0]);
    await ctx()
      .db.update(schema.polls)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.polls.id, post.poll?.id ?? ''));
    expect(await notifyEndedPolls(ctx())).toBeGreaterThanOrEqual(1);
    expect((await listNotifications(ctx(), voter.id))[0]).toMatchObject({
      type: 'poll',
      status: { id: post.id },
    });
    expect((await listNotifications(ctx(), author.id))[0]).toMatchObject({
      type: 'poll',
      status: { id: post.id },
    });
    await notifyEndedPolls(ctx());
    expect(
      (await listNotifications(ctx(), voter.id)).filter((n) => n.type === 'poll'),
    ).toHaveLength(1);
  });

  it('allows several choices in multiple-choice polls', async () => {
    const { votePoll } = await import('../src/index.ts');
    const author = await newActor();
    const voter = await newActor();
    const post = await createPost(ctx(), author.id, {
      content: 'Cosa porti?',
      poll: { options: ['Vino', 'Dolce', 'Pane'], expiresIn: 3600, multiple: true },
    });
    const voted = await votePoll(ctx(), voter.id, post.poll?.id ?? '', [0, 2]);
    expect(voted.poll).toMatchObject({ ownVotes: [0, 2], votersCount: 1, votesCount: 2 });
  });
});

describe('remote data hygiene', () => {
  it('drops non-http URLs from remote accounts and posts', async () => {
    const { upsertRemoteActor, ingestRemotePost } = await import('../src/index.ts');
    const remote = await upsertRemoteActor(ctx(), {
      username: 'mallory',
      domain: 'evil.example',
      publicKeyPem: 'k',
      apUri: 'https://evil.example/users/mallory',
      apUrl: 'javascript:alert(1)',
      avatarUrl: 'data:text/html,<script>alert(1)</script>',
      apInbox: 'https://evil.example/inbox',
      protocol: 'activitypub',
    });
    expect(remote.apUrl).toBeNull();
    expect(remote.avatarUrl).toBeNull();
    const id = await ingestRemotePost(ctx(), {
      authorActorId: remote.id,
      apUri: 'https://evil.example/notes/1',
      apUrl: 'javascript:alert(2)',
      contentHtml: '<p>hi</p>',
      visibility: 'public',
      attachments: [
        { url: 'javascript:alert(3)', mimeType: 'image/png' },
        { url: 'https://evil.example/ok.png', mimeType: 'image/png' },
      ],
    });
    const status = await getStatus(ctx(), null, id ?? '');
    expect(status.url).toBeNull();
    expect(status.media.map((m) => m.url)).toEqual(['https://evil.example/ok.png']);
  });
});

describe('known instances', () => {
  it('groups remote accounts by server with their protocols', async () => {
    const { upsertRemoteActor, listKnownInstances } = await import('../src/index.ts');
    for (const [username, protocol] of [
      ['uno', 'activitypub'],
      ['due', 'diaspora'],
    ] as const) {
      await upsertRemoteActor(ctx(), {
        username,
        domain: 'mixed.example',
        publicKeyPem: 'k',
        ...(protocol === 'activitypub'
          ? {
              apUri: `https://mixed.example/users/${username}`,
              apInbox: 'https://mixed.example/inbox',
            }
          : {
              diasporaGuid: `guid${username}`,
              diasporaReceiveUrl: `https://mixed.example/receive/users/${username}`,
            }),
        protocol,
      });
    }
    const [mixed] = await listKnownInstances(ctx(), { query: 'mixed.example' });
    expect(mixed).toMatchObject({
      domain: 'mixed.example',
      accounts: 2,
      protocols: ['activitypub', 'diaspora'],
      block: null,
    });
  });
});

describe('keyword filters', () => {
  it('hides matching posts from timelines, threads and notifications', async () => {
    const { createKeywordFilter, deleteKeywordFilter, listKeywordFilters } = await import(
      '../src/index.ts'
    );
    const me = await newActor();
    const friend = await newActor();
    await follow(ctx(), me.id, friend.id);
    const spoiler = await createPost(ctx(), friend.id, {
      content: 'Il finale di Dune è incredibile',
    });
    const partial = await createPost(ctx(), friend.id, { content: 'Ho visto le dunette al mare' });
    const fine = await createPost(ctx(), friend.id, { content: 'Buongiorno a tutti' });
    const filter = await createKeywordFilter(ctx(), me.id, {
      phrase: 'dune',
      contexts: ['home', 'thread'],
    });

    const home = (await homeTimeline(ctx(), me.id)).map((s) => s.id);
    expect(home).toContain(fine.id);
    expect(home).toContain(partial.id); // whole-word filter: "dunette" is not "dune"
    expect(home).not.toContain(spoiler.id);
    // Public timeline is not in this filter's contexts.
    expect((await publicTimeline(ctx(), me.id, { limit: 40 })).map((s) => s.id)).toContain(
      spoiler.id,
    );

    const reply = await createPost(ctx(), friend.id, {
      content: `Dune! @${me.username}`,
      inReplyToId: fine.id,
    });
    expect(
      (await getStatusContext(ctx(), me.id, fine.id)).descendants.map((s) => s.id),
    ).not.toContain(reply.id);
    // Notifications were not filtered: the mention arrives.
    expect((await listNotifications(ctx(), me.id)).some((n) => n.status?.id === reply.id)).toBe(
      true,
    );

    await createKeywordFilter(ctx(), me.id, {
      phrase: 'dun',
      wholeWord: false,
      contexts: ['notifications'],
    });
    expect((await listNotifications(ctx(), me.id)).some((n) => n.status?.id === reply.id)).toBe(
      false,
    );

    expect((await listKeywordFilters(ctx(), me.id)).map((f) => f.phrase).sort()).toEqual([
      'dun',
      'dune',
    ]);
    await deleteKeywordFilter(ctx(), me.id, filter.id);
    expect((await homeTimeline(ctx(), me.id)).map((s) => s.id)).toContain(spoiler.id);
  });
});

describe('remote identity safety', () => {
  it('refuses to attach a known guid or id to a different account', async () => {
    const { upsertRemoteActor } = await import('../src/index.ts');
    const bob = await upsertRemoteActor(ctx(), {
      username: 'bob',
      domain: 'good.pod',
      publicKeyPem: 'bob-key',
      diasporaGuid: 'b0b0b0b0b0b0b0b0',
      diasporaReceiveUrl: 'https://good.pod/receive/users/b0b0b0b0b0b0b0b0',
      protocol: 'diaspora',
    });
    await expect(
      upsertRemoteActor(ctx(), {
        username: 'mallory',
        domain: 'evil.example',
        publicKeyPem: 'evil-key',
        diasporaGuid: 'b0b0b0b0b0b0b0b0',
        diasporaReceiveUrl: 'https://evil.example/receive/users/x',
        protocol: 'diaspora',
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      upsertRemoteActor(ctx(), {
        username: 'bob',
        domain: 'good.pod',
        publicKeyPem: 'evil-key',
        diasporaGuid: 'ffffffffffffffff',
        protocol: 'diaspora',
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    const [stored] = await ctx()
      .db.select()
      .from(schema.actors)
      .where(eq(schema.actors.id, bob.id));
    expect(stored?.publicKeyPem).toBe('bob-key');

    const ap = await upsertRemoteActor(ctx(), {
      username: 'eve',
      domain: 'ap.example',
      publicKeyPem: 'k',
      apUri: 'https://ap.example/users/eve',
      apInbox: 'https://ap.example/inbox',
      protocol: 'activitypub',
    });
    await expect(
      upsertRemoteActor(ctx(), {
        username: 'eve',
        domain: 'other.example',
        publicKeyPem: 'k2',
        apUri: 'https://ap.example/users/eve',
        apInbox: 'https://other.example/inbox',
        protocol: 'activitypub',
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    // A rename on the same server keeps the same record.
    const renamed = await upsertRemoteActor(ctx(), {
      username: 'eve2',
      domain: 'ap.example',
      publicKeyPem: 'k',
      apUri: 'https://ap.example/users/eve',
      apInbox: 'https://ap.example/inbox',
      protocol: 'activitypub',
    });
    expect(renamed.id).toBe(ap.id);
  });

  it("ignores Deletes and reused ids that target someone else's posts", async () => {
    const { upsertRemoteActor, ingestRemotePost, deleteRemotePost } = await import(
      '../src/index.ts'
    );
    const remote = (username: string, domain: string) =>
      upsertRemoteActor(ctx(), {
        username,
        domain,
        publicKeyPem: 'k',
        apUri: `https://${domain}/users/${username}`,
        apInbox: `https://${domain}/inbox`,
        protocol: 'activitypub',
      });
    const mallory = await remote('mallory', 'evil.example');
    const vic = await remote('vic', 'good.example');

    // A Delete for a URI on another server, sent before the post arrives, blocks nothing.
    const uri = 'https://good.example/users/vic/statuses/1';
    expect(await deleteRemotePost(ctx(), mallory.id, { apUri: uri })).toBe(false);
    const id = await ingestRemotePost(ctx(), {
      authorActorId: vic.id,
      apUri: uri,
      contentHtml: '<p>hi</p>',
      visibility: 'public',
    });
    expect(id).not.toBeNull();

    // The same id sent again by someone else does not return (or touch) the victim's post.
    expect(
      await ingestRemotePost(ctx(), {
        authorActorId: mallory.id,
        apUri: uri,
        contentHtml: '<p>mine</p>',
        visibility: 'public',
      }),
    ).toBeNull();

    // The author's own Delete still works.
    expect(await deleteRemotePost(ctx(), vic.id, { apUri: uri })).toBe(true);
  });
});
