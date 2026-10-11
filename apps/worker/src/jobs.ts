import {
  type CoreContext,
  cleanupUnattachedMedia,
  DELETION_GRACE_MS,
  listUncachedRemoteMedia,
  listUncachedRemoteProfileImages,
  MAX_IMAGE_BYTES,
  type MediaStorage,
  purgeDeletedAccounts,
  storeCachedProfileImage,
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
        for (const actor of await listUncachedRemoteProfileImages(ctx, 25)) {
          for (const kind of ['avatar', 'header'] as const) {
            const remote = kind === 'avatar' ? actor.avatarRemoteUrl : actor.headerRemoteUrl;
            const current = kind === 'avatar' ? actor.avatarUrl : actor.headerUrl;
            const key = `${actor.id}:${kind}:${remote}`;
            if (!remote || current !== remote || failedMedia.has(key)) continue;
            try {
              const { data, type } = await safeFetch(remote, { maxBytes: MAX_IMAGE_BYTES });
              if (
                type.startsWith('image/') &&
                (await storeCachedProfileImage(ctx, actor.id, kind, data))
              )
                cached += 1;
              else failedMedia.add(key);
            } catch {
              failedMedia.add(key);
            }
          }
        }
        return `cached ${cached} remote images (${pending.length} attachments checked)`;
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
