import type { KeyValueStore } from '@disbigle/core';
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
