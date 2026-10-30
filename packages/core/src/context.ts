import type { Config } from '@disbigle/config';
import type { Database } from '@disbigle/db';
import type { DomainEvent, EventBus } from './events.ts';

/** Minimal key-value store with expiry, used for short-lived state (challenges, pending secrets). */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

/** Per-day counters (federation traffic and the like), kept for about a month. */
export interface DailyCounters {
  /** Adds `by` to `field` in today's (UTC) bucket of `metric`. */
  hit(metric: string, field: string, by?: number): Promise<void>;
  /** The last `days` buckets of `metric`, oldest first; `day` is `YYYY-MM-DD`. */
  read(metric: string, days: number): Promise<{ day: string; counts: Record<string, number> }[]>;
}

/** The UTC days ending today, oldest first, as `YYYY-MM-DD`. */
export function lastDays(days: number, now = new Date()): string[] {
  return Array.from({ length: days }, (_, i) =>
    new Date(now.getTime() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
}

export interface CoreContext {
  db: Database;
  config: Config;
  kv: KeyValueStore;
  /** Receives domain events; optional so simple scripts and tests can omit it. */
  events?: EventBus;
  /**
   * Looks up an unknown remote account (`user@domain`) over the network and stores it.
   * Provided by the federation layer; returns the actor id or null.
   */
  resolveAccount?: (username: string, domain: string) => Promise<string | null>;
  /** Daily counters for the admin dashboard; optional, nothing is counted without it. */
  counters?: DailyCounters;
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

/** In-process DailyCounters, for tests and single-process development. */
export class MemoryDailyCounters implements DailyCounters {
  private readonly buckets = new Map<string, Record<string, number>>();

  async hit(metric: string, field: string, by = 1): Promise<void> {
    const key = `${metric}:${new Date().toISOString().slice(0, 10)}`;
    const counts = this.buckets.get(key) ?? {};
    counts[field] = (counts[field] ?? 0) + by;
    this.buckets.set(key, counts);
  }

  async read(metric: string, days: number) {
    return lastDays(days).map((day) => ({
      day,
      counts: { ...(this.buckets.get(`${metric}:${day}`) ?? {}) },
    }));
  }
}

export async function emit(ctx: CoreContext, event: DomainEvent): Promise<void> {
  await ctx.events?.publish(event);
}
