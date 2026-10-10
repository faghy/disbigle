import { schema } from '@disbigle/db';
import type { TotpSetupResponse } from '@disbigle/shared';
import { eq } from 'drizzle-orm';
import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import type { CoreContext } from '../context.ts';
import { verifyPassword } from '../crypto/passwords.ts';
import { DomainError } from '../errors.ts';
import { generateRecoveryCodes } from './recovery-codes.ts';

const SETUP_TTL_SECONDS = 15 * 60;

async function getUserWithHandle(ctx: CoreContext, userId: string) {
  const [row] = await ctx.db
    .select({ user: schema.users, actor: schema.actors })
    .from(schema.users)
    .innerJoin(schema.actors, eq(schema.actors.id, schema.users.actorId))
    .where(eq(schema.users.id, userId));
  if (!row) throw new DomainError('not_found', 'User not found');
  return row;
}

/** Starts TOTP enrollment: the secret is kept aside until the user proves they stored it. */
export async function beginTotpSetup(ctx: CoreContext, userId: string): Promise<TotpSetupResponse> {
  const { user, actor } = await getUserWithHandle(ctx, userId);
  if (user.totpEnabledAt)
    throw new DomainError('conflict', 'Two-factor authentication is already enabled');

  const secret = generateSecret();
  await ctx.kv.set(`totp-setup:${userId}`, secret, SETUP_TTL_SECONDS);
  const otpauthUrl = generateURI({
    issuer: ctx.config.LOCAL_DOMAIN,
    label: `${actor.username}@${ctx.config.LOCAL_DOMAIN}`,
    secret,
  });
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });
  return { secret, otpauthUrl, qrCodeDataUrl };
}

/** Confirms TOTP enrollment with a valid code and returns fresh recovery codes. */
export async function confirmTotpSetup(
  ctx: CoreContext,
  userId: string,
  code: string,
): Promise<string[]> {
  const secret = await ctx.kv.get(`totp-setup:${userId}`);
  if (!secret) throw new DomainError('bad_request', 'Setup expired, start again');
  if (!(await checkCode(secret, code))) throw new DomainError('invalid_mfa_code', 'Invalid code');

  await ctx.db
    .update(schema.users)
    .set({ totpSecret: secret, totpEnabledAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
  await ctx.kv.del(`totp-setup:${userId}`);
  return generateRecoveryCodes(ctx, userId);
}

export async function disableTotp(
  ctx: CoreContext,
  userId: string,
  password: string,
): Promise<void> {
  const { user } = await getUserWithHandle(ctx, userId);
  if (!(await verifyPassword(user.passwordHash, password))) {
    throw new DomainError('invalid_credentials', 'Wrong password');
  }
  await ctx.db
    .update(schema.users)
    .set({ totpSecret: null, totpEnabledAt: null, updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
  await ctx.db.delete(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, userId));
}

/** Verifies a TOTP code for a user, rejecting a code that was already used (replay protection). */
export async function verifyTotpCode(
  ctx: CoreContext,
  userId: string,
  code: string,
): Promise<boolean> {
  const [user] = await ctx.db
    .select({ secret: schema.users.totpSecret })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (!user?.secret) return false;
  const usedKey = `totp-used:${userId}:${code}`;
  if (await ctx.kv.get(usedKey)) return false;
  if (!(await checkCode(user.secret, code))) return false;
  await ctx.kv.set(usedKey, '1', 120);
  return true;
}

async function checkCode(secret: string, code: string): Promise<boolean> {
  try {
    const result = await verify({ secret, token: code, epochTolerance: 30 });
    return result.valid;
  } catch {
    return false;
  }
}
