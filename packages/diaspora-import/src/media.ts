// Files uploaded to a diaspora* pod. CarrierWave stores every photo under
// `public/uploads/images/<random_string>.<ext>` plus resized versions with a size prefix
// (`thumb_small_`, `thumb_medium_`, `thumb_large_`, `scaled_full_`).
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { PhotoRow } from './source/types.ts';

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

export const VERSION_PREFIXES = ['thumb_small_', 'thumb_medium_', 'thumb_large_', 'scaled_full_'];

export function mimeTypeFromName(name: string): string {
  const extension = /\.([a-z0-9]+)(?:\?.*)?$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? 'image/jpeg';
}

/** A plain file name (no directories, no traversal), or null. */
export function safeFileName(name: string | null | undefined): string | null {
  if (!name) return null;
  const clean = basename(name);
  if (clean !== name || clean === '.' || clean === '..' || !/^[\w.-]+$/.test(clean)) return null;
  return clean;
}

/** Strips a CarrierWave version prefix: `thumb_large_abc.jpg` → `abc.jpg`. */
export function originalName(name: string): string {
  for (const prefix of VERSION_PREFIXES)
    if (name.startsWith(prefix)) return name.slice(prefix.length);
  return name;
}

export async function readUpload(uploadsDir: string, name: string): Promise<Buffer | null> {
  try {
    return await readFile(join(uploadsDir, 'images', name));
  } catch {
    return null;
  }
}

/** File name of a photo stored on this pod, or null for photos hosted elsewhere. */
export function localPhotoName(photo: PhotoRow): string | null {
  return safeFileName(photo.unprocessedImage) ?? safeFileName(photo.remotePhotoName);
}

/** Full URL of a remote photo, as diaspora* builds it. */
export function remotePhotoUrl(photo: PhotoRow): string | null {
  if (!photo.remotePhotoPath || !photo.remotePhotoName) return null;
  return `${photo.remotePhotoPath}${photo.remotePhotoName}`;
}

/**
 * File name inside `uploads/images` of a profile image URL of this pod
 * (`https://pod/uploads/images/thumb_large_x.jpg` or `/uploads/images/…`), or null.
 */
export function localUploadName(url: string, localDomain: string): string | null {
  let path: string;
  try {
    const parsed = new URL(url, `https://${localDomain}/`);
    if (parsed.host.toLowerCase() !== localDomain.toLowerCase()) return null;
    path = parsed.pathname;
  } catch {
    return null;
  }
  const match = /^\/uploads\/images\/([^/]+)$/.exec(path);
  return safeFileName(match?.[1]);
}
