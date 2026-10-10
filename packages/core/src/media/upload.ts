import { schema, uuidv7 } from '@disbigle/db';
import type { MediaAttachment } from '@disbigle/shared';
import { and, eq, isNull, lt } from 'drizzle-orm';
import sharp, { type Metadata, type Sharp } from 'sharp';
import type { CoreContext } from '../context.ts';
import { DomainError } from '../errors.ts';
import { serializeMedia } from '../social/statuses.ts';
import type { MediaStorage } from './storage.ts';

export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
const MAX_IMAGE_SIDE = 2560;
const PREVIEW_SIDE = 640;

const imageFormats: Record<string, 'jpeg' | 'png' | 'webp' | 'gif' | 'avif'> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};
const extensions: Record<string, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  gif: 'gif',
  avif: 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
};

export interface UploadInput {
  data: Buffer;
  mimeType: string;
  description?: string;
}

function datedPath(id: string, extension: string, suffix = ''): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${now.getUTCFullYear()}/${month}/${id}${suffix}.${extension}`;
}

/**
 * Stores an uploaded file for a later post. Images are re-encoded: this applies the EXIF
 * orientation and strips every metadata block (including GPS position) before anything is saved.
 */
export async function uploadMedia(
  ctx: CoreContext & { storage: MediaStorage },
  actorId: string,
  input: UploadInput,
): Promise<MediaAttachment> {
  const id = uuidv7();
  const description = (input.description ?? '').trim().slice(0, 1500);
  const format = imageFormats[input.mimeType];
  let row: typeof schema.mediaAttachments.$inferInsert;

  if (format) {
    if (input.data.length > MAX_IMAGE_BYTES)
      throw new DomainError('bad_request', 'Image is too large');
    const animated = format === 'gif' || format === 'webp';
    let image: Sharp;
    let meta: Metadata;
    try {
      image = sharp(input.data, { animated, failOn: 'error' });
      meta = await image.metadata();
    } catch {
      throw new DomainError('bad_request', 'The file is not a valid image');
    }
    const resized = image.rotate().resize({
      width: MAX_IMAGE_SIDE,
      height: MAX_IMAGE_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
    });
    const output = await (format === 'jpeg'
      ? resized.jpeg({ quality: 85, mozjpeg: true })
      : format === 'png'
        ? resized.png()
        : format === 'gif'
          ? resized.gif()
          : format === 'avif'
            ? resized.avif()
            : resized.webp({ quality: 85 })
    ).toBuffer({ resolveWithObject: true });
    const preview = await sharp(input.data, { failOn: 'error' })
      .rotate()
      .resize({
        width: PREVIEW_SIDE,
        height: PREVIEW_SIDE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer();

    const filePath = datedPath(id, extensions[format] ?? 'bin');
    const previewPath = datedPath(id, 'webp', '_preview');
    await ctx.storage.put(filePath, output.data);
    await ctx.storage.put(previewPath, preview);
    const pageHeight =
      meta.pageHeight && meta.pages && meta.pages > 1 ? meta.pageHeight : undefined;
    row = {
      id,
      actorId,
      type: 'image',
      mimeType: format === 'jpeg' ? 'image/jpeg' : `image/${format}`,
      filePath,
      previewPath,
      width: output.info.width,
      height: pageHeight ?? output.info.height,
      description,
    };
  } else if (/^(video\/(mp4|webm)|audio\/(mpeg|ogg|mp4))$/.test(input.mimeType)) {
    if (input.data.length > MAX_VIDEO_BYTES)
      throw new DomainError('bad_request', 'File is too large');
    const filePath = datedPath(id, extensions[input.mimeType] ?? 'bin');
    await ctx.storage.put(filePath, input.data);
    row = {
      id,
      actorId,
      type: input.mimeType.startsWith('video/') ? 'video' : 'audio',
      mimeType: input.mimeType,
      filePath,
      description,
    };
  } else {
    throw new DomainError('bad_request', 'Unsupported file type');
  }

  const [saved] = await ctx.db.insert(schema.mediaAttachments).values(row).returning();
  if (!saved) throw new Error('Insert failed');
  return serializeMedia(ctx, saved);
}

/** Updates the alt text of one of your attachments. */
export async function updateMediaDescription(
  ctx: CoreContext,
  actorId: string,
  mediaId: string,
  description: string,
): Promise<MediaAttachment> {
  const [updated] = await ctx.db
    .update(schema.mediaAttachments)
    .set({ description: description.trim().slice(0, 1500) })
    .where(
      and(eq(schema.mediaAttachments.id, mediaId), eq(schema.mediaAttachments.actorId, actorId)),
    )
    .returning();
  if (!updated) throw new DomainError('not_found', 'Media not found');
  return serializeMedia(ctx, updated);
}

/** Deletes uploads never attached to a post, older than `olderThan`. Returns how many were removed. */
export async function cleanupUnattachedMedia(
  ctx: CoreContext & { storage: MediaStorage },
  olderThan: Date,
): Promise<number> {
  const { mediaAttachments } = schema;
  const stale = await ctx.db
    .delete(mediaAttachments)
    .where(and(isNull(mediaAttachments.postId), lt(mediaAttachments.createdAt, olderThan)))
    .returning();
  for (const media of stale) {
    if (media.filePath) await ctx.storage.delete(media.filePath);
    if (media.previewPath) await ctx.storage.delete(media.previewPath);
  }
  return stale.length;
}
