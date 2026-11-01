import { lstat, readdir, readFile, statfs } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CoreContext } from '@disbigle/core';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

/** Machine, process, database and queue figures for the admin dashboard. */
export async function serverHealth(ctx: CoreContext, redis?: Redis) {
  const [disk, database, queues, redisMemory, available, media] = await Promise.all([
    statfs(ctx.config.MEDIA_DIR).then(
      (s) => ({ total: s.blocks * s.bsize, free: s.bavail * s.bsize }),
      () => null,
    ),
    ctx.db
      .execute<{ bytes: string }>(sql`select pg_database_size(current_database())::text as bytes`)
      .then((result) => Number([...result][0]?.bytes ?? 0))
      .catch(() => null),
    redis ? queueSizes(redis).catch(() => null) : null,
    redis
      ? redis
          .info('memory')
          .then((info) => Number(/used_memory:(\d+)/.exec(info)?.[1] ?? 0))
          .catch(() => null)
      : null,
    availableMemory(),
    mediaSize(ctx.config.MEDIA_DIR),
  ]);
  const memory = process.memoryUsage();
  return {
    host: {
      cpus: os.cpus().length,
      load: os.loadavg(),
      memoryTotal: os.totalmem(),
      memoryFree: available ?? os.freemem(),
      uptimeSeconds: Math.round(os.uptime()),
    },
    process: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
    },
    disk,
    mediaBytes: media,
    mediaDir: ctx.config.MEDIA_DIR,
    databaseBytes: database,
    redisBytes: redisMemory,
    queues,
  };
}

/** Pending work of the federation queues (see Fedify's RedisMessageQueue and RedisJobQueue). */
async function queueSizes(redis: Redis) {
  const now = Date.now();
  const [activitypubDue, activitypubLater, ready, delayed, inflight, dead] = await Promise.all([
    redis.zcount('fedify_queue', '-inf', now),
    redis.zcount('fedify_queue', `(${now}`, '+inf'),
    redis.llen('disbigle:diaspora:ready'),
    redis.zcard('disbigle:diaspora:delayed'),
    redis.zcard('disbigle:diaspora:inflight'),
    redis.llen('disbigle:diaspora:dead'),
  ]);
  return {
    activitypub: { waiting: activitypubDue, retrying: activitypubLater },
    diaspora: { waiting: ready + inflight, retrying: delayed, failed: dead },
  };
}

/** Memory that programs can still use, page cache included (Linux); null elsewhere. */
async function availableMemory(): Promise<number | null> {
  const meminfo = await readFile('/proc/meminfo', 'utf8').catch(() => '');
  const kib = /^MemAvailable:\s+(\d+) kB/m.exec(meminfo)?.[1];
  return kib ? Number(kib) * 1024 : null;
}

const MEDIA_SIZE_TTL = 10 * 60_000;
let mediaSizeCache: { dir: string; bytes: number; at: number } | null = null;
let mediaSizeRun: Promise<number | null> | null = null;

/**
 * Space the media folder takes on disk (blocks actually used, like `du`). Walking it is slow with
 * many files, so the figure is kept for ten minutes and refreshed in the background meanwhile.
 */
async function mediaSize(dir: string): Promise<number | null> {
  const cached = mediaSizeCache?.dir === dir ? mediaSizeCache : null;
  if (cached && Date.now() - cached.at < MEDIA_SIZE_TTL) return cached.bytes;
  mediaSizeRun ??= diskUsage(dir)
    .then((bytes) => {
      mediaSizeCache = { dir, bytes, at: Date.now() };
      return bytes;
    })
    .catch(() => null)
    .finally(() => {
      mediaSizeRun = null;
    });
  return cached ? cached.bytes : mediaSizeRun;
}

async function diskUsage(dir: string): Promise<number> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  let bytes = 0;
  const files = entries.filter((entry) => entry.isFile());
  // A few at a time: enough to be quick, without opening thousands of files at once.
  for (let i = 0; i < files.length; i += 64) {
    const sizes = await Promise.all(
      files.slice(i, i + 64).map((entry) =>
        lstat(path.join(entry.parentPath, entry.name)).then(
          (stat) => stat.blocks * 512,
          () => 0,
        ),
      ),
    );
    for (const size of sizes) bytes += size;
  }
  return bytes;
}
