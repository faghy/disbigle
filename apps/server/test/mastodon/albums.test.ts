import { schema, uuidv7 } from '@disbigle/db';
import { describe, expect, it } from 'vitest';
import { form, mastodonUser, useMastodonApp } from './helpers.ts';

const { app, ctx } = useMastodonApp();

/** A post with one picture, the attachment written directly (no file processing needed). */
async function postPicture(user: Awaited<ReturnType<typeof mastodonUser>>, visibility = 'public') {
  const account = (await user.api.get('/api/v1/accounts/verify_credentials')).json();
  const mediaId = uuidv7();
  await ctx()
    .db.insert(schema.mediaAttachments)
    .values({
      id: mediaId,
      actorId: account.id,
      type: 'image',
      mimeType: 'image/png',
      filePath: `x/${mediaId}.png`,
    });
  const status = (
    await user.api.post(
      '/api/v1/statuses',
      form({ status: 'Foto', visibility, 'media_ids[]': [mediaId] }),
    )
  ).json();
  return { accountId: account.id as string, statusId: status.id as string, mediaId };
}

describe('Mastodon API: albums', () => {
  it('creates albums, fills them and shows them to others as they may see them', async () => {
    const alice = await mastodonUser(app);
    const bruno = await mastodonUser(app);
    const open = await postPicture(alice);
    const close = await postPicture(alice, 'private');

    const media = (
      await alice.api.get(`/api/v1/accounts/${open.accountId}/statuses?only_media=true`)
    ).json();
    expect(media).toHaveLength(2);

    const created = await alice.api.post('/api/v1/albums', form({ name: 'Mare', description: '' }));
    expect(created.statusCode).toBe(200);
    const album = created.json();
    expect(album).toMatchObject({ name: 'Mare', media_count: 0, cover: null });

    expect(
      (await alice.api.put(`/api/v1/albums/${album.id}/media/${open.mediaId}`)).statusCode,
    ).toBe(200);
    await alice.api.put(`/api/v1/albums/${album.id}/media/${close.mediaId}`);

    const choices = (
      await alice.api.get(`/api/v1/accounts/${open.accountId}/albums?media_id=${open.mediaId}`)
    ).json();
    expect(choices).toMatchObject([{ id: album.id, includes: true, media_count: 2 }]);

    const full = (await alice.api.get(`/api/v1/albums/${album.id}`)).json();
    expect(full.account.id).toBe(open.accountId);
    expect(full.items).toHaveLength(2);
    expect(full.items[0]).toMatchObject({
      status_id: close.statusId,
      sensitive: false,
      media_attachment: { id: close.mediaId, type: 'image' },
    });

    const seen = (await bruno.api.get(`/api/v1/albums/${album.id}`)).json();
    expect(seen.items).toHaveLength(1);
    expect(seen.media_count).toBe(1);

    const renamed = await alice.api.put(
      `/api/v1/albums/${album.id}`,
      form({ name: 'Spiaggia', description: 'Estate' }),
    );
    expect(renamed.json()).toMatchObject({ name: 'Spiaggia', description: 'Estate' });
    expect((await bruno.api.delete(`/api/v1/albums/${album.id}`)).statusCode).toBe(404);

    await alice.api.delete(`/api/v1/albums/${album.id}/media/${open.mediaId}`);
    expect((await bruno.api.get(`/api/v1/albums/${album.id}`)).statusCode).toBe(404);
    expect((await alice.api.delete(`/api/v1/albums/${album.id}`)).statusCode).toBe(200);
    expect((await alice.api.get(`/api/v1/albums/${album.id}`)).statusCode).toBe(404);
  });
});
