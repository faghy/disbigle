import { schema } from '@disbigle/db';
import { type PasswordResetConfirm, passwordResetConfirmSchema } from '@disbigle/shared';
import { eq, sql } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';
import { hashPassword } from '../crypto/passwords.ts';
import { randomToken, sha256 } from '../crypto/tokens.ts';
import { DomainError } from '../errors.ts';
import type { Mailer } from '../mail.ts';
import { revokeOtherSessions } from './sessions.ts';

const RESET_TTL_SECONDS = 60 * 60;

const texts = {
  en: {
    subject: 'Reset your password',
    body: (link: string, domain: string) =>
      `Someone asked to reset the password of your account on ${domain}.\n\nOpen this link within one hour to choose a new password:\n${link}\n\nIf it wasn't you, ignore this email: your password stays the same.`,
  },
  it: {
    subject: 'Reimposta la password',
    body: (link: string, domain: string) =>
      `Qualcuno ha chiesto di reimpostare la password del tuo account su ${domain}.\n\nApri questo link entro un'ora per scegliere una nuova password:\n${link}\n\nSe non sei stato tu, ignora questa email: la password resta invariata.`,
  },
} as const;

/**
 * Emails a one-hour reset link. Always succeeds from the caller's point of view, so the
 * response never reveals whether an address is registered.
 */
export async function requestPasswordReset(
  ctx: CoreContext & { mailer: Mailer },
  email: string,
): Promise<void> {
  const [user] = await ctx.db
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = lower(${email})`);
  if (!user || user.disabledAt || user.deletionRequestedAt) return;
  const token = randomToken();
  await ctx.kv.set(`password-reset:${sha256(token)}`, user.id, RESET_TTL_SECONDS);
  const link = `${ctx.config.PUBLIC_URL}/reset-password?token=${encodeURIComponent(token)}`;
  const t = user.locale === 'it' ? texts.it : texts.en;
  await ctx.mailer.send({
    to: user.email,
    subject: t.subject,
    text: t.body(link, ctx.config.LOCAL_DOMAIN),
  });
}

/** Sets a new password from a reset token and signs out every session. */
export async function confirmPasswordReset(
  ctx: CoreContext,
  request: PasswordResetConfirm,
): Promise<void> {
  const input = passwordResetConfirmSchema.parse(request);
  const key = `password-reset:${sha256(input.token)}`;
  const userId = await ctx.kv.get(key);
  if (!userId) throw new DomainError('bad_request', 'This reset link is invalid or has expired');
  await ctx.kv.del(key);
  await ctx.db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(input.password), updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
  await revokeOtherSessions(ctx, userId);
}
