import { schema, uuidv7 } from '@disbigle/db';
import type { PreviewCard } from '@disbigle/shared';
import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import sharp from 'sharp';
import type { CoreContext } from '../context.ts';
import type { MediaStorage } from '../media/storage.ts';
import { datedPath, MAX_INPUT_PIXELS } from '../media/upload.ts';
import { mediaUrl } from './statuses.ts';

const { posts, previewCards, postCards } = schema;

/** Posts get a preview while they are this recent (older ones are not looked at). */
const RECENT_MS = 2 * 24 * 60 * 60 * 1000;
/** A page is read again after this long. */
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const IMAGE_SIDE = 640;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 400;

/** YouTube links have their own player preview. */
const YOUTUBE = /^(?:www\.|m\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)$/i;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/**
 * The link a post's preview is about: the first one that is not a mention, a hashtag or a
 * YouTube video. `html` is the post's sanitised HTML.
 */
export function cardLinkOf(html: string): string | null {
  for (const match of html.matchAll(/<a\s([^>]*)>/gi)) {
    const attrs = match[1] ?? '';
    const href = /\bhref="([^"]+)"/i.exec(attrs)?.[1];
    if (!href) continue;
    const classes = /\bclass="([^"]*)"/i.exec(attrs)?.[1] ?? '';
    if (/\b(mention|hashtag)\b/.test(classes)) continue;
    let url: URL;
    try {
      url = new URL(decodeEntities(href));
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    if (YOUTUBE.test(url.hostname)) continue;
    url.hash = '';
    return url.href;
  }
  return null;
}

export interface PageInfo {
  title: string;
  description: string;
  siteName: string;
  image: string | null;
}

/** Title, description, site name and image of a page, from its Open Graph and other tags. */
export function parsePageInfo(html: string, pageUrl: string): PageInfo | null {
  const head = html.slice(0, 512 * 1024);
  const meta = new Map<string, string>();
  for (const match of head.matchAll(/<meta\s[^>]*>/gi)) {
    const tag = match[0];
    const key = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
    const value = content?.[1] ?? content?.[2];
    if (key && value !== undefined && !meta.has(key)) meta.set(key, decodeEntities(value).trim());
  }
  const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1];
  const clean = (text: string | undefined, max: number) => {
    const value = (text ?? '').replace(/\s+/g, ' ').trim();
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
  };
  const title = clean(
    // Empty tags fall through to the next one (diaspora* profiles have an empty og:title).
    meta.get('og:title') ||
      meta.get('twitter:title') ||
      (titleTag ? decodeEntities(titleTag) : '') ||
      meta.get('og:site_name'),
    MAX_TITLE,
  );
  if (!title) return null;
  const imageRaw = meta.get('og:image') || meta.get('og:image:url') || meta.get('twitter:image');
  let image: string | null = null;
  if (imageRaw) {
    try {
      const url = new URL(imageRaw, pageUrl);
      if (url.protocol === 'https:' || url.protocol === 'http:') image = url.href;
    } catch {
      image = null;
    }
  }
  return {
    title,
    description: clean(
      meta.get('og:description') || meta.get('twitter:description') || meta.get('description'),
      MAX_DESCRIPTION,
    ),
    siteName: clean(meta.get('og:site_name'), 100),
    image,
  };
}

/** Recent posts not looked at yet, newest first. */
export async function listPostsWithoutCard(ctx: CoreContext, limit: number) {
  return ctx.db
    .select({ id: posts.id, contentHtml: posts.contentHtml })
    .from(posts)
    .leftJoin(postCards, eq(postCards.postId, posts.id))
    .where(
      and(
        isNull(postCards.postId),
        isNull(posts.reblogOfId),
        gt(posts.id, uuidv7(Date.now() - RECENT_MS)),
      ),
    )
    .orderBy(desc(posts.id))
    .limit(limit);
}

/** Records that a post has no preview (no link, or nothing usable at the link). */
export async function markNoCard(ctx: CoreContext, postId: string): Promise<void> {
  await ctx.db.insert(postCards).values({ postId, cardId: null }).onConflictDoNothing();
}

/** A preview of this address read recently enough to reuse it. */
export async function freshCard(ctx: CoreContext, url: string) {
  const [card] = await ctx.db
    .select()
    .from(previewCards)
    .where(
      and(eq(previewCards.url, url), gt(previewCards.fetchedAt, new Date(Date.now() - REFRESH_MS))),
    );
  return card ?? null;
}

/**
 * Saves a preview read from a page (its image, when given, already downloaded) and shows it on
 * the post. The image is resized and stored with the media.
 */
export async function savePostCard(
  ctx: CoreContext & { storage: MediaStorage },
  postId: string,
  url: string,
  info: PageInfo,
  image: Buffer | null,
): Promise<void> {
  const card = await savePreviewCard(ctx, url, info, image);
  await linkCard(ctx, postId, card.id);
}

