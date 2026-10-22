import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { form, links, mastodonUser, useMastodonApp } from './helpers.ts';

const { app } = useMastodonApp();

function multipart(
  fields: Record<string, string>,
  file?: { field: string; name: string; type: string; data: Buffer },
) {
  const boundary = '----mastodon-test';
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
      ),
      file.data,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

const png = () =>
  sharp({ create: { width: 40, height: 20, channels: 3, background: '#3366ff' } })
    .png()
    .toBuffer();

describe('Mastodon API: statuses and timelines', () => {
  it('posts form-encoded statuses and pages the home timeline with Link headers', async () => {
    const alice = await mastodonUser(app);
    const ids: string[] = [];
    for (const text of ['one #fedi', 'two', 'three']) {
      const response = await alice.api.post('/api/v1/statuses', form({ status: text }));
      expect(response.statusCode).toBe(200);
      ids.push(response.json().id);
    }
    // Idempotency-Key: a retried request returns the same status instead of a duplicate.
    const retry1 = await alice.api.post('/api/v1/statuses', form({ status: 'four' }), {
      'idempotency-key': 'k1',
    });
    const retry2 = await alice.api.post('/api/v1/statuses', form({ status: 'four' }), {
      'idempotency-key': 'k1',
    });
    expect(retry2.json().id).toBe(retry1.json().id);
    ids.push(retry1.json().id);
    const [one, two, three, four] = ids;

    const first = await alice.api.get('/api/v1/timelines/home?limit=2');
    expect(first.json().map((s: { id: string }) => s.id)).toEqual([four, three]);
    const pages = links(first);
    expect(pages.next).toBe(`/api/v1/timelines/home?limit=2&max_id=${three}`);
    expect(pages.prev).toBe(`/api/v1/timelines/home?limit=2&min_id=${four}`);

    const second = await alice.api.get(pages.next ?? '');
    expect(second.json().map((s: { id: string }) => s.id)).toEqual([two, one]);
    const sinceId = await alice.api.get(`/api/v1/timelines/home?since_id=${one}&limit=2`);
    expect(sinceId.json().map((s: { id: string }) => s.id)).toEqual([four, three]);
    const minId = await alice.api.get(`/api/v1/timelines/home?min_id=${one}&limit=2`);
    expect(minId.json().map((s: { id: string }) => s.id)).toEqual([three, two]);
    const empty = await alice.api.get(`/api/v1/timelines/home?min_id=${four}`);
    expect(empty.json()).toEqual([]);
    expect(empty.headers.link).toBeUndefined();

    const status = first.json()[0];
    expect(status).toMatchObject({
      visibility: 'public',
      account: { id: alice.account.id, statuses_count: 4 },
      favourited: false,
      media_attachments: [],
      emojis: [],
    });
    const publicLocal = await alice.api.get('/api/v1/timelines/public?local=true&limit=40');
    expect(publicLocal.json().map((s: { id: string }) => s.id)).toContain(one);
    const tag = await alice.api.get('/api/v1/timelines/tag/fedi');
    expect(tag.json().map((s: { id: string }) => s.id)).toEqual([one]);
    expect(await alice.api.get('/api/v1/timelines/home?max_id=12345')).toHaveProperty(
      'statusCode',
      422,
    );
  });

  it('replies, favourites, reblogs, bookmarks, edits and deletes', async () => {
    const alice = await mastodonUser(app);
    const bob = await mastodonUser(app);
    await bob.api.post(`/api/v1/accounts/${alice.account.id}/follow`);
    const post = (
      await alice.api.post('/api/v1/statuses', {
        status: 'Hello *world*',
        spoiler_text: 'cw',
        visibility: 'public',
        language: 'en',
      })
    ).json();
    expect(post).toMatchObject({ spoiler_text: 'cw', sensitive: true, language: 'en' });
    const reply = (
      await bob.api.post('/api/v1/statuses', {
        status: `@${alice.username} indeed`,
        in_reply_to_id: post.id,
      })
    ).json();
    expect(reply.in_reply_to_id).toBe(post.id);
    expect(reply.mentions[0]).toMatchObject({ id: alice.account.id, acct: alice.username });

    const context = (await bob.api.get(`/api/v1/statuses/${reply.id}/context`)).json();
    expect(context.ancestors.map((s: { id: string }) => s.id)).toEqual([post.id]);

    expect((await bob.api.post(`/api/v1/statuses/${post.id}/favourite`)).json()).toMatchObject({
      favourited: true,
      favourites_count: 1,
    });
    const reblog = (await bob.api.post(`/api/v1/statuses/${post.id}/reblog`)).json();
    expect(reblog.reblog).toMatchObject({ id: post.id, reblogged: true, reblogs_count: 1 });
    expect(reblog.account.id).toBe(bob.account.id);
    expect((await bob.api.post(`/api/v1/statuses/${post.id}/bookmark`)).json().bookmarked).toBe(
      true,
    );
    expect((await bob.api.get('/api/v1/bookmarks')).json()[0].id).toBe(post.id);
    const favourites = await bob.api.get('/api/v1/favourites');
    expect(favourites.json()[0].id).toBe(post.id);
    expect(links(favourites).prev).toContain('min_id=');
    const favouritedBy = (await alice.api.get(`/api/v1/statuses/${post.id}/favourited_by`)).json();
    expect(favouritedBy.map((a: { id: string }) => a.id)).toEqual([bob.account.id]);
    const rebloggedBy = (await alice.api.get(`/api/v1/statuses/${post.id}/reblogged_by`)).json();
    expect(rebloggedBy.map((a: { id: string }) => a.id)).toEqual([bob.account.id]);
    expect((await bob.api.post(`/api/v1/statuses/${post.id}/unreblog`)).json().reblogged).toBe(
      false,
    );

    const source = (await alice.api.get(`/api/v1/statuses/${post.id}/source`)).json();
    expect(source).toEqual({ id: post.id, text: 'Hello *world*', spoiler_text: 'cw' });
    const edited = (
      await alice.api.put(`/api/v1/statuses/${post.id}`, { status: 'Hello **again**' })
    ).json();
    expect(edited.content).toContain('<strong>again</strong>');
    expect(edited.edited_at).not.toBeNull();
    expect((await alice.api.get(`/api/v1/statuses/${post.id}/history`)).json()).toHaveLength(1);

    const deleted = await alice.api.delete(`/api/v1/statuses/${post.id}`);
    expect(deleted.json()).toMatchObject({ id: post.id, text: 'Hello **again**' });
    expect((await alice.api.get(`/api/v1/statuses/${post.id}`)).statusCode).toBe(404);
    expect((await alice.api.get('/api/v1/statuses/not-an-id')).json()).toEqual({
      error: 'Record not found',
    });
  });

  it('maps visibilities: private is followers-only, aspect posts show as private', async () => {
    const alice = await mastodonUser(app);
    const bob = await mastodonUser(app);
    const stranger = await mastodonUser(app);
    await bob.api.post(`/api/v1/accounts/${alice.account.id}/follow`);
    const followersOnly = (
      await alice.api.post('/api/v1/statuses', { status: 'followers only', visibility: 'private' })
    ).json();
    expect(followersOnly.visibility).toBe('private');
    expect((await bob.api.get(`/api/v1/statuses/${followersOnly.id}`)).statusCode).toBe(200);
    expect((await stranger.api.get(`/api/v1/statuses/${followersOnly.id}`)).statusCode).toBe(404);

    const lists = (await alice.api.get('/api/v1/lists')).json();
    const limited = (
      await alice.api.post('/api/v1/statuses', {
        status: 'aspect only',
        visibility: 'limited',
        aspect_ids: [lists[0].id],
      })
    ).json();
    expect(limited.visibility).toBe('private');

    const direct = (
      await alice.api.post('/api/v1/statuses', {
        status: `@${bob.username} psst`,
        visibility: 'direct',
      })
    ).json();
    expect(direct.visibility).toBe('direct');
    const conversations = (await bob.api.get('/api/v1/conversations')).json();
    expect(conversations[0]).toMatchObject({
      last_status: { id: direct.id },
      accounts: [{ id: alice.account.id }],
      unread: false,
    });
  });
});

