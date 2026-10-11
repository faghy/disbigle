import { uuidv7 } from '@disbigle/db';

/** A registered client application (`POST /api/v1/apps`). */
export interface OAuthApplication {
  id: string;
  name: string;
  website: string | null;
  redirectUris: string[];
  scopes: string[];
  clientId: string;
  /** SHA-256 of the client secret; the secret itself is shown once, at registration. */
  clientSecretHash: string;
  createdAt: Date;
}

/** An authorization code waiting to be exchanged at `/oauth/token`. */
export interface OAuthGrant {
  id: string;
  applicationId: string;
  userId: string;
  /** SHA-256 of the code. */
  codeHash: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge: string | null;
  codeChallengeMethod: 'S256' | 'plain' | null;
  expiresAt: Date;
  createdAt: Date;
}

/** An access token. `userId` is null for application tokens (client_credentials). */
export interface OAuthToken {
  id: string;
  applicationId: string;
  userId: string | null;
  /** SHA-256 of the token. */
  tokenHash: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export type NewApplication = Omit<OAuthApplication, 'id' | 'createdAt'>;
export type NewGrant = Omit<OAuthGrant, 'id' | 'createdAt'>;
export type NewToken = Pick<OAuthToken, 'applicationId' | 'userId' | 'tokenHash' | 'scopes'>;

/**
 * Persistence for OAuth applications, authorization codes and access tokens. Only hashes of
 * secrets, codes and tokens are ever stored.
 */
export interface OAuthStore {
  createApplication(input: NewApplication): Promise<OAuthApplication>;
  findApplicationByClientId(clientId: string): Promise<OAuthApplication | null>;
  findApplication(id: string): Promise<OAuthApplication | null>;

  createGrant(input: NewGrant): Promise<OAuthGrant>;
  /** Returns the grant with this code hash and deletes it, so a code works only once. */
  consumeGrant(codeHash: string): Promise<OAuthGrant | null>;

  createToken(input: NewToken): Promise<OAuthToken>;
  /** A token that has not been revoked. */
  findActiveToken(tokenHash: string): Promise<OAuthToken | null>;
  touchToken(id: string, at: Date): Promise<void>;
  revokeToken(id: string): Promise<void>;
  /** Revokes every token of a user (password change, account disabled). Returns how many. */
  revokeUserTokens(userId: string): Promise<number>;
  /** Active tokens of a user, newest first (for an "authorized apps" settings page). */
  listUserTokens(userId: string): Promise<OAuthToken[]>;
}

/** In-memory store, for tests and single-process experiments. Data is lost on restart. */
export class MemoryOAuthStore implements OAuthStore {
  private readonly applications = new Map<string, OAuthApplication>();
  private readonly grants = new Map<string, OAuthGrant>();
  private readonly tokens = new Map<string, OAuthToken>();

  async createApplication(input: NewApplication): Promise<OAuthApplication> {
    const app: OAuthApplication = { ...input, id: uuidv7(), createdAt: new Date() };
    this.applications.set(app.id, app);
    return { ...app };
  }

  async findApplicationByClientId(clientId: string) {
    for (const app of this.applications.values()) if (app.clientId === clientId) return { ...app };
    return null;
  }

  async findApplication(id: string) {
    const app = this.applications.get(id);
    return app ? { ...app } : null;
  }

  async createGrant(input: NewGrant): Promise<OAuthGrant> {
    const grant: OAuthGrant = { ...input, id: uuidv7(), createdAt: new Date() };
    this.grants.set(grant.codeHash, grant);
    return { ...grant };
  }

  async consumeGrant(codeHash: string) {
    const grant = this.grants.get(codeHash);
    if (!grant) return null;
    this.grants.delete(codeHash);
    return grant;
  }

  async createToken(input: NewToken): Promise<OAuthToken> {
    const token: OAuthToken = {
      ...input,
      id: uuidv7(),
      createdAt: new Date(),
      lastUsedAt: null,
      revokedAt: null,
    };
    this.tokens.set(token.id, token);
    return { ...token };
  }

  async findActiveToken(tokenHash: string) {
    for (const token of this.tokens.values()) {
      if (token.tokenHash === tokenHash && !token.revokedAt) return { ...token };
    }
    return null;
  }

  async touchToken(id: string, at: Date) {
    const token = this.tokens.get(id);
    if (token) token.lastUsedAt = at;
  }

  async revokeToken(id: string) {
    const token = this.tokens.get(id);
    if (token && !token.revokedAt) token.revokedAt = new Date();
  }

  async revokeUserTokens(userId: string) {
    let count = 0;
    for (const token of this.tokens.values()) {
      if (token.userId === userId && !token.revokedAt) {
        token.revokedAt = new Date();
        count += 1;
      }
    }
    return count;
  }

  async listUserTokens(userId: string) {
    return [...this.tokens.values()]
      .filter((t) => t.userId === userId && !t.revokedAt)
      .sort((a, b) => (a.id < b.id ? 1 : -1))
      .map((t) => ({ ...t }));
  }
}
