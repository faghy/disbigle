import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { uuidv7 } from '@disbigle/db';
import type { PushAlerts } from '@disbigle/db/schema';

export type PushPolicy = 'all' | 'followed' | 'follower' | 'none';

/** Mastodon-only data of a push subscription (the proposed `mastodon` jsonb column). */
export interface MastodonPushData {
  policy: PushPolicy;
  /** RFC 8291 `aes128gcm` when true; the legacy `aesgcm` encoding Mastodon apps default to otherwise. */
  standard: boolean;
  /** The access token, encrypted (see `sealToken`): Mastodon payloads carry it. */
  sealedToken: string;
}

/** A Web Push subscription made by a Mastodon app; one per access token. */
export interface MastodonPushSubscription {
  id: string;
  userId: string;
  tokenId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  /** Alerts in our notification types (mention, reply, like, ...), as the web subscriptions. */
  alerts: PushAlerts;
  mastodon: MastodonPushData;
  createdAt: Date;
}

export type NewMastodonPushSubscription = Omit<MastodonPushSubscription, 'id' | 'createdAt'>;

export interface MastodonPushStore {
  findByToken(tokenId: string): Promise<MastodonPushSubscription | null>;
  listForUser(userId: string): Promise<MastodonPushSubscription[]>;
  /** Replaces the token's subscription (and any other one on the same endpoint). */
  replace(input: NewMastodonPushSubscription): Promise<MastodonPushSubscription>;
  update(
    tokenId: string,
    changes: { alerts?: PushAlerts; policy?: PushPolicy },
  ): Promise<MastodonPushSubscription | null>;
  deleteByToken(tokenId: string): Promise<void>;
  deleteById(id: string): Promise<void>;
}

export class MemoryMastodonPushStore implements MastodonPushStore {
  private readonly rows = new Map<string, MastodonPushSubscription>();

  async findByToken(tokenId: string) {
    for (const row of this.rows.values()) if (row.tokenId === tokenId) return structuredClone(row);
    return null;
  }

  async listForUser(userId: string) {
    return [...this.rows.values()]
      .filter((r) => r.userId === userId)
      .map((r) => structuredClone(r));
  }

  async replace(input: NewMastodonPushSubscription) {
    for (const [id, row] of this.rows) {
      if (row.tokenId === input.tokenId || row.endpoint === input.endpoint) this.rows.delete(id);
    }
    const row: MastodonPushSubscription = { ...input, id: uuidv7(), createdAt: new Date() };
    this.rows.set(row.id, row);
    return structuredClone(row);
  }

  async update(tokenId: string, changes: { alerts?: PushAlerts; policy?: PushPolicy }) {
    for (const row of this.rows.values()) {
      if (row.tokenId !== tokenId) continue;
      if (changes.alerts) row.alerts = changes.alerts;
      if (changes.policy) row.mastodon = { ...row.mastodon, policy: changes.policy };
      return structuredClone(row);
    }
    return null;
  }

  async deleteByToken(tokenId: string) {
    for (const [id, row] of this.rows) if (row.tokenId === tokenId) this.rows.delete(id);
  }

  async deleteById(id: string) {
    this.rows.delete(id);
  }
}

const keyFor = (secret: string) =>
  createHash('sha256').update(`disbigle:mastodon-push-token:${secret}`).digest();

/**
 * Encrypts an access token for storage next to its push subscription (AES-256-GCM, key derived
 * from SESSION_SECRET): payloads must carry the token, but the database alone never reveals it.
 */
export function sealToken(secret: string, token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret), iv);
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}

export function unsealToken(secret: string, sealed: string): string | null {
  try {
    const raw = Buffer.from(sealed, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', keyFor(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
