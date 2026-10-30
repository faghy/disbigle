import { type DailyCounters, type KeyValueStore, lastDays } from '@disbigle/core';
import type { Redis } from 'ioredis';

export class RedisKeyValueStore implements KeyValueStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'disbigle:kv:',
  ) {}

  get(key: string): Promise<string | null> {
    return this.redis.get(this.prefix + key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(this.prefix + key, value, 'EX', Math.max(1, Math.ceil(ttlSeconds)));
  }

  async del(key: string): Promise<void> {
    await this.redis.del(this.prefix + key);
  }
}

/** DailyCounters as Redis hashes, one per metric and UTC day, kept for 35 days. */
export class RedisDailyCounters implements DailyCounters {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'disbigle:stats:',
  ) {}

  async hit(metric: string, field: string, by = 1): Promise<void> {
    const key = `${this.prefix}${metric}:${new Date().toISOString().slice(0, 10)}`;
    await this.redis
      .multi()
      .hincrby(key, field, by)
      .expire(key, 35 * 86_400)
      .exec();
  }

  async read(metric: string, days: number) {
    const pipeline = this.redis.pipeline();
    const dates = lastDays(days);
    for (const day of dates) pipeline.hgetall(`${this.prefix}${metric}:${day}`);
    const results = (await pipeline.exec()) ?? [];
    return dates.map((day, i) => {
      const raw = (results[i]?.[1] ?? {}) as Record<string, string>;
      return {
        day,
        counts: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Number(v)])),
      };
    });
  }
}
