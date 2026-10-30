import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { Client, newUser, useTestApp } from './helpers.ts';

const app = useTestApp();

async function signedIn() {
  const client = new Client(app);
  const response = await client.post('/api/v1/auth/register', newUser());
  if (response.statusCode !== 201) throw new Error(`register failed: ${response.body}`);
  return { client, account: response.json().user.account as { id: string } };
}

/** Uploads a small picture and posts it; returns the post and the attachment id. */
async function postPhoto(client: Client, visibility = 'public', sensitive = false) {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#0a0' } })
    .png()
    .toBuffer();
  const boundary = '----disbigle-album';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="p.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    png,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const upload = await app().inject({
    method: 'POST',
    url: '/api/v1/media',
    payload,
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      cookie: client.cookieHeader ?? '',
    },
  });
  const mediaId = upload.json().id as string;
  const post = (
    await client.post('/api/v1/statuses', {
      content: 'Una foto',
      visibility,
      sensitive,
      mediaIds: [mediaId],
    })
  ).json();
  return { postId: post.id as string, mediaId };
}

describe('profile media and albums', () => {
  it('lists the photos of a profile as each viewer may see them', async () => {
    const alice = await signedIn();
    const bruno = await signedIn();
    const open = await postPhoto(alice.client);
    const close = await postPhoto(alice.client, 'followers');
    await alice.client.post('/api/v1/statuses', { content: 'Solo testo' });

    const own = (await alice.client.get(`/api/v1/accounts/${alice.account.id}/media`)).json();
    expect(own.map((m: { media: { id: string } }) => m.media.id)).toEqual([
      close.mediaId,
      open.mediaId,
    ]);
    expect(own[0]).toMatchObject({ statusId: close.postId, sensitive: false });

    const visitor = new Client(app);
    const seen = (await visitor.get(`/api/v1/accounts/${alice.account.id}/media`)).json();
    expect(seen.map((m: { media: { id: string } }) => m.media.id)).toEqual([open.mediaId]);

    await bruno.client.post(`/api/v1/accounts/${alice.account.id}/follow`);
    const follower = (await bruno.client.get(`/api/v1/accounts/${alice.account.id}/media`)).json();
    expect(follower).toHaveLength(2);

    const paged = (
      await alice.client.get(
        `/api/v1/accounts/${alice.account.id}/media?maxId=${close.mediaId}&limit=5`,
      )
    ).json();
    expect(paged.map((m: { media: { id: string } }) => m.media.id)).toEqual([open.mediaId]);
  });

  it('keeps albums of your own photos, showing others only what they may see', async () => {
    const alice = await signedIn();
    const bruno = await signedIn();
    const open = await postPhoto(alice.client);
    const close = await postPhoto(alice.client, 'followers');
    const theirs = await postPhoto(bruno.client);

    const created = await alice.client.post('/api/v1/albums', {
      name: '  Vacanze  ',
      description: 'Estate 2026',
    });
    expect(created.statusCode).toBe(201);
    const album = created.json();
    expect(album).toMatchObject({ name: 'Vacanze', mediaCount: 0, cover: null });

    expect(
      (await alice.client.put(`/api/v1/albums/${album.id}/media/${open.mediaId}`)).statusCode,
    ).toBe(200);
    await alice.client.put(`/api/v1/albums/${album.id}/media/${close.mediaId}`);
    // Only your own photos, and only in your own albums.
    expect(
      (await alice.client.put(`/api/v1/albums/${album.id}/media/${theirs.mediaId}`)).statusCode,
    ).toBe(404);
    expect(
      (await bruno.client.put(`/api/v1/albums/${album.id}/media/${theirs.mediaId}`)).statusCode,
    ).toBe(404);

    const mine = (await alice.client.get(`/api/v1/albums/${album.id}`)).json();
    expect(mine.mediaCount).toBe(2);
    expect(mine.cover.id).toBe(close.mediaId);
    expect(mine.items.map((i: { media: { id: string } }) => i.media.id)).toEqual([
      close.mediaId,
      open.mediaId,
    ]);

    // Bruno does not follow Alice: he sees the public photo only.
    const his = (await bruno.client.get(`/api/v1/albums/${album.id}`)).json();
    expect(his.mediaCount).toBe(1);
    expect(his.cover.id).toBe(open.mediaId);
    expect(his.items).toHaveLength(1);

    const choices = (
      await alice.client.get(`/api/v1/accounts/${alice.account.id}/albums?mediaId=${open.mediaId}`)
    ).json();
    expect(choices).toMatchObject([{ id: album.id, includes: true }]);

    await alice.client.delete(`/api/v1/albums/${album.id}/media/${open.mediaId}`);
    // Now nothing in it is visible to Bruno: the album is hidden from him.
    expect((await bruno.client.get(`/api/v1/albums/${album.id}`)).statusCode).toBe(404);
    expect((await bruno.client.get(`/api/v1/accounts/${alice.account.id}/albums`)).json()).toEqual(
      [],
    );
    expect(
      (await alice.client.get(`/api/v1/accounts/${alice.account.id}/albums`)).json(),
    ).toHaveLength(1);

    const renamed = await alice.client.patch(`/api/v1/albums/${album.id}`, {
      name: 'Mare',
      description: '',
    });
    expect(renamed.json()).toMatchObject({ name: 'Mare', mediaCount: 1 });
    expect((await bruno.client.patch(`/api/v1/albums/${album.id}`, { name: 'x' })).statusCode).toBe(
      404,
    );

    // Deleting the post takes its photo out of the album.
    await alice.client.delete(`/api/v1/statuses/${close.postId}`);
    expect((await alice.client.get(`/api/v1/albums/${album.id}`)).json().mediaCount).toBe(0);

    expect((await alice.client.delete(`/api/v1/albums/${album.id}`)).statusCode).toBe(200);
    expect((await alice.client.get(`/api/v1/albums/${album.id}`)).statusCode).toBe(404);
  });

  it('does not use a sensitive photo as the cover', async () => {
    const alice = await signedIn();
    const plain = await postPhoto(alice.client);
    const sensitive = await postPhoto(alice.client, 'public', true);
    const album = (await alice.client.post('/api/v1/albums', { name: 'Misto' })).json();
    await alice.client.put(`/api/v1/albums/${album.id}/media/${plain.mediaId}`);
    await alice.client.put(`/api/v1/albums/${album.id}/media/${sensitive.mediaId}`);
    const result = (await alice.client.get(`/api/v1/albums/${album.id}`)).json();
    expect(result.cover.id).toBe(plain.mediaId);
    expect(result.items[0]).toMatchObject({ sensitive: true });
  });
});
