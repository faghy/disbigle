import { schema, uuidv7 } from '@disbigle/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';
import {
  getDummyPasswordHash,
  hashPassword,
  passwordNeedsRehash,
  verifyPassword,
} from '../crypto/passwords.ts';
import { randomToken, sha256 } from '../crypto/tokens.ts';
import { DomainError } from '../errors.ts';
import { consumeRecoveryCode } from './recovery-codes.ts';
import { verifyTotpCode } from './totp.ts';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MFA_PENDING_TTL_MS = 10 * 60 * 1000;
const MAX_MFA_ATTEMPTS = 5;

export type SecondFactor = 'totp' | 'recovery_code' | 'passkey';

export interface ClientInfo {
  userAgent?: string | undefined;
  ip?: string | undefined;
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  status: 'ok' | 'mfa_required';
  methods?: SecondFactor[];
}

export interface SessionInfo {
  sessionId: string;
  userId: string;
  actorId: string;
  stage: 'mfa_pending' | 'active';
  role: 'user' | 'moderator' | 'admin';
}

async function findUserByLogin(ctx: CoreContext, login: string) {
  const { users, actors } = schema;
  const [row] = await ctx.db
    .select({ user: users, actor: actors })
    .from(users)
    .innerJoin(actors, eq(actors.id, users.actorId))
    .where(
      login.includes('@')
        ? sql`lower(${users.email}) = lower(${login})`
        : and(sql`lower(${actors.username}) = lower(${login})`, isNull(actors.domain)),
    );
  return row;
}

export async function createSession(
  ctx: CoreContext,
  userId: string,
  stage: 'mfa_pending' | 'active',
  client: ClientInfo = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(
    Date.now() + (stage === 'active' ? SESSION_TTL_MS : MFA_PENDING_TTL_MS),
  );
  await ctx.db.insert(schema.sessions).values({
    id: uuidv7(),
    userId,
    tokenHash: sha256(token),
    stage,
    userAgent: client.userAgent?.slice(0, 512) ?? null,
    ip: client.ip ?? null,
    expiresAt,
  });
  return { token, expiresAt };
}

/** Password login. Returns an active session, or a pending one when a second factor is required. */
export async function login(
  ctx: CoreContext,
  credentials: { login: string; password: string },
  client: ClientInfo = {},
): Promise<LoginResult> {
  const row = await findUserByLogin(ctx, credentials.login);
  if (!row) {
    await verifyPassword(await getDummyPasswordHash(), credentials.password);
    throw new DomainError('invalid_credentials', 'Invalid login or password');
  }
  const { user } = row;
  if (!(await verifyPassword(user.passwordHash, credentials.password))) {
    throw new DomainError('invalid_credentials', 'Invalid login or password');
  }
  if (passwordNeedsRehash(user.passwordHash)) {
    // Imported (e.g. diaspora bcrypt) hashes are upgraded to Argon2id on first sign-in.
    await ctx.db
      .update(schema.users)
      .set({ passwordHash: await hashPassword(credentials.password), updatedAt: new Date() })
      .where(eq(schema.users.id, user.id));
  }
  assertCanSignIn(user);

  if (user.totpEnabledAt) {
    const methods: SecondFactor[] = ['totp', 'recovery_code'];
    const [passkey] = await ctx.db
      .select({ id: schema.webauthnCredentials.id })
      .from(schema.webauthnCredentials)
      .where(eq(schema.webauthnCredentials.userId, user.id))
      .limit(1);
    if (passkey) methods.push('passkey');
    const session = await createSession(ctx, user.id, 'mfa_pending', client);
    return { ...session, status: 'mfa_required', methods };
  }

  const session = await createSession(ctx, user.id, 'active', client);
  await markSignedIn(ctx, user.id);
  return { ...session, status: 'ok' };
}

export function assertCanSignIn(user: { disabledAt: Date | null; approved: boolean }): void {
  if (user.disabledAt) throw new DomainError('account_disabled', 'This account has been disabled');
  if (!user.approved) {
    throw new DomainError('account_pending_approval', 'This account is waiting for approval');
  }
}

export async function markSignedIn(ctx: CoreContext, userId: string): Promise<void> {
  await ctx.db
    .update(schema.users)
    .set({ lastSignInAt: new Date() })
    .where(eq(schema.users.id, userId));
}

/** Completes a pending login with a TOTP code or a recovery code. */
export async function verifySecondFactor(
  ctx: CoreContext,
  token: string,
  code: string,
): Promise<void> {
  const session = await resolveSession(ctx, token);
  if (session?.stage !== 'mfa_pending') {
    throw new DomainError('unauthorized', 'No pending sign-in');
  }

  const attemptsKey = `mfa-attempts:${session.sessionId}`;
  const attempts = Number((await ctx.kv.get(attemptsKey)) ?? 0) + 1;
  await ctx.kv.set(attemptsKey, String(attempts), MFA_PENDING_TTL_MS / 1000);
  if (attempts > MAX_MFA_ATTEMPTS) {
    await revokeSession(ctx, token);
    throw new DomainError('too_many_attempts', 'Too many attempts, sign in again');
  }

  const normalized = code.replace(/[\s-]/g, '');
  const ok = /^\d{6}$/.test(normalized)
    ? await verifyTotpCode(ctx, session.userId, normalized)
    : await consumeRecoveryCode(ctx, session.userId, normalized);
  if (!ok) throw new DomainError('invalid_mfa_code', 'Invalid code');

  await activateSession(ctx, session.sessionId, session.userId);
}

export async function activateSession(
  ctx: CoreContext,
  sessionId: string,
  userId: string,
): Promise<void> {
  await ctx.db
    .update(schema.sessions)
    .set({
      stage: 'active',
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      lastUsedAt: new Date(),
    })
    .where(eq(schema.sessions.id, sessionId));
  await markSignedIn(ctx, userId);
}

/** Looks up a session by its token. Returns null when missing, expired, or the user can no longer sign in. */
export async function resolveSession(ctx: CoreContext, token: string): Promise<SessionInfo | null> {
  const { sessions, users } = schema;
  const [row] = await ctx.db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, sha256(token)));
  if (!row) return null;
  const { session, user } = row;
  if (session.expiresAt.getTime() <= Date.now() || user.disabledAt || !user.approved) return null;

  // Sliding expiry, written at most every 5 minutes.
  if (session.stage === 'active' && Date.now() - session.lastUsedAt.getTime() > 5 * 60 * 1000) {
    await ctx.db
      .update(sessions)
      .set({ lastUsedAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
      .where(eq(sessions.id, session.id));
  }
  return {
    sessionId: session.id,
    userId: user.id,
    actorId: user.actorId,
    stage: session.stage,
    role: user.role,
  };
}

export async function revokeSession(ctx: CoreContext, token: string): Promise<void> {
  await ctx.db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token)));
}

export async function revokeOtherSessions(
  ctx: CoreContext,
  userId: string,
  keepSessionId?: string,
) {
  const { sessions } = schema;
  await ctx.db
    .delete(sessions)
    .where(
      keepSessionId
        ? and(eq(sessions.userId, userId), sql`${sessions.id} <> ${keepSessionId}`)
        : eq(sessions.userId, userId),
    );
}
