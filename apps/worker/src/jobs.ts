import {
  type CoreContext,
  cleanupUnattachedMedia,
  DELETION_GRACE_MS,
  IFTAS_DNI,
  listUncachedRemoteMedia,
  listUncachedRemoteProfileImages,
  MAX_IMAGE_BYTES,
  type MediaStorage,
  notifyEndedPolls,
  parseBlocklistCsv,
  publishDueScheduledPosts,
  purgeDeletedAccounts,
  purgeOldModerationRecords,
  storeCachedProfileImage,
  storeCachedRemoteImage,
  syncSharedBlocklist,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import { lt } from 'drizzle-orm';
import { makeLinkPreviews } from './link-previews.ts';
import { safeFetch } from './safe-fetch.ts';

export interface Job {
  name: string;
  /** Interval between runs, in milliseconds. */
  every: number;
  run: () => Promise<string>;
}

const HOUR = 60 * 60 * 1000;

/** Remote images that failed to download, with the time of the failure. */
const failedMedia = new Map<string, number>();
/** A failed remote image is tried again after this long (the remote server may come back). */
const RETRY_FAILED_MS = 6 * HOUR;

/** Failures still waiting for their retry; older ones are forgotten. */
function recentFailures(now = Date.now()): Set<string> {
  for (const [key, at] of failedMedia) if (now - at >= RETRY_FAILED_MS) failedMedia.delete(key);
  return new Set(failedMedia.keys());
}

export function scheduledJobs(ctx: CoreContext & { storage: MediaStorage }): Job[] {
  return [
    {
      // Posts scheduled by their authors (issue #28): one indexed query a minute, 100 at most
      // per run, so a crowd choosing the same minute is spread over a few runs.
      name: 'publish-scheduled-posts',
      every: 60 * 1000,
      run: async () => {
        const { published, failed } = await publishDueScheduledPosts(ctx);
        return `published ${published} scheduled posts, ${failed} failed`;
      },
    },
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
        const failed = recentFailures();
        const pending = await listUncachedRemoteMedia(
          ctx,
          25,
          [...failed].filter((key) => !key.includes(':')),
        );
        let cached = 0;
        for (const media of pending) {
          try {
            const { data, type } = await safeFetch(media.remoteUrl ?? '', {
              maxBytes: MAX_IMAGE_BYTES,
            });
            if (type.startsWith('image/') && (await storeCachedRemoteImage(ctx, media.id, data)))
              cached += 1;
            else failedMedia.set(media.id, Date.now());
          } catch {
            failedMedia.set(media.id, Date.now());
            // Unreachable or invalid: readers keep loading the remote URL.
          }
        }
        for (const actor of await listUncachedRemoteProfileImages(ctx, 25)) {
          for (const kind of ['avatar', 'header'] as const) {
            const remote = kind === 'avatar' ? actor.avatarRemoteUrl : actor.headerRemoteUrl;
            const current = kind === 'avatar' ? actor.avatarUrl : actor.headerUrl;
            const key = `${actor.id}:${kind}:${remote}`;
            if (!remote || current !== remote || failed.has(key)) continue;
            try {
              const { data, type } = await safeFetch(remote, { maxBytes: MAX_IMAGE_BYTES });
              if (
                type.startsWith('image/') &&
                (await storeCachedProfileImage(ctx, actor.id, kind, data))
              )
                cached += 1;
              else failedMedia.set(key, Date.now());
            } catch {
              failedMedia.set(key, Date.now());
            }
          }
        }
        return `cached ${cached} remote images (${pending.length} attachments checked)`;
      },
    },
    {
      // The IFTAS "Do Not Interact" list, kept in step every day (SHARED_BLOCKLIST=false: off).
      name: 'shared-blocklist',
      every: 24 * HOUR,
      run: async () => {
        if (process.env.SHARED_BLOCKLIST === 'false') return 'disabled';
        const { data } = await safeFetch(IFTAS_DNI.url, {
          maxBytes: 2 * 1024 * 1024,
          headers: { 'user-agent': 'Disbigle (+https://disbigle.com)' },
        });
        const entries = parseBlocklistCsv(data.toString('utf8'));
        // A broken download must not lift every block of the list.
        if (entries.length < 10) return `ignored: only ${entries.length} entries`;
        const { added, removed } = await syncSharedBlocklist(ctx, IFTAS_DNI.source, entries);
        return `IFTAS DNI: ${entries.length} listed, ${added.length} added, ${removed.length} removed`;
      },
    },
    {
      // Reports and moderation decisions are kept two years (privacy policy).
      name: 'moderation-retention',
      every: 24 * HOUR,
      run: async () => `deleted ${await purgeOldModerationRecords(ctx)} old moderation records`,
    },
    {
      name: 'link-previews',
      every: 30 * 1000 + 1000,
      run: async () => {
        if (process.env.LINK_PREVIEWS === 'false') return 'disabled';
        return `made ${await makeLinkPreviews(ctx)} link previews`;
      },
    },
    {
      name: 'notify-ended-polls',
      every: 60 * 1000 + 1000,
      run: async () => `notified ${await notifyEndedPolls(ctx)} ended polls`,
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