/** Stores a preview of an address (shared by every post that links it). */
export async function savePreviewCard(
  ctx: CoreContext & { storage: MediaStorage },
  url: string,
  info: PageInfo,
  image: Buffer | null,
): Promise<typeof previewCards.$inferSelect> {
  let stored: { path: string; width: number; height: number } | null = null;
  const id = uuidv7();
  if (image) {
    try {
      const output = await sharp(image, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize({ width: IMAGE_SIDE, height: IMAGE_SIDE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer({ resolveWithObject: true });
      const path = datedPath(`card-${id}`, 'webp');
      await ctx.storage.put(path, output.data);
      stored = { path, width: output.info.width, height: output.info.height };
    } catch {
      stored = null;
    }
  }
  const values = {
    title: info.title,
    description: info.description,
    siteName: info.siteName,
    imagePath: stored?.path ?? null,
    imageWidth: stored?.width ?? null,
    imageHeight: stored?.height ?? null,
    fetchedAt: new Date(),
  };
  const [card] = await ctx.db
    .insert(previewCards)
    .values({ id, url, ...values })
    .onConflictDoUpdate({ target: previewCards.url, set: values })
    .returning();
  if (!card) throw new Error('Preview card insert failed');
  return card;
}

/** A stored preview as readers see it. */
export function serializeCard(
  ctx: CoreContext,
  card: typeof previewCards.$inferSelect,
): PreviewCard {
  return {
    url: card.url,
    title: card.title,
    description: card.description,
    siteName: card.siteName || new URL(card.url).hostname.replace(/^www\./, ''),
    image: card.imagePath ? mediaUrl(ctx, card.imagePath) : null,
    width: card.imageWidth,
    height: card.imageHeight,
  };
}

/**
 * Gives a new or edited post the preview of its link at once when that page was read recently
 * (shown while writing, or linked by another post). Otherwise the worker reads it soon after.
 */
export async function attachKnownCard(ctx: CoreContext, postId: string): Promise<void> {
  const [post] = await ctx.db
    .select({ contentHtml: posts.contentHtml })
    .from(posts)
    .where(eq(posts.id, postId));
  const url = post ? cardLinkOf(post.contentHtml) : null;
  if (!url) return;
  const card = await freshCard(ctx, url);
  if (card) await linkCard(ctx, postId, card.id);
}

/** Fetches a URL for previews: `text` of a page, or the bytes of an image. */
export type PreviewFetcher = (
  url: string,
  options: { maxBytes: number; accept: string },
) => Promise<{ data: Buffer; type: string }>;

const PAGE_BYTES = 1024 * 1024;
const IMAGE_BYTES = 3 * 1024 * 1024;

/** The text of a page in its own encoding (UTF-8 when it does not say). */
export function decodePage(data: Buffer, type: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(type)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(data);
  } catch {
    return new TextDecoder('utf-8').decode(data);
  }
}

/**
 * The preview of an address: the stored one when recent, else the page is read now (with its
 * image, kept on this server). Null when the page has nothing to show.
 */
export async function previewForUrl(
  ctx: CoreContext & { storage: MediaStorage },
  url: string,
  fetcher: PreviewFetcher,
): Promise<PreviewCard | null> {
  const known = await freshCard(ctx, url);
  if (known) return serializeCard(ctx, known);
  const page = await fetcher(url, {
    maxBytes: PAGE_BYTES,
    accept: 'text/html,application/xhtml+xml',
  });
  if (!/html/i.test(page.type)) return null;
  const info = parsePageInfo(decodePage(page.data, page.type), url);
  if (!info) return null;
  let image: Buffer | null = null;
  if (info.image) {
    try {
      const picture = await fetcher(info.image, { maxBytes: IMAGE_BYTES, accept: 'image/*' });
      if (picture.type.startsWith('image/')) image = picture.data;
    } catch {
      image = null;
    }
  }
  return serializeCard(ctx, await savePreviewCard(ctx, url, info, image));
}

/** Shows an existing preview on a post. */
export async function linkCard(ctx: CoreContext, postId: string, cardId: string | null) {
  await ctx.db
    .insert(postCards)
    .values({ postId, cardId })
    .onConflictDoUpdate({ target: postCards.postId, set: { cardId } });
}

/** An edited post is looked at again (its link may have changed). */
export async function forgetPostCard(ctx: CoreContext, postId: string): Promise<void> {
  await ctx.db.delete(postCards).where(eq(postCards.postId, postId));
}

/** The previews of these posts, by post id. */
export async function loadCards(
  ctx: CoreContext,
  postIds: string[],
): Promise<Map<string, PreviewCard>> {
  if (postIds.length === 0) return new Map();
  const rows = await ctx.db
    .select({ postId: postCards.postId, card: previewCards })
    .from(postCards)
    .innerJoin(previewCards, eq(previewCards.id, postCards.cardId))
    .where(inArray(postCards.postId, postIds));
  return new Map(rows.map(({ postId, card }) => [postId, serializeCard(ctx, card)]));
}
