import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanupUnattachedMedia,
  createPost,
  LocalMediaStorage,
  registerUser,
  updateMediaDescription,
  uploadMedia,
} from '../src/index.ts';
import { uniqueUser, useTestContext } from './helpers.ts';

const base = useTestContext();
let dir = '';
let storage: LocalMediaStorage;
const ctx = () => ({ ...base(), storage });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'disbigle-media-'));
  storage = new LocalMediaStorage(dir);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function photoWithGps(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: '#3366ff' } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'TestCam' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '45/1 27/1 0/1' },
    })
    .toBuffer();
}

describe('media uploads', () => {
  it('re-encodes images, strips metadata, resizes and makes a preview', async () => {
    const { actorId } = await registerUser(base(), uniqueUser());
    const original = await photoWithGps(4000, 3000);
    expect((await sharp(original).metadata()).exif).toBeDefined();

    const media = await uploadMedia(ctx(), actorId, {
      data: original,
      mimeType: 'image/jpeg',
      description: 'Blue',
    });
    expect(media).toMatchObject({ type: 'image', width: 2560, height: 1920, description: 'Blue' });
    expect(media.url).toMatch(/^https:\/\/disbigle\.test\/media\/\d{4}\/\d{2}\/.+\.jpg$/);

    const stored = await readFile(join(dir, media.url.split('/media/')[1] ?? ''));
    const meta = await sharp(stored).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.width).toBe(2560);
    const preview = await sharp(
      await readFile(join(dir, media.previewUrl?.split('/media/')[1] ?? '')),
    ).metadata();
    expect(Math.max(preview.width ?? 0, preview.height ?? 0)).toBe(640);
  });

  it('rejects unsupported and corrupt files', async () => {
    const { actorId } = await registerUser(base(), uniqueUser());
    await expect(
      uploadMedia(ctx(), actorId, {
        data: Buffer.from('MZ...'),
        mimeType: 'application/x-msdownload',
      }),
    ).rejects.toMatchObject({ code: 'bad_request' });
    await expect(
      uploadMedia(ctx(), actorId, { data: Buffer.from('not an image'), mimeType: 'image/png' }),
    ).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('attaches uploads to a post once, by their owner only', async () => {
    const a = await registerUser(base(), uniqueUser());
    const b = await registerUser(base(), uniqueUser());
    const media = await uploadMedia(ctx(), a.actorId, {
      data: await photoWithGps(100, 100),
      mimeType: 'image/jpeg',
    });
    await expect(
      createPost(base(), b.actorId, { content: 'steal', mediaIds: [media.id] }),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
    await updateMediaDescription(base(), a.actorId, media.id, 'A square');
    const post = await createPost(base(), a.actorId, { content: '', mediaIds: [media.id] });
    expect(post.media).toEqual([
      expect.objectContaining({ id: media.id, description: 'A square' }),
    ]);
    await expect(
      createPost(base(), a.actorId, { content: 'again', mediaIds: [media.id] }),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('cleans up stale unattached uploads', async () => {
    const { actorId } = await registerUser(base(), uniqueUser());
    await uploadMedia(ctx(), actorId, { data: await photoWithGps(50, 50), mimeType: 'image/jpeg' });
    expect(await cleanupUnattachedMedia(ctx(), new Date(Date.now() + 1000))).toBeGreaterThanOrEqual(
      1,
    );
  });
});

describe('remote media cache', () => {
  it('stores a local copy of a remote image and serves it instead', async () => {
    const {
      upsertRemoteActor,
      ingestRemotePost,
      listUncachedRemoteMedia,
      storeCachedRemoteImage,
      getStatus,
    } = await import('../src/index.ts');
    const remote = await upsertRemoteActor(base(), {
      username: 'carla',
      domain: 'remote.example',
      publicKeyPem: 'k',
      apUri: 'https://remote.example/users/carla',
      apInbox: 'https://remote.example/inbox',
      protocol: 'activitypub',
    });
    const postId = await ingestRemotePost(base(), {
      authorActorId: remote.id,
      apUri: 'https://remote.example/notes/photo',
      contentHtml: '<p>foto</p>',
      visibility: 'public',
      attachments: [
        { url: 'https://remote.example/photo.jpg', mimeType: 'image/jpeg', description: 'Sea' },
      ],
    });
    const [pending] = await listUncachedRemoteMedia(base(), 100).then((rows) =>
      rows.filter((r) => r.postId === postId),
    );
    expect(pending?.remoteUrl).toBe('https://remote.example/photo.jpg');
    expect(
      await storeCachedRemoteImage(ctx(), pending?.id ?? '', await photoWithGps(1200, 800)),
    ).toBe(true);
    const status = await getStatus(base(), null, postId ?? '');
    expect(status.media[0]?.url).toMatch(/^https:\/\/disbigle\.test\/media\/.+cache-.+\.webp$/);
    expect(status.media[0]?.description).toBe('Sea');
    expect(
      await storeCachedRemoteImage(ctx(), pending?.id ?? '', Buffer.from('not an image')),
    ).toBe(false);
  });
});
