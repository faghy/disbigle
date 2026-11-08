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
  es: {
    subject: 'Restablece tu contraseña',
    body: (link: string, domain: string) =>
      `Alguien ha pedido restablecer la contraseña de tu cuenta en ${domain}.\n\nAbre este enlace antes de una hora para elegir una nueva contraseña:\n${link}\n\nSi no has sido tú, ignora este correo: tu contraseña sigue siendo la misma.`,
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
  const t = texts[user.locale as keyof typeof texts] ?? texts.en;
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
): Promise<string> {
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
  return userId;
}

const warningTexts = {
  en: {
    subject: 'Someone is trying your password',
    body: (domain: string, link: string) =>
      `Several wrong passwords were just tried on your account on ${domain}, so signing in with a password is paused for a few minutes.\n\nIf it was you, wait a little and try again. If not, your account is safe as long as your password is strong; you can change it, and turn on two-step sign-in or a passkey, here:\n${link}`,
  },
  it: {
    subject: 'Qualcuno sta provando la tua password',
    body: (domain: string, link: string) =>
      `Sul tuo account di ${domain} sono state appena provate diverse password sbagliate, quindi l'accesso con password è sospeso per qualche minuto.\n\nSe eri tu, aspetta un po' e riprova. Se no, l'account è al sicuro finché la password è robusta; puoi cambiarla, e attivare l'accesso in due passaggi o una passkey, qui:\n${link}`,
  },
  es: {
    subject: 'Alguien está probando tu contraseña',
    body: (domain: string, link: string) =>
      `Se acaban de probar varias contraseñas incorrectas en tu cuenta de ${domain}, así que el inicio de sesión con contraseña queda en pausa unos minutos.\n\nSi has sido tú, espera un poco y vuelve a intentarlo. Si no, tu cuenta está a salvo mientras tu contraseña sea robusta; puedes cambiarla y activar el inicio en dos pasos o una passkey aquí:\n${link}`,
  },
} as const;

/** Tells the owner that wrong passwords paused password sign-in on their account. */
export async function sendLoginWarning(
  ctx: CoreContext & { mailer: Mailer },
  userId: string,
): Promise<void> {
  const [user] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) return;
  const t = warningTexts[user.locale as keyof typeof warningTexts] ?? warningTexts.en;
  await ctx.mailer.send({
    to: user.email,
    subject: t.subject,
    text: t.body(ctx.config.LOCAL_DOMAIN, `${ctx.config.PUBLIC_URL}/settings/security`),
  });
}
