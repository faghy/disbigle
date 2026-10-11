import {
  type CoreContext,
  cleanupUnattachedMedia,
  DELETION_GRACE_MS,
  listUncachedRemoteMedia,
  MAX_IMAGE_BYTES,
  type MediaStorage,
  purgeDeletedAccounts,
  storeCachedRemoteImage,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import { lt } from 'drizzle-orm';
import { safeFetch } from './safe-fetch.ts';

export interface Job {
  name: string;
  /** Interval between runs, in milliseconds. */
  every: number;
  run: () => Promise<string>;
}

const HOUR = 60 * 60 * 1000;

/** Remote images that failed to download in this process; not retried until restart. */
const failedMedia = new Set<string>();

export function scheduledJobs(ctx: CoreContext & { storage: MediaStorage }): Job[] {
  return [
    {
      name: 'cleanup-unattached-media',
      every: HOUR,
      run: async () => {
        const removed = await cleanupUnattachedMedia(ctx, new Date(Date.now() - 24 * HOUR));
        return `removed ${removed} uploads never attached to a post`;
      },
    },
    {
      name: 'cache-remote-media',
      every: 60 * 1000 + 1000,
      run: async () => {
        if (process.env.CACHE_REMOTE_MEDIA === 'false') return 'disabled';
        const pending = await listUncachedRemoteMedia(ctx, 25);
        let cached = 0;
        for (const media of pending.filter((m) => !failedMedia.has(m.id))) {
          try {
            const { data, type } = await safeFetch(media.remoteUrl ?? '', {
              maxBytes: MAX_IMAGE_BYTES,
            });
            if (type.startsWith('image/') && (await storeCachedRemoteImage(ctx, media.id, data)))
              cached += 1;
            else failedMedia.add(media.id);
          } catch {
            failedMedia.add(media.id);
            // Unreachable or invalid: readers keep loading the remote URL.
          }
        }
        return `cached ${cached}/${pending.length} remote images`;
      },
    },
    {
      name: 'purge-deleted-accounts',
      every: HOUR,
      run: async () => {
        const purged = await purgeDeletedAccounts(ctx, new Date(Date.now() - DELETION_GRACE_MS));
        return `purged ${purged} deleted accounts`;
      },
    },
    {
      name: 'prune-expired-sessions',
      every: 6 * HOUR,
      run: async () => {
        const removed = await ctx.db
          .delete(schema.sessions)
          .where(lt(schema.sessions.expiresAt, new Date()))
          .returning({ id: schema.sessions.id });
        return `removed ${removed.length} expired sessions`;
      },
    },
  ];
}
