import { type Database, schema, uuidv7 } from '@disbigle/db';
import { and, desc, eq, isNull, lt } from 'drizzle-orm';

const { oauthApplications, oauthAccessGrants, oauthAccessTokens } = schema;

import type {
  NewApplication,
  NewGrant,
  NewToken,
  OAuthApplication,
  OAuthGrant,
  OAuthStore,
  OAuthToken,
} from './store.ts';

type GrantRow = typeof oauthAccessGrants.$inferSelect;

function toGrant(row: GrantRow): OAuthGrant {
  return {
    ...row,
    codeChallengeMethod:
      row.codeChallengeMethod === 'S256' || row.codeChallengeMethod === 'plain'
        ? row.codeChallengeMethod
        : null,
  };
}

/** PostgreSQL store for the OAuth tables. */
export class DrizzleOAuthStore implements OAuthStore {
  constructor(private readonly db: Database) {}

  async createApplication(input: NewApplication): Promise<OAuthApplication> {
    const [row] = await this.db
      .insert(oauthApplications)
      .values({ ...input, id: uuidv7() })
      .returning();
    if (!row) throw new Error('Insert failed');
    return row;
  }

  async findApplicationByClientId(clientId: string) {
    const [row] = await this.db
      .select()
      .from(oauthApplications)
      .where(eq(oauthApplications.clientId, clientId));
    return row ?? null;
  }

  async findApplication(id: string) {
    const [row] = await this.db
      .select()
      .from(oauthApplications)
      .where(eq(oauthApplications.id, id));
    return row ?? null;
  }

  async createGrant(input: NewGrant): Promise<OAuthGrant> {
    // Expired codes are useless; drop them while we are here.
    await this.db.delete(oauthAccessGrants).where(lt(oauthAccessGrants.expiresAt, new Date()));
    const [row] = await this.db
      .insert(oauthAccessGrants)
      .values({ ...input, id: uuidv7() })
      .returning();
    if (!row) throw new Error('Insert failed');
    return toGrant(row);
  }

  async consumeGrant(codeHash: string) {
    const [row] = await this.db
      .delete(oauthAccessGrants)
      .where(eq(oauthAccessGrants.codeHash, codeHash))
      .returning();
    return row ? toGrant(row) : null;
  }

  async createToken(input: NewToken): Promise<OAuthToken> {
    const [row] = await this.db
      .insert(oauthAccessTokens)
      .values({ ...input, id: uuidv7() })
      .returning();
    if (!row) throw new Error('Insert failed');
    return row;
  }

  async findActiveToken(tokenHash: string) {
    const [row] = await this.db
      .select()
      .from(oauthAccessTokens)
      .where(and(eq(oauthAccessTokens.tokenHash, tokenHash), isNull(oauthAccessTokens.revokedAt)));
    return row ?? null;
  }

  async touchToken(id: string, at: Date) {
    await this.db
      .update(oauthAccessTokens)
      .set({ lastUsedAt: at })
      .where(eq(oauthAccessTokens.id, id));
  }

  async revokeToken(id: string) {
    await this.db
      .update(oauthAccessTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(oauthAccessTokens.id, id), isNull(oauthAccessTokens.revokedAt)));
  }

  async revokeUserTokens(userId: string) {
    const rows = await this.db
      .update(oauthAccessTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(oauthAccessTokens.userId, userId), isNull(oauthAccessTokens.revokedAt)))
      .returning({ id: oauthAccessTokens.id });
    return rows.length;
  }

  async listUserTokens(userId: string) {
    return this.db
      .select()
      .from(oauthAccessTokens)
      .where(and(eq(oauthAccessTokens.userId, userId), isNull(oauthAccessTokens.revokedAt)))
      .orderBy(desc(oauthAccessTokens.id));
  }
}
