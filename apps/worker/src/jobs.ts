import {
  type CoreContext,
  cleanupUnattachedMedia,
  DELETION_GRACE_MS,
  type MediaStorage,
  purgeDeletedAccounts,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import { lt } from 'drizzle-orm';

export interface Job {
  name: string;
  /** Interval between runs, in milliseconds. */
  every: number;
  run: () => Promise<string>;
}

const HOUR = 60 * 60 * 1000;

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
