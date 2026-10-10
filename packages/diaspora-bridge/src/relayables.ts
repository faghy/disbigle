import type { CoreContext } from '@disbigle/core';
import { schema } from '@disbigle/db';
import { eq } from 'drizzle-orm';
// Storage of received relayables (comments, likes) exactly as signed by their authors, so they
// can be relayed again later and served at `/fetch` with the original order and signature.

/** A relayable as received, ready to be re-sent byte for byte. */
export interface StoredRelayable {
  guid: string;
  /** `Comment`, `Like`, … */
  entityType: string;
  parentGuid: string;
  /** diaspora* ID of the author. */
  author: string;
  /** Entity XML (no envelope), as serialised from what was received. */
  xml: string;
  /** Local post (comment) or like row this relayable became, when known. */
  postId?: string | null;
  likeId?: string | null;
}

export interface RelayableStore {
  save(record: StoredRelayable): Promise<void>;
  get(guid: string): Promise<StoredRelayable | null>;
  /** All relayables stored for a parent (comments of a post, likes of a post or comment). */
  byParent(parentGuid: string): Promise<StoredRelayable[]>;
  delete(guid: string): Promise<void>;
}

/** In-memory store (tests, and the default until the database table exists). */
export class MemoryRelayableStore implements RelayableStore {
  private readonly records = new Map<string, StoredRelayable>();

  async save(record: StoredRelayable): Promise<void> {
    this.records.set(record.guid, { ...record });
  }

  async get(guid: string): Promise<StoredRelayable | null> {
    return this.records.get(guid) ?? null;
  }

  async byParent(parentGuid: string): Promise<StoredRelayable[]> {
    return [...this.records.values()].filter((r) => r.parentGuid === parentGuid);
  }

  async delete(guid: string): Promise<void> {
    this.records.delete(guid);
  }
}

/** Relayables stored in PostgreSQL (production). */
export class DbRelayableStore implements RelayableStore {
  constructor(private readonly ctx: CoreContext) {}

  async save(r: StoredRelayable): Promise<void> {
    const t = schema.diasporaRelayables;
    const links = { postId: r.postId ?? null, likeId: r.likeId ?? null };
    await this.ctx.db
      .insert(t)
      .values({
        guid: r.guid,
        entityType: r.entityType,
        parentGuid: r.parentGuid,
        author: r.author,
        xml: r.xml,
        ...links,
      })
      .onConflictDoUpdate({ target: t.guid, set: { xml: r.xml, ...links } });
  }

  async get(guid: string): Promise<StoredRelayable | null> {
    const [row] = await this.ctx.db
      .select()
      .from(schema.diasporaRelayables)
      .where(eq(schema.diasporaRelayables.guid, guid));
    return row ?? null;
  }

  async byParent(parentGuid: string): Promise<StoredRelayable[]> {
    return this.ctx.db
      .select()
      .from(schema.diasporaRelayables)
      .where(eq(schema.diasporaRelayables.parentGuid, parentGuid));
  }

  async delete(guid: string): Promise<void> {
    await this.ctx.db
      .delete(schema.diasporaRelayables)
      .where(eq(schema.diasporaRelayables.guid, guid));
  }
}
