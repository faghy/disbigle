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

let groupCounter = 0;
async function createGroup(client: Client, privacy: 'public' | 'private' | 'secret') {
  groupCounter += 1;
  const handle = `g${groupCounter}_${Math.random().toString(36).slice(2, 7)}`;
  const response = await client.post('/api/v1/groups', {
    name: `Group ${groupCounter}`,
    handle,
    description: 'About things',
    privacy,
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string; handle: string; privacy: string };
}

const ids = (list: { id: string }[]) => list.map((s) => s.id);

describe('groups', () => {
  it('creates a public group anyone can read and join, whose posts stay in the group', async () => {
    const owner = await signedIn();
    const group = await createGroup(owner.client, 'public');
    expect((await owner.client.get(`/api/v1/groups/${group.handle}`)).json()).toMatchObject({
      id: group.id,
      name: expect.stringMatching(/^Group/),
      privacy: 'public',
      membersCount: 1,
      membership: { role: 'admin', state: 'member' },
    });
    // The handle is taken, for groups and people alike.
    const again = await owner.client.post('/api/v1/groups', {
      name: 'Copy',
      handle: group.handle.toUpperCase(),
    });
    expect(again.statusCode).toBe(422);
    expect(
      (await owner.client.post('/api/v1/groups', { name: 'Taken', handle: owner.account.username }))
        .statusCode,
    ).toBe(422);

    // Members write; others cannot.
    const reader = await signedIn();
    const denied = await reader.client.post('/api/v1/statuses', {
      content: 'Let me in',
      groupId: group.id,
    });
    expect(denied.statusCode).toBe(403);
    const joined = (await reader.client.post(`/api/v1/groups/${group.id}/join`)).json();
    expect(joined.membership).toEqual({ role: 'member', state: 'member' });

    const post = (
      await owner.client.post('/api/v1/statuses', {
        content: 'Welcome everyone',
        groupId: group.id,
        visibility: 'direct',
      })
    ).json();
    expect(post.visibility).toBe('public');
    expect(post.group).toMatchObject({ id: group.id, handle: group.handle });

    // Anyone reads a public group, signed out too.
    const anonymous = new Client(app);
    expect(ids((await anonymous.get(`/api/v1/groups/${group.handle}/timeline`)).json())).toEqual([
      post.id,
    ]);
    expect((await anonymous.get(`/api/v1/statuses/${post.id}`)).statusCode).toBe(200);

    // Members get it in Home; it is not on the author's profile nor in public timelines.
    expect(ids((await reader.client.get('/api/v1/timelines/home')).json())).toContain(post.id);
    expect(
      ids((await anonymous.get(`/api/v1/accounts/${owner.account.id}/statuses`)).json()),
    ).not.toContain(post.id);
    expect(ids((await anonymous.get('/api/v1/timelines/public')).json())).not.toContain(post.id);

    // Replies join the thread's group; only members reply.
    const reply = (
      await reader.client.post('/api/v1/statuses', { content: 'Thanks!', inReplyToId: post.id })
    ).json();
    expect(reply.group?.id).toBe(group.id);
    const outsider = await signedIn();
    expect(
      (
        await outsider.client.post('/api/v1/statuses', {
          content: 'Me too',
          inReplyToId: post.id,
        })
      ).statusCode,
    ).toBe(403);
    // Only top-level posts are in the group's timeline.
    expect(ids((await anonymous.get(`/api/v1/groups/${group.id}/timeline`)).json())).toEqual([
      post.id,
    ]);

    // A public group's post can be reshared.
    expect((await outsider.client.post(`/api/v1/statuses/${post.id}/reblog`)).statusCode).toBe(200);

    // The group is listed, and people search does not show it as a person.
    const listed = (await anonymous.get(`/api/v1/groups?q=${group.handle}`)).json();
    expect(ids(listed)).toEqual([group.id]);
    const people = (await anonymous.get(`/api/v1/search/accounts?q=${group.handle}`)).json();
    expect(people).toEqual([]);
    expect(ids((await reader.client.get('/api/v1/groups?scope=mine')).json())).toEqual([group.id]);
  });

  it('keeps a private group to its members and lets moderators approve requests', async () => {
    const owner = await signedIn();
    const group = await createGroup(owner.client, 'private');
    const post = (
      await owner.client.post('/api/v1/statuses', { content: 'Members only', groupId: group.id })
    ).json();
    expect(post.visibility).toBe('limited');

    const stranger = await signedIn();
    expect((await stranger.client.get(`/api/v1/groups/${group.id}`)).statusCode).toBe(200);
    expect((await stranger.client.get(`/api/v1/statuses/${post.id}`)).statusCode).toBe(404);
    expect((await stranger.client.get(`/api/v1/groups/${group.id}/timeline`)).json()).toEqual([]);
    expect((await stranger.client.get(`/api/v1/groups/${group.id}/members`)).statusCode).toBe(403);
    expect((await stranger.client.post(`/api/v1/statuses/${post.id}/reblog`)).statusCode).toBe(404);

    // Asking to join notifies the admins.
    const asked = (await stranger.client.post(`/api/v1/groups/${group.id}/join`)).json();
    expect(asked.membership).toEqual({ role: 'member', state: 'requested' });
    const notes = (await owner.client.get('/api/v1/notifications')).json();
    expect(notes[0]).toMatchObject({
      type: 'group_request',
      account: { id: stranger.account.id },
      group: { id: group.id },
    });
    const requests = (
      await owner.client.get(`/api/v1/groups/${group.id}/members?state=requested`)
    ).json();
    expect(requests.map((m: { account: { id: string } }) => m.account.id)).toEqual([
      stranger.account.id,
    ]);
    expect((await owner.client.get(`/api/v1/groups/${group.id}`)).json().requestsCount).toBe(1);
    // A pending member still sees nothing.
    expect((await stranger.client.get(`/api/v1/statuses/${post.id}`)).statusCode).toBe(404);

    expect(
      (await owner.client.post(`/api/v1/groups/${group.id}/members/${stranger.account.id}/approve`))
        .statusCode,
    ).toBe(200);
    expect((await stranger.client.get(`/api/v1/statuses/${post.id}`)).statusCode).toBe(200);
    expect((await stranger.client.get('/api/v1/notifications')).json()[0]).toMatchObject({
      type: 'group_accepted',
      group: { id: group.id },
    });
    // The request notification is gone once answered.
    expect(
      (await owner.client.get('/api/v1/notifications'))
        .json()
        .filter((n: { type: string }) => n.type === 'group_request'),
    ).toEqual([]);

    // Mentions reach members only.
    const outsider = await signedIn();
    await stranger.client.post('/api/v1/statuses', {
      content: `Hey @${outsider.account.username} and @${owner.account.username}`,
      groupId: group.id,
    });
    expect((await outsider.client.get('/api/v1/notifications')).json()).toEqual([]);
    expect((await owner.client.get('/api/v1/notifications')).json()[0]).toMatchObject({
      type: 'mention',
      account: { id: stranger.account.id },
    });

    // A group gets stricter, never more open.
    expect(
      (await owner.client.patch(`/api/v1/groups/${group.id}`, { privacy: 'public' })).statusCode,
    ).toBe(422);
    expect(
      (await owner.client.patch(`/api/v1/groups/${group.id}`, { privacy: 'secret' })).json(),
    ).toMatchObject({ privacy: 'secret' });
    expect(
      (await stranger.client.patch(`/api/v1/groups/${group.id}`, { name: 'Mine' })).statusCode,
    ).toBe(403);
  });

  it('hides a secret group from everyone but its members and the people invited', async () => {
    const owner = await signedIn();
    const group = await createGroup(owner.client, 'secret');
    const guest = await signedIn();
    expect((await guest.client.get(`/api/v1/groups/${group.id}`)).statusCode).toBe(404);
    expect((await guest.client.post(`/api/v1/groups/${group.id}/join`)).statusCode).toBe(404);
    expect(ids((await guest.client.get(`/api/v1/groups?q=${group.handle}`)).json())).toEqual([]);

    expect(
      (await owner.client.post(`/api/v1/groups/${group.id}/members/${guest.account.id}/invite`))
        .statusCode,
    ).toBe(200);
    const invite = (await guest.client.get('/api/v1/notifications')).json()[0];
    expect(invite).toMatchObject({
      type: 'group_invite',
      account: { id: owner.account.id },
      group: { id: group.id, privacy: 'secret' },
    });
    expect(ids((await guest.client.get('/api/v1/groups?scope=invited')).json())).toEqual([
      group.id,
    ]);
    expect((await guest.client.get(`/api/v1/groups/${group.id}`)).json().membership).toEqual({
      role: 'member',
      state: 'invited',
    });
    const joined = (await guest.client.post(`/api/v1/groups/${group.id}/join`)).json();
    expect(joined.membership.state).toBe('member');
    expect(joined.membersCount).toBe(2);

    // Members of a secret group may not invite: moderators do.
    const friend = await signedIn();
    expect(
      (await guest.client.post(`/api/v1/groups/${group.id}/members/${friend.account.id}/invite`))
        .statusCode,
    ).toBe(403);
  });

  it('has admins, moderators and members with their own powers', async () => {
    const owner = await signedIn();
    const group = await createGroup(owner.client, 'public');
    const mod = await signedIn();
    const member = await signedIn();
    await mod.client.post(`/api/v1/groups/${group.id}/join`);
    await member.client.post(`/api/v1/groups/${group.id}/join`);

    // The last admin cannot leave.
    expect((await owner.client.post(`/api/v1/groups/${group.id}/leave`)).statusCode).toBe(403);
    expect(
      (
        await owner.client.patch(`/api/v1/groups/${group.id}/members/${mod.account.id}`, {
          role: 'moderator',
        })
      ).statusCode,
    ).toBe(200);
    const members = (await member.client.get(`/api/v1/groups/${group.id}/members`)).json();
    expect(members.map((m: { role: string }) => m.role)).toEqual(['admin', 'moderator', 'member']);

    // Moderators delete posts in their group and remove members, but not other moderators.
    const post = (
      await member.client.post('/api/v1/statuses', { content: 'Spam', groupId: group.id })
    ).json();
    expect((await mod.client.delete(`/api/v1/statuses/${post.id}`)).statusCode).toBe(200);
    expect((await owner.client.get(`/api/v1/statuses/${post.id}`)).statusCode).toBe(404);
    expect(
      (await member.client.delete(`/api/v1/groups/${group.id}/members/${mod.account.id}`))
        .statusCode,
    ).toBe(403);
    expect(
      (await mod.client.delete(`/api/v1/groups/${group.id}/members/${member.account.id}`))
        .statusCode,
    ).toBe(200);
    expect((await member.client.get(`/api/v1/groups/${group.id}`)).json().membership).toBeNull();

    // Members leave; admins delete the group with its posts.
    const kept = (
      await mod.client.post('/api/v1/statuses', { content: 'Bye', groupId: group.id })
    ).json();
    expect((await mod.client.post(`/api/v1/groups/${group.id}/leave`)).statusCode).toBe(200);
    expect((await mod.client.delete(`/api/v1/groups/${group.id}`)).statusCode).toBe(403);
    expect((await owner.client.delete(`/api/v1/groups/${group.id}`)).statusCode).toBe(200);
    expect((await owner.client.get(`/api/v1/groups/${group.id}`)).statusCode).toBe(404);
    expect((await owner.client.get(`/api/v1/statuses/${kept.id}`)).statusCode).toBe(404);
  });

  it('serves a public group as an ActivityPub Group and keeps private ones off the fediverse', async () => {
    const owner = await signedIn();
    const open = await createGroup(owner.client, 'public');
    const closed = await createGroup(owner.client, 'private');
    const actor = await app().inject({
      method: 'GET',
      url: `/users/${open.handle}`,
      headers: { accept: 'application/activity+json' },
    });
    expect(actor.statusCode).toBe(200);
    expect(actor.json()).toMatchObject({
      type: 'Group',
      preferredUsername: open.handle,
      url: `https://disbigle.test/groups/${open.handle}`,
    });
    const finger = await app().inject({
      method: 'GET',
      url: `/.well-known/webfinger?resource=acct:${open.handle}@disbigle.test`,
      headers: { host: 'disbigle.test' },
    });
    expect(finger.statusCode).toBe(200);
    const hidden = await app().inject({
      method: 'GET',
      url: `/users/${closed.handle}`,
      headers: { accept: 'application/activity+json' },
    });
    expect(hidden.statusCode).toBe(404);
    const hiddenFinger = await app().inject({
      method: 'GET',
      url: `/.well-known/webfinger?resource=acct:${closed.handle}@disbigle.test`,
      headers: { host: 'disbigle.test' },
    });
    expect(hiddenFinger.statusCode).toBe(404);

    // A browser opening the group's actor gets the group's page.
    const browser = await app().inject({
      method: 'GET',
      url: `/users/${open.handle}`,
      headers: { accept: 'text/html' },
    });
    expect(browser.statusCode).toBe(302);
    expect(browser.headers.location).toBe(`/groups/${open.handle}`);

    // A post in a private group is never served to other servers.
    const post = (
      await owner.client.post('/api/v1/statuses', { content: 'Secret plan', groupId: closed.id })
    ).json();
    const note = await app().inject({
      method: 'GET',
      url: `/users/${owner.account.username}/statuses/${post.id}`,
      headers: { accept: 'application/activity+json' },
    });
    expect(note.statusCode).toBe(404);
  });
});
