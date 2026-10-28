/** A YouTube video linked in a post: its id and where to start playing, in seconds. */
export interface YouTubeLink {
  id: string;
  start: number;
}

const ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);

/** "90", "90s", "1m30s" or "1h2m3s" to seconds. */
function seconds(value: string | null): number {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!match) return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

export function youtubeLink(href: string): YouTubeLink | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  let id: string | null = null;
  if (url.hostname === 'youtu.be') {
    id = url.pathname.slice(1);
  } else if (HOSTS.has(url.hostname)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else id = /^\/(?:shorts|live|embed)\/([^/]+)/.exec(url.pathname)?.[1] ?? null;
  }
  if (!id || !ID.test(id)) return null;
  return { id, start: seconds(url.searchParams.get('t') ?? url.searchParams.get('start')) };
}

/** The first YouTube video linked in a post's HTML, leaving mentions and hashtags aside. */
export function firstYouTubeLink(html: string): YouTubeLink | null {
  if (!html.includes('youtu')) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const anchor of doc.querySelectorAll('a[href]')) {
    if (anchor.classList.contains('mention') || anchor.classList.contains('hashtag')) continue;
    const link = youtubeLink(anchor.getAttribute('href') ?? '');
    if (link) return link;
  }
  return null;
}

/** The player, from YouTube's domain that sets no cookies until the video plays. */
export function youtubeEmbedUrl(link: YouTubeLink): string {
  const params = new URLSearchParams({ autoplay: '1', rel: '0' });
  if (link.start > 0) params.set('start', String(link.start));
  return `https://www.youtube-nocookie.com/embed/${link.id}?${params}`;
}