describe('Mastodon API: accounts, notifications, lists', () => {
  it('follows, reports relationships, lists followers and notifications with filters', async () => {
    const alice = await mastodonUser(app);
    const bob = await mastodonUser(app);
    const followed = await bob.api.post(`/api/v1/accounts/${alice.account.id}/follow`);
    expect(followed.json()).toMatchObject({
      id: alice.account.id,
      following: true,
      followed_by: false,
      requested: false,
    });
    const rels = await alice.api.get(
      `/api/v1/accounts/relationships?id[]=${bob.account.id}&id[]=bogus`,
    );
    expect(rels.json()).toEqual([
      expect.objectContaining({ id: bob.account.id, followed_by: true, following: false }),
    ]);
    const followers = await alice.api.get(`/api/v1/accounts/${alice.account.id}/followers`);
    expect(followers.json().map((a: { id: string }) => a.id)).toEqual([bob.account.id]);
    const profile = (await bob.api.get(`/api/v1/accounts/${alice.account.id}`)).json();
    expect(profile).toMatchObject({ followers_count: 1, following_count: 0 });
    expect((await bob.api.get(`/api/v1/accounts/lookup?acct=${alice.username}`)).json().id).toBe(
      alice.account.id,
    );
    const search = (await bob.api.get(`/api/v1/accounts/search?q=${alice.username}`)).json();
    expect(search.map((a: { id: string }) => a.id)).toContain(alice.account.id);

    const post = (await alice.api.post('/api/v1/statuses', { status: 'like me' })).json();
    await bob.api.post(`/api/v1/statuses/${post.id}/favourite`);
    await bob.api.post('/api/v1/statuses', {
      status: `@${alice.username} hi`,
      in_reply_to_id: post.id,
    });

    const all = await alice.api.get('/api/v1/notifications');
    expect(all.json().map((n: { type: string }) => n.type)).toEqual([
      'mention',
      'favourite',
      'follow',
    ]);
    const favourite = all.json()[1];
    expect(favourite).toMatchObject({ account: { id: bob.account.id }, status: { id: post.id } });
    expect(links(all).next).toContain(`max_id=${all.json()[2].id}`);

    const onlyFavourites = await alice.api.get('/api/v1/notifications?types[]=favourite');
    expect(onlyFavourites.json().map((n: { type: string }) => n.type)).toEqual(['favourite']);
    expect(links(onlyFavourites).next).toContain('types%5B%5D=favourite');
    const noMentions = await alice.api.get(
      '/api/v1/notifications?exclude_types[]=mention&exclude_types[]=follow',
    );
    expect(noMentions.json().map((n: { type: string }) => n.type)).toEqual(['favourite']);
    expect((await alice.api.get(`/api/v1/notifications/${favourite.id}`)).json().id).toBe(
      favourite.id,
    );
    await alice.api.post(`/api/v1/notifications/${favourite.id}/dismiss`);
    expect((await alice.api.get('/api/v1/notifications')).json()).toHaveLength(2);

    // Reading in the app updates the web client's unread count through the marker.
    const newest = (await alice.api.get('/api/v1/notifications')).json()[0].id;
    const marker = await alice.api.post('/api/v1/markers', {
      notifications: { last_read_id: newest },
    });
    expect(marker.json().notifications).toMatchObject({ last_read_id: newest, version: 1 });
    expect((await alice.client.get('/api/v1/notifications/unread_count')).json()).toEqual({
      count: 0,
    });
    expect(
      (await alice.api.get('/api/v1/markers?timeline[]=notifications')).json().notifications
        .last_read_id,
    ).toBe(newest);

    await alice.api.post('/api/v1/notifications/clear');
    expect((await alice.api.get('/api/v1/notifications')).json()).toEqual([]);
  });

  it('handles follow requests for locked accounts', async () => {
    const alice = await mastodonUser(app);
    const bob = await mastodonUser(app);
    await alice.api.patch('/api/v1/accounts/update_credentials', form({ locked: 'true' }));
    expect(
      (await bob.api.post(`/api/v1/accounts/${alice.account.id}/follow`)).json().requested,
    ).toBe(true);
    const requests = (await alice.api.get('/api/v1/follow_requests')).json();
    expect(requests.map((a: { id: string }) => a.id)).toEqual([bob.account.id]);
    expect(
      (await alice.api.get('/api/v1/accounts/verify_credentials')).json().source
        .follow_requests_count,
    ).toBe(1);
    const accepted = await alice.api.post(`/api/v1/follow_requests/${bob.account.id}/authorize`);
    expect(accepted.json()).toMatchObject({ id: bob.account.id, followed_by: true });
  });

  it('presents aspects as lists', async () => {
    const alice = await mastodonUser(app);
    const bob = await mastodonUser(app);
    const lists = (await alice.api.get('/api/v1/lists')).json();
    expect(lists.map((l: { title: string }) => l.title)).toEqual([
      'Family',
      'Friends',
      'Work',
      'Acquaintances',
    ]);
    expect(lists[0]).toMatchObject({ replies_policy: 'list', exclusive: false });

    const created = (await alice.api.post('/api/v1/lists', form({ title: 'Cyclists' }))).json();
    expect(
      (await alice.client.get('/api/v1/aspects')).json().map((a: { id: string }) => a.id),
    ).toContain(created.id);
    await alice.api.post(
      `/api/v1/lists/${created.id}/accounts`,
      form({ 'account_ids[]': [bob.account.id] }),
    );
    const members = (await alice.api.get(`/api/v1/lists/${created.id}/accounts`)).json();
    expect(members.map((a: { id: string }) => a.id)).toEqual([bob.account.id]);
    expect(
      (await alice.api.get(`/api/v1/accounts/${bob.account.id}/lists`))
        .json()
        .map((l: { id: string }) => l.id),
    ).toEqual([created.id]);

    const post = (await bob.api.post('/api/v1/statuses', { status: 'on my bike' })).json();
    const timeline = (await alice.api.get(`/api/v1/timelines/list/${created.id}`)).json();
    expect(timeline.map((s: { id: string }) => s.id)).toEqual([post.id]);

    const renamed = await alice.api.put(`/api/v1/lists/${created.id}`, { title: 'Riders' });
    expect(renamed.json().title).toBe('Riders');
    await alice.api.delete(`/api/v1/lists/${created.id}/accounts`, {
      account_ids: [bob.account.id],
    });
    expect((await alice.api.get(`/api/v1/lists/${created.id}/accounts`)).json()).toEqual([]);
    expect((await alice.api.delete(`/api/v1/lists/${created.id}`)).statusCode).toBe(200);
    expect((await alice.api.get(`/api/v1/lists/${created.id}`)).statusCode).toBe(404);
    // Someone else's aspect is invisible.
    expect((await bob.api.get(`/api/v1/timelines/list/${lists[0].id}`)).statusCode).toBe(404);
  });

  it('updates the profile with multipart, including the avatar', async () => {
    const alice = await mastodonUser(app);
    const body = multipart(
      {
        display_name: 'Alice A.',
        note: 'Line one\nline two',
        'fields_attributes[0][name]': 'Web',
        'fields_attributes[0][value]': 'https://alice.example',
        bot: 'true',
      },
      { field: 'avatar', name: 'me.png', type: 'image/png', data: await png() },
    );
    const updated = await app().inject({
      method: 'PATCH',
      url: '/api/v1/accounts/update_credentials',
      payload: body.payload,
      headers: { ...body.headers, authorization: `Bearer ${alice.api.token}` },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      display_name: 'Alice A.',
      note: '<p>Line one<br>line two</p>',
      bot: true,
      fields: [{ name: 'Web', value: expect.stringContaining('href="https://alice.example"') }],
      source: {
        note: 'Line one\nline two',
        fields: [{ name: 'Web', value: 'https://alice.example' }],
      },
    });
    expect(updated.json().avatar).toMatch(/^https:\/\/disbigle\.test\/media\/.+avatar-.+\.webp$/);
  });
});

