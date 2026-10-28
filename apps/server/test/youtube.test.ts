import { MemoryKeyValueStore } from '@disbigle/core';
import { describe, expect, it } from 'vitest';
import { youtubeThumbnail, youtubeVideo } from '../src/youtube.ts';

const ID = 'LH_de3zZmkY';

function fakeFetch(responses: Record<string, () => Response>) {
  const asked: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    asked.push(url);
    const match = Object.keys(responses).find((prefix) => url.startsWith(prefix));
    return match ? responses[match]?.() : new Response('', { status: 404 });
  }) as typeof fetch;
  return { fn, asked };
}

describe('YouTube previews', () => {
  it('reads title and channel once, then from the cache', async () => {
    const kv = new MemoryKeyValueStore();
    const { fn, asked } = fakeFetch({
      'https://www.youtube.com/oembed': () =>
        Response.json({ title: 'Time (live loop)', author_name: 'Jimmy Sax', html: '<iframe>' }),
    });
    const video = await youtubeVideo(kv, ID, fn);
    expect(video).toEqual({ id: ID, title: 'Time (live loop)', author: 'Jimmy Sax' });
    expect(asked[0]).toContain(encodeURIComponent(`https://www.youtube.com/watch?v=${ID}`));
    expect(await youtubeVideo(kv, ID, fn)).toEqual(video);
    expect(asked).toHaveLength(1);
  });

  it('remembers a missing video for a while, but not a YouTube outage', async () => {
    const kv = new MemoryKeyValueStore();
    const missing = fakeFetch({});
    expect(await youtubeVideo(kv, ID, missing.fn)).toBeNull();
    expect(await youtubeVideo(kv, ID, missing.fn)).toBeNull();
    expect(missing.asked).toHaveLength(1);

    const other = new MemoryKeyValueStore();
    const down = fakeFetch({
      'https://www.youtube.com/oembed': () => new Response('', { status: 503 }),
    });
    await youtubeVideo(other, ID, down.fn);
    await youtubeVideo(other, ID, down.fn);
    expect(down.asked).toHaveLength(2);
  });

  it('never asks for anything that is not a video id', async () => {
    const { fn, asked } = fakeFetch({});
    const kv = new MemoryKeyValueStore();
    expect(await youtubeVideo(kv, '../../evil', fn)).toBeNull();
    expect(await youtubeThumbnail(kv, 'x/y?z=1&aaaa', fn)).toBeNull();
    expect(asked).toHaveLength(0);
  });

  it('serves JPEG thumbnails only', async () => {
    const kv = new MemoryKeyValueStore();
    const jpeg = fakeFetch({
      'https://i.ytimg.com/': () =>
        new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
          headers: { 'content-type': 'image/jpeg' },
        }),
    });
    expect(await youtubeThumbnail(kv, ID, jpeg.fn)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(jpeg.asked).toEqual([`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`]);

    const html = fakeFetch({
      'https://i.ytimg.com/': () =>
        new Response('<html>', { headers: { 'content-type': 'text/html' } }),
    });
    expect(await youtubeThumbnail(new MemoryKeyValueStore(), ID, html.fn)).toBeNull();
  });
});
