import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { Client, newUser, useTestApp } from './helpers.ts';

const app = useTestApp();

function multipart(
  fields: Record<string, string>,
  file: { name: string; type: string; data: Buffer },
) {
  const boundary = '----disbigle-test';
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
    ),
    file.data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return {
    payload: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe('media API', () => {
  it('uploads an image with alt text and posts it', async () => {
    const client = new Client(app);
    await client.post('/api/v1/auth/register', newUser());
    const png = await sharp({
      create: { width: 64, height: 32, channels: 3, background: '#ff0000' },
    })
      .png()
      .toBuffer();
    // Fields before the file, as browsers send them when the form lists them first.
    const body = multipart(
      { description: 'Red' },
      { name: 'red.png', type: 'image/png', data: png },
    );
    const response = await app().inject({
      method: 'POST',
      url: '/api/v1/media',
      payload: body.payload,
      headers: { 'content-type': body.contentType, cookie: client.cookieHeader ?? '' },
    });
    expect(response.statusCode).toBe(201);
    const media = response.json();
    expect(media).toMatchObject({ type: 'image', width: 64, height: 32, description: 'Red' });

    const post = await client.post('/api/v1/statuses', { content: '', mediaIds: [media.id] });
    expect(post.statusCode).toBe(201);
    expect(post.json().media[0].id).toBe(media.id);

    // diaspora* pods ask for sizes by prefixing the file name: they get the same image.
    const path = new URL(media.url).pathname;
    expect((await app().inject({ method: 'GET', url: path })).statusCode).toBe(200);
    const slash = path.lastIndexOf('/');
    const sized = await app().inject({
      method: 'GET',
      url: `${path.slice(0, slash + 1)}thumb_large_${path.slice(slash + 1)}`,
    });
    expect(sized.statusCode).toBe(301);
    expect(sized.headers.location).toBe(path);
  });

  it('changes the attachments of a post when it is edited', async () => {
    const client = new Client(app);
    await client.post('/api/v1/auth/register', newUser());
    const upload = async (color: string) => {
      const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: color } })
        .png()
        .toBuffer();
      const body = multipart({}, { name: `${color}.png`, type: 'image/png', data: png });
      const response = await app().inject({
        method: 'POST',
        url: '/api/v1/media',
        payload: body.payload,
        headers: { 'content-type': body.contentType, cookie: client.cookieHeader ?? '' },
      });
      return response.json().id as string;
    };
    const [red, green, blue] = [
      await upload('#ff0000'),
      await upload('#00ff00'),
      await upload('#0000ff'),
    ];
    const post = (
      await client.post('/api/v1/statuses', { content: 'Colors', mediaIds: [red, green] })
    ).json();

    // Drop red, add blue in front of green.
    const edited = await client.request('PUT', `/api/v1/statuses/${post.id}`, {
      content: 'Colors',
      mediaIds: [blue, green],
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().media.map((m: { id: string }) => m.id)).toEqual([blue, green]);

    // The removed image is free again, and leaving mediaIds out keeps the current ones.
    const reused = await client.post('/api/v1/statuses', { content: 'Red again', mediaIds: [red] });
    expect(reused.statusCode).toBe(201);
    const textOnly = await client.request('PUT', `/api/v1/statuses/${post.id}`, {
      content: 'Hues',
    });
    expect(textOnly.json().media.map((m: { id: string }) => m.id)).toEqual([blue, green]);

    // Media of another post, or of someone else, can't be taken.
    const stolen = await client.request('PUT', `/api/v1/statuses/${post.id}`, {
      content: 'Hues',
      mediaIds: [red],
    });
    expect(stolen.statusCode).toBe(404);

    // Without text, a post needs to keep something.
    const empty = await client.request('PUT', `/api/v1/statuses/${post.id}`, {
      content: '',
      mediaIds: [],
    });
    expect(empty.statusCode).toBe(422);
  });

  it('requires sign-in to upload', async () => {
    const body = multipart({}, { name: 'x.png', type: 'image/png', data: Buffer.from('x') });
    const response = await app().inject({
      method: 'POST',
      url: '/api/v1/media',
      payload: body.payload,
      headers: { 'content-type': body.contentType },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('profile images', () => {
  it('crops and stores an avatar, then removes it', async () => {
    const client = new Client(app);
    await client.post('/api/v1/auth/register', newUser());
    const jpeg = await sharp({
      create: { width: 800, height: 300, channels: 3, background: '#00aa00' },
    })
      .jpeg()
      .toBuffer();
    const body = multipart({}, { name: 'me.jpg', type: 'image/jpeg', data: jpeg });
    const response = await app().inject({
      method: 'POST',
      url: '/api/v1/me/avatar',
      payload: body.payload,
      headers: { 'content-type': body.contentType, cookie: client.cookieHeader ?? '' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().account.avatarUrl).toMatch(
      /^https:\/\/disbigle\.test\/media\/.+avatar-.+\.webp$/,
    );
    const removed = await client.delete('/api/v1/me/avatar');
    expect(removed.json().account.avatarUrl).toBeNull();
  });
});

describe('instance info', () => {
  it('reports the configured title', async () => {
    expect((await new Client(app).get('/api/v1/instance')).json()).toMatchObject({
      title: 'Disbigle Test',
    });
  });
});