describe('Mastodon API: media, polls, search, instance', () => {
  it('uploads media with a description and attaches it with form-encoded media_ids[]', async () => {
    const alice = await mastodonUser(app);
    const body = multipart(
      { description: 'A blue box' },
      { field: 'file', name: 'blue.png', type: 'image/png', data: await png() },
    );
    const uploaded = await app().inject({
      method: 'POST',
      url: '/api/v2/media',
      payload: body.payload,
      headers: { ...body.headers, authorization: `Bearer ${alice.api.token}` },
    });
    expect(uploaded.statusCode).toBe(200);
    const media = uploaded.json();
    expect(media).toMatchObject({
      type: 'image',
      description: 'A blue box',
      meta: { original: { width: 40, height: 20, aspect: 2 } },
    });
    expect(media.url).toMatch(/^https:\/\/disbigle\.test\/media\//);

    const described = await alice.api.put(
      `/api/v1/media/${media.id}`,
      form({ description: 'Blue' }),
    );
    expect(described.json().description).toBe('Blue');
    const status = await alice.api.post(
      '/api/v1/statuses',
      form({ status: 'look', 'media_ids[]': [media.id], sensitive: 'true' }),
    );
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      sensitive: true,
      media_attachments: [{ id: media.id, description: 'Blue', type: 'image' }],
    });
    const mediaTab = await alice.api.get(
      `/api/v1/accounts/${alice.account.id}/statuses?only_media=true`,
    );
    expect(mediaTab.json().map((s: { id: string }) => s.id)).toEqual([status.json().id]);
    const noFile = multipart({ description: 'nothing' });
    const missing = await app().inject({
      method: 'POST',
      url: '/api/v1/media',
      payload: noFile.payload,
      headers: { ...noFile.headers, authorization: `Bearer ${alice.api.token}` },
    });
    expect(missing.statusCode).toBe(422);

    // An edit describes the whole post, as on Mastodon: alt text through media_attributes,
    // and attachments left out of media_ids are taken off.
    const edited = await alice.api.put(`/api/v1/statuses/${status.json().id}`, {
      status: 'look again',
      media_ids: [media.id],
      media_attributes: [{ id: media.id, description: 'Navy' }],
    });
    expect(edited.json().media_attachments).toMatchObject([{ id: media.id, description: 'Navy' }]);
    const textOnly = await alice.api.put(`/api/v1/statuses/${status.json().id}`, {
      status: 'just text',
    });
    expect(textOnly.json().media_attachments).toEqual([]);
  });

  it('creates a poll and votes in it', async () => {
    const alice = await mastodonUser(app);
    const bob = await mastodonUser(app);
    const post = (
      await alice.api.post('/api/v1/statuses', {
        status: 'Tea or coffee?',
        poll: { options: ['Tea', 'Coffee'], expires_in: 3600, multiple: false },
      })
    ).json();
    expect(post.poll).toMatchObject({
      multiple: false,
      expired: false,
      votes_count: 0,
      options: [
        { title: 'Tea', votes_count: 0 },
        { title: 'Coffee', votes_count: 0 },
      ],
      voted: false,
      own_votes: [],
    });
    const voted = await bob.api.post(
      `/api/v1/polls/${post.poll.id}/votes`,
      form({ 'choices[]': '1' }),
    );
    expect(voted.statusCode).toBe(200);
    expect(voted.json()).toMatchObject({
      id: post.poll.id,
      voted: true,
      own_votes: [1],
      votes_count: 1,
      voters_count: 1,
    });
    const twice = await bob.api.post(`/api/v1/polls/${post.poll.id}/votes`, { choices: [0] });
    expect(twice.statusCode).toBe(422);
    expect(
      (await alice.api.get(`/api/v1/polls/${post.poll.id}`)).json().options[1].votes_count,
    ).toBe(1);

    // Editing the options starts the poll over; an edit without a poll removes it.
    const changed = await alice.api.put(`/api/v1/statuses/${post.id}`, {
      status: 'Tea, coffee or juice?',
      poll: { options: ['Tea', 'Coffee', 'Juice'], expires_in: 3600 },
    });
    expect(changed.json().poll).toMatchObject({ votes_count: 0, options: [{}, {}, {}] });
    const removed = await alice.api.put(`/api/v1/statuses/${post.id}`, { status: 'No poll' });
    expect(removed.json().poll).toBeNull();
  });

  it('searches accounts, hashtags and statuses by URL', async () => {
    const alice = await mastodonUser(app);
    const tag = `veg${Date.now().toString(36)}`;
    const post = (await alice.api.post('/api/v1/statuses', { status: `soup #${tag}` })).json();
    const result = (
      await alice.api.get(`/api/v2/search?q=${encodeURIComponent(alice.username)}&resolve=true`)
    ).json();
    expect(result.accounts.map((a: { id: string }) => a.id)).toContain(alice.account.id);
    const tags = (
      await alice.api.get(`/api/v2/search?q=%23${tag.slice(0, 6)}&type=hashtags`)
    ).json();
    expect(tags).toMatchObject({ accounts: [], statuses: [], hashtags: [{ name: tag }] });
    const byUrl = (await alice.api.get(`/api/v2/search?q=${encodeURIComponent(post.url)}`)).json();
    expect(byUrl.statuses.map((s: { id: string }) => s.id)).toEqual([post.id]);

    expect((await alice.api.post(`/api/v1/tags/${tag}/follow`)).json()).toMatchObject({
      name: tag,
      following: true,
    });
    expect((await alice.api.get('/api/v1/followed_tags')).json()[0].name).toBe(tag);
  });

  it('describes the instance (v1 and v2) and answers the endpoints apps probe', async () => {
    const alice = await mastodonUser(app);
    const v2 = (await alice.api.get('/api/v2/instance')).json();
    expect(v2).toMatchObject({
      domain: 'disbigle.test',
      configuration: {
        urls: { streaming: 'wss://disbigle.test' },
        statuses: { max_characters: 5000, max_media_attachments: 4 },
        polls: { max_options: 6 },
      },
      registrations: { enabled: true },
    });
    for (const path of [
      '/api/v1/custom_emojis',
      '/api/v1/filters',
      '/api/v2/filters',
      '/api/v1/announcements',
      '/api/v1/trends/tags',
      '/api/v1/trends/statuses',
      '/api/v1/trends/links',
      '/api/v1/scheduled_statuses',
    ]) {
      const response = await alice.api.get(path);
      expect(response.statusCode, path).toBe(200);
      expect(response.json(), path).toEqual([]);
    }
    expect((await alice.api.get('/api/v1/preferences')).json()).toMatchObject({
      'posting:default:visibility': 'public',
    });
    const header = await app().inject({ method: 'GET', url: '/api/mastodon/missing-header.png' });
    expect(header.headers['content-type']).toBe('image/png');
  });
});
