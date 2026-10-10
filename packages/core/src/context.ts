import type { Config } from '@disbigle/config';
import type { Database } from '@disbigle/db';
import type { DomainEvent, EventBus } from './events.ts';

/** Minimal key-value store with expiry, used for short-lived state (challenges, pending secrets). */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

export interface CoreContext {
  db: Database;
  config: Config;
  kv: KeyValueStore;
  /** Receives domain events; optional so simple scripts and tests can omit it. */
  events?: EventBus;
  /** RSA modulus size for new actor keys. 4096 in production; tests may lower it for speed. */
  rsaKeyBits?: number;
}

/** In-process KeyValueStore, for tests and single-process development. */
export class MemoryKeyValueStore implements KeyValueStore {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(key: string): Promise<void> {
    this.entries.delete(key);
  }
}

export async function emit(ctx: CoreContext, event: DomainEvent): Promise<void> {
  await ctx.events?.publish(event);
}
