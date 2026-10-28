import type { KeyValueStore } from '@disbigle/core';

/**
 * YouTube previews without tracking: the server asks YouTube for a video's title and thumbnail,
 * so a reader's browser contacts YouTube only when they choose to play the video.
 */

export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export interface YouTubeVideo {
  id: string;
  title: string;
  author: string;
}

type Fetch = typeof fetch;

const DAY = 24 * 60 * 60;
/** A missing or private video is asked again after an hour. */
const MISSING_TTL = 60 * 60;
const MAX_THUMBNAIL_BYTES = 512 * 1024;
const TIMEOUT_MS = 5000;

const request = (fetchFn: Fetch, url: string) =>
  fetchFn(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': 'Disbigle (+https://disbigle.com)' },
    redirect: 'error',
  });

export async function youtubeVideo(
  kv: KeyValueStore,
  id: string,
  fetchFn: Fetch = fetch,
): Promise<YouTubeVideo | null> {
  if (!YOUTUBE_ID.test(id)) return null;
  const key = `youtube:video:${id}`;
  const cached = await kv.get(key);
  if (cached !== null) return cached ? (JSON.parse(cached) as YouTubeVideo) : null;

  let video: YouTubeVideo | null = null;
  try {
    const watch = `https://www.youtube.com/watch?v=${id}`;
    const response = await request(
      fetchFn,
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`,
    );
    if (response.ok) {
      const data = (await response.json()) as { title?: unknown; author_name?: unknown };
      video = {
        id,
        title: typeof data.title === 'string' ? data.title.slice(0, 300) : '',
        author: typeof data.author_name === 'string' ? data.author_name.slice(0, 200) : '',
      };
    } else if (response.status >= 500) {
      // YouTube having trouble: try again next time, nothing cached.
      return null;
    }
  } catch {
    return null;
  }
  await kv.set(key, video ? JSON.stringify(video) : '', video ? DAY : MISSING_TTL);
  return video;
}

export async function youtubeThumbnail(
  kv: KeyValueStore,
  id: string,
  fetchFn: Fetch = fetch,
): Promise<Buffer | null> {
  if (!YOUTUBE_ID.test(id)) return null;
  const key = `youtube:thumbnail:${id}`;
  const cached = await kv.get(key);
  if (cached !== null) return cached ? Buffer.from(cached, 'base64') : null;

  let image: Buffer | null = null;
  try {
    const response = await request(fetchFn, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
    if (response.status >= 500) return null;
    const type = response.headers.get('content-type') ?? '';
    if (response.ok && type.startsWith('image/jpeg')) {
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length <= MAX_THUMBNAIL_BYTES) image = body;
    }
  } catch {
    return null;
  }
  await kv.set(key, image ? image.toString('base64') : '', image ? DAY : MISSING_TTL);
  return image;
}
