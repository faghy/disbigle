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
  fr: {
    subject: 'Réinitialise ton mot de passe',
    body: (link: string, domain: string) =>
      `Quelqu'un a demandé à réinitialiser le mot de passe de ton compte sur ${domain}.\n\nOuvre ce lien dans l'heure pour choisir un nouveau mot de passe :\n${link}\n\nSi ce n'était pas toi, ignore cet e-mail : ton mot de passe reste le même.`,
  },
  de: {
    subject: 'Setze dein Passwort zurück',
    body: (link: string, domain: string) =>
      `Jemand möchte das Passwort deines Kontos auf ${domain} zurücksetzen.\n\nÖffne diesen Link innerhalb einer Stunde, um ein neues Passwort zu wählen:\n${link}\n\nWenn du das nicht warst, ignoriere diese E-Mail: Dein Passwort bleibt, wie es ist.`,
  },
  zh: {
    subject: '重置你的密码',
    body: (link: string, domain: string) =>
      `有人申请重置你在 ${domain} 上的账号密码。\n\n请在一小时内打开此链接，设置新密码：\n${link}\n\n如果这不是你本人操作，请忽略这封邮件：你的密码不会改变。`,
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
  fr: {
    subject: "Quelqu'un essaie ton mot de passe",
    body: (domain: string, link: string) =>
      `Plusieurs mots de passe erronés viennent d'être essayés sur ton compte de ${domain}, donc la connexion par mot de passe est suspendue pendant quelques minutes.\n\nSi c'était toi, attends un peu et réessaie. Sinon, ton compte est en sécurité tant que ton mot de passe est solide ; tu peux le changer, et activer la connexion en deux étapes ou une clé d'accès, ici :\n${link}`,
  },
  de: {
    subject: 'Jemand probiert dein Passwort aus',
    body: (domain: string, link: string) =>
      `Bei deinem Konto auf ${domain} wurden gerade mehrere falsche Passwörter probiert, deshalb ist die Anmeldung mit Passwort für ein paar Minuten pausiert.\n\nWenn du das warst, warte kurz und versuch es noch einmal. Wenn nicht, ist dein Konto sicher, solange dein Passwort stark ist; du kannst es hier ändern und die Zwei-Faktor-Anmeldung oder einen Passkey einschalten:\n${link}`,
  },
  zh: {
    subject: '有人在尝试你的密码',
    body: (domain: string, link: string) =>
      `刚才有人在你 ${domain} 上的账号中多次输错密码，因此密码登录已暂停几分钟。\n\n如果是你本人，请稍等片刻再试。如果不是，只要你的密码足够强，账号就是安全的；你可以在这里修改密码，并开启两步验证或通行密钥：\n${link}`,
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
