import { type Database, schema, uuidv7 } from '@disbigle/db';
import type { PushAlerts } from '@disbigle/db/schema';
import { and, eq, isNotNull, or } from 'drizzle-orm';
import type {
  MastodonPushStore,
  MastodonPushSubscription,
  NewMastodonPushSubscription,
  PushPolicy,
} from './store.ts';

const { webPushSubscriptions } = schema;

type Row = typeof webPushSubscriptions.$inferSelect;

function toSubscription(row: Row): MastodonPushSubscription | null {
  if (!row.tokenId || !row.mastodon) return null;
  return {
    id: row.id,
    userId: row.userId,
    tokenId: row.tokenId,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    alerts: row.alerts,
    mastodon: row.mastodon,
    createdAt: row.createdAt,
  };
}

const present = (rows: Row[]) =>
  rows.map(toSubscription).filter((s): s is MastodonPushSubscription => s !== null);

/** Mastodon app subscriptions, stored in `web_push_subscriptions` (rows with a `token_id`). */
export class DrizzleMastodonPushStore implements MastodonPushStore {
  constructor(private readonly db: Database) {}

  async findByToken(tokenId: string) {
    const rows = await this.db
      .select()
      .from(webPushSubscriptions)
      .where(eq(webPushSubscriptions.tokenId, tokenId));
    return present(rows)[0] ?? null;
  }

  async listForUser(userId: string) {
    return present(
      await this.db
        .select()
        .from(webPushSubscriptions)
        .where(
          and(eq(webPushSubscriptions.userId, userId), isNotNull(webPushSubscriptions.tokenId)),
        ),
    );
  }

  async replace(input: NewMastodonPushSubscription) {
    const row = await this.db.transaction(async (tx) => {
      await tx
        .delete(webPushSubscriptions)
        .where(
          or(
            eq(webPushSubscriptions.tokenId, input.tokenId),
            eq(webPushSubscriptions.endpoint, input.endpoint),
          ),
        );
      const [inserted] = await tx
        .insert(webPushSubscriptions)
        .values({ ...input, id: uuidv7() })
        .returning();
      return inserted;
    });
    const subscription = row ? toSubscription(row) : null;
    if (!subscription) throw new Error('Insert failed');
    return subscription;
  }

  async update(tokenId: string, changes: { alerts?: PushAlerts; policy?: PushPolicy }) {
    const current = await this.findByToken(tokenId);
    if (!current) return null;
    const [row] = await this.db
      .update(webPushSubscriptions)
      .set({
        ...(changes.alerts ? { alerts: changes.alerts } : {}),
        ...(changes.policy ? { mastodon: { ...current.mastodon, policy: changes.policy } } : {}),
      })
      .where(eq(webPushSubscriptions.id, current.id))
      .returning();
    return row ? toSubscription(row) : null;
  }

  async deleteByToken(tokenId: string) {
    await this.db.delete(webPushSubscriptions).where(eq(webPushSubscriptions.tokenId, tokenId));
  }

  async deleteById(id: string) {
    await this.db.delete(webPushSubscriptions).where(eq(webPushSubscriptions.id, id));
  }
}
