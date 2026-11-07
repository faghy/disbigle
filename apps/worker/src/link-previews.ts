import {
  type CoreContext,
  cardLinkOf,
  freshCard,
  linkCard,
  listPostsWithoutCard,
  type MediaStorage,
  markNoCard,
  parsePageInfo,
  savePostCard,
} from '@disbigle/core';
import { safeFetch } from './safe-fetch.ts';

const MAX_PAGE_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const USER_AGENT = 'Mozilla/5.0 (compatible; Disbigle link preview; +https://disbigle.com)';

export type Fetcher = typeof safeFetch;

/** The text of a page in its own encoding (UTF-8 when it does not say). */
function decodePage(data: Buffer, type: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(type)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(data);
  } catch {
    return new TextDecoder('utf-8').decode(data);
  }
}

/**
 * Makes the link previews of recent posts: reads the page of each post's first link and keeps
 * its title, description and image (downloaded here, so readers never contact the site).
 * Returns how many posts got a preview.
 */
export async function makeLinkPreviews(
  ctx: CoreContext & { storage: MediaStorage },
  options: { limit?: number; fetch?: Fetcher; allowPrivateAddress?: boolean } = {},
): Promise<number> {
  const fetcher = options.fetch ?? safeFetch;
  const allowPrivateAddress = options.allowPrivateAddress ?? false;
  let made = 0;
  for (const post of await listPostsWithoutCard(ctx, options.limit ?? 10)) {
    const url = cardLinkOf(post.contentHtml);
    if (!url) {
      await markNoCard(ctx, post.id);
      continue;
    }
    const known = await freshCard(ctx, url);
    if (known) {
      await linkCard(ctx, post.id, known.id);
      made += 1;
      continue;
    }
    try {
      const page = await fetcher(url, {
        maxBytes: MAX_PAGE_BYTES,
        timeoutMs: 8000,
        allowPrivateAddress,
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
      });
      if (!/html/i.test(page.type)) {
        await markNoCard(ctx, post.id);
        continue;
      }
      const info = parsePageInfo(decodePage(page.data, page.type), url);
      if (!info) {
        await markNoCard(ctx, post.id);
        continue;
      }
      let image: Buffer | null = null;
      if (info.image) {
        try {
          const picture = await fetcher(info.image, {
            maxBytes: MAX_IMAGE_BYTES,
            timeoutMs: 8000,
            allowPrivateAddress,
            headers: { 'user-agent': USER_AGENT },
          });
          if (picture.type.startsWith('image/')) image = picture.data;
        } catch {
          image = null;
        }
      }
      await savePostCard(ctx, post.id, url, info, image);
      made += 1;
    } catch {
      // Unreachable, too large or not public: no preview for this post.
      await markNoCard(ctx, post.id);
    }
  }
  return made;
}
