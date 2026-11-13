import { emailVerificationRequired } from '@disbigle/config';
import { schema } from '@disbigle/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';
import { randomToken, sha256 } from '../crypto/tokens.ts';
import { DomainError } from '../errors.ts';
import type { Mailer } from '../mail.ts';

const VERIFY_TTL_SECONDS = 3 * 24 * 60 * 60;

const texts = {
  en: {
    subject: 'Confirm your email address',
    body: (link: string, domain: string) =>
      `Welcome to ${domain}!\n\nOpen this link within three days to confirm your email address and activate your account:\n${link}\n\nIf you did not sign up, ignore this email: nothing happens without the confirmation.`,
  },
  it: {
    subject: 'Conferma il tuo indirizzo email',
    body: (link: string, domain: string) =>
      `Benvenuto su ${domain}!\n\nApri questo link entro tre giorni per confermare il tuo indirizzo email e attivare l'account:\n${link}\n\nSe non ti sei iscritto, ignora questa email: senza conferma non succede nulla.`,
  },
  es: {
    subject: 'Confirma tu dirección de correo',
    body: (link: string, domain: string) =>
      `¡Bienvenido a ${domain}!\n\nAbre este enlace antes de tres días para confirmar tu dirección de correo y activar tu cuenta:\n${link}\n\nSi no te has registrado, ignora este correo: sin la confirmación no pasa nada.`,
  },
  fr: {
    subject: 'Confirme ton adresse e-mail',
    body: (link: string, domain: string) =>
      `Bienvenue sur ${domain} !\n\nOuvre ce lien dans les trois jours pour confirmer ton adresse e-mail et activer ton compte :\n${link}\n\nSi tu ne t'es pas inscrit, ignore cet e-mail : rien ne se passe sans la confirmation.`,
  },
  de: {
    subject: 'Bestätige deine E-Mail-Adresse',
    body: (link: string, domain: string) =>
      `Willkommen bei ${domain}!\n\nÖffne diesen Link innerhalb von drei Tagen, um deine E-Mail-Adresse zu bestätigen und dein Konto zu aktivieren:\n${link}\n\nWenn du dich nicht registriert hast, ignoriere diese E-Mail: Ohne Bestätigung passiert nichts.`,
  },
  zh: {
    subject: '确认你的邮箱地址',
    body: (link: string, domain: string) =>
      `欢迎来到 ${domain}！\n\n请在三天内打开此链接，确认你的邮箱地址并激活账号：\n${link}\n\n如果你没有注册过，请忽略这封邮件：未经确认不会有任何操作。`,
  },
} as const;

export { emailVerificationRequired };

/** Emails a link that confirms the address of an account not confirmed yet. */
export async function sendEmailVerification(
  ctx: CoreContext & { mailer: Mailer },
  userId: string,
): Promise<void> {
  const [user] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user || user.emailVerifiedAt) return;
  const token = randomToken();
  await ctx.kv.set(`email-verify:${sha256(token)}`, user.id, VERIFY_TTL_SECONDS);
  const link = `${ctx.config.PUBLIC_URL}/verify-email?token=${encodeURIComponent(token)}`;
  const t = texts[user.locale as keyof typeof texts] ?? texts.en;
  await ctx.mailer.send({
    to: user.email,
    subject: t.subject,
    text: t.body(link, ctx.config.LOCAL_DOMAIN),
  });
}

/**
 * Sends the link again to an address (or username) whose account is not confirmed. Always
 * succeeds from the caller's point of view: the answer never tells whether it exists.
 */
export async function resendEmailVerification(
  ctx: CoreContext & { mailer: Mailer },
  login: string,
): Promise<void> {
  const [row] = await ctx.db
    .select({ id: schema.users.id })
    .from(schema.users)
    .innerJoin(schema.actors, eq(schema.actors.id, schema.users.actorId))
    .where(
      and(
        isNull(schema.users.emailVerifiedAt),
        sql`(lower(${schema.users.email}) = lower(${login}) or (lower(${schema.actors.username}) = lower(${login}) and ${schema.actors.domain} is null))`,
      ),
    );
  if (row) await sendEmailVerification(ctx, row.id);
}

/** Confirms an address from the emailed link. Returns whether the account still waits for a moderator. */
export async function confirmEmail(
  ctx: CoreContext,
  token: string,
): Promise<{ pendingApproval: boolean }> {
  const key = `email-verify:${sha256(token)}`;
  const userId = await ctx.kv.get(key);
  if (!userId) throw new DomainError('bad_request', 'This link is invalid or has expired');
  await ctx.kv.del(key);
  const [user] = await ctx.db
    .update(schema.users)
    .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.users.id, userId))
    .returning({ approved: schema.users.approved });
  if (!user) throw new DomainError('bad_request', 'This link is invalid or has expired');
  return { pendingApproval: !user.approved };
}
