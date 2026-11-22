import { schema } from '@disbigle/db';
import { type Locale, supportedLocales } from '@disbigle/shared';
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { sendEmailVerification } from './accounts/email-verification.ts';
import { requestPasswordReset } from './accounts/password-reset.ts';
import { updateProfile } from './accounts/profile.ts';
import { serializeAccount } from './accounts/serialize.ts';
import type { CoreContext } from './context.ts';
import { DomainError } from './errors.ts';
import type { Mailer } from './mail.ts';
import { logAdminAction } from './moderation.ts';

/**
 * What an administrator can do on a local person's account: correct their data, look after the
 * confirmation of their address, send a password reset link, clear a lost second factor, and
 * delete an account never confirmed. Every change goes to the admin action log.
 */

const { users, actors, adminActionLogs, recoveryCodes, webauthnCredentials } = schema;

type AdminContext = CoreContext & { mailer?: Mailer | undefined };

async function localUser(ctx: CoreContext, userId: string) {
  const [row] = await ctx.db
    .select({ user: users, actor: actors })
    .from(users)
    .innerJoin(actors, eq(actors.id, users.actorId))
    .where(and(eq(users.id, userId), eq(actors.isGroup, false)));
  if (!row) throw new DomainError('not_found', 'User not found');
  return row;
}

function requireMailer(ctx: AdminContext): Mailer {
  if (!ctx.mailer) throw new DomainError('internal_error', 'Email is not configured');
  return ctx.mailer;
}

/** One person's account as the administration page shows it, with the recent log about it. */
export async function getUserForAdmin(ctx: CoreContext, userId: string) {
  const { user, actor } = await localUser(ctx, userId);
  const [passkeys] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId));
  const log = await ctx.db
    .select({
      id: adminActionLogs.id,
      action: adminActionLogs.action,
      details: adminActionLogs.details,
      createdAt: adminActionLogs.createdAt,
      byUsername: actors.username,
    })
    .from(adminActionLogs)
    .leftJoin(users, eq(users.id, adminActionLogs.userId))
    .leftJoin(actors, eq(actors.id, users.actorId))
    .where(
      sql`(${adminActionLogs.targetType} = 'user' and ${adminActionLogs.targetId} = ${userId})
        or (${adminActionLogs.targetType} = 'actor' and ${adminActionLogs.targetId} = ${actor.id})`,
    )
    .orderBy(desc(adminActionLogs.createdAt))
    .limit(30);
  const iso = (value: Date | null) => (value ? value.toISOString() : null);
  return {
    userId: user.id,
    account: serializeAccount(actor),
    email: user.email,
    emailVerifiedAt: iso(user.emailVerifiedAt),
    approved: user.approved,
    role: user.role,
    locale: user.locale,
    totp: user.totpEnabledAt !== null,
    passkeys: passkeys?.count ?? 0,
    createdAt: user.createdAt.toISOString(),
    lastSignInAt: iso(user.lastSignInAt),
    reason: user.registrationReason ?? '',
    suspended: actor.suspendedAt !== null,
    disabled: user.disabledAt !== null,
    deletionRequested: user.deletionRequestedAt !== null,
    log: log.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
  };
}

const emailChangedTexts: Record<
  Locale,
  { subject: string; body: (to: string, domain: string) => string }
> = {
  en: {
    subject: 'The email address of your account was changed',
    body: (to, domain) =>
      `An administrator of ${domain} changed the email address of your account to ${to}.\n\nFrom now on, messages about your account go to the new address. If you didn't ask for this, reply to this email or write to the administrators of ${domain}.`,
  },
  it: {
    subject: "L'indirizzo email del tuo account è stato cambiato",
    body: (to, domain) =>
      `Un amministratore di ${domain} ha cambiato l'indirizzo email del tuo account in ${to}.\n\nDa ora i messaggi sul tuo account arrivano al nuovo indirizzo. Se non l'hai chiesto tu, rispondi a questa email o scrivi agli amministratori di ${domain}.`,
  },
  es: {
    subject: 'Se ha cambiado la dirección de correo de tu cuenta',
    body: (to, domain) =>
      `Un administrador de ${domain} ha cambiado la dirección de correo de tu cuenta a ${to}.\n\nA partir de ahora, los mensajes sobre tu cuenta llegarán a la nueva dirección. Si no lo has pedido tú, responde a este correo o escribe a los administradores de ${domain}.`,
  },
  fr: {
    subject: "L'adresse e-mail de ton compte a été modifiée",
    body: (to, domain) =>
      `Un administrateur de ${domain} a remplacé l'adresse e-mail de ton compte par ${to}.\n\nDésormais, les messages concernant ton compte arriveront à la nouvelle adresse. Si tu ne l'as pas demandé, réponds à cet e-mail ou écris aux administrateurs de ${domain}.`,
  },
  de: {
    subject: 'Die E-Mail-Adresse deines Kontos wurde geändert',
    body: (to, domain) =>
      `Ein Administrator von ${domain} hat die E-Mail-Adresse deines Kontos in ${to} geändert.\n\nAb jetzt gehen Nachrichten zu deinem Konto an die neue Adresse. Wenn du das nicht veranlasst hast, antworte auf diese E-Mail oder schreib den Administratoren von ${domain}.`,
  },
  zh: {
    subject: '你的账号邮箱地址已更改',
    body: (to, domain) =>
      `${domain} 的管理员已将你账号的邮箱地址更改为 ${to}。\n\n今后有关你账号的消息将发送到新地址。如果这不是你要求的，请回复这封邮件，或联系 ${domain} 的管理员。`,
  },
};

export interface AdminUserPatch {
  email?: string | undefined;
  displayName?: string | undefined;
  locale?: Locale | undefined;
}

/**
 * Corrects a person's data. A new address keeps the confirmation state (confirm or send the link
 * separately); the old address, when it was confirmed, is told about the change.
 */
export async function updateUserByAdmin(
  ctx: AdminContext,
  adminUserId: string,
  userId: string,
  patch: AdminUserPatch,
): Promise<void> {
  const { user, actor } = await localUser(ctx, userId);
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const userChanges: Partial<typeof users.$inferInsert> = {};

  const email = patch.email?.trim();
  if (email !== undefined && email.toLowerCase() !== user.email.toLowerCase()) {
    const [taken] = await ctx.db
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.email}) = lower(${email})`, ne(users.id, userId)));
    if (taken) throw new DomainError('email_taken', 'This email address is already used');
    userChanges.email = email;
    changes.email = { from: user.email, to: email };
  }
  if (patch.locale !== undefined && patch.locale !== user.locale) {
    if (!supportedLocales.includes(patch.locale))
      throw new DomainError('bad_request', 'Unsupported language');
    userChanges.locale = patch.locale;
    changes.locale = { from: user.locale, to: patch.locale };
  }
  if (Object.keys(userChanges).length > 0) {
    await ctx.db
      .update(users)
      .set({ ...userChanges, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }
  if (patch.displayName !== undefined && patch.displayName !== actor.displayName) {
    // Through the profile update, so followers on other servers see the new name.
    await updateProfile(ctx, actor.id, { displayName: patch.displayName });
    changes.displayName = { from: actor.displayName, to: patch.displayName };
  }
  if (Object.keys(changes).length === 0) return;
  await logAdminAction(ctx, adminUserId, 'update_user', { type: 'user', id: userId }, changes);

  if (changes.email && user.emailVerifiedAt && ctx.mailer) {
    const t = emailChangedTexts[(patch.locale ?? user.locale) as Locale] ?? emailChangedTexts.en;
    await ctx.mailer
      .send({
        to: user.email,
        subject: t.subject,
        text: t.body(changes.email.to as string, ctx.config.LOCAL_DOMAIN),
      })
      .catch(() => {
        // The change is done; a bounce from the old address must not undo it.
      });
  }
}

/** Sends the confirmation link again to an address not confirmed yet. */
export async function resendConfirmationByAdmin(
  ctx: AdminContext,
  adminUserId: string,
  userId: string,
): Promise<void> {
  const { user } = await localUser(ctx, userId);
  if (user.emailVerifiedAt)
    throw new DomainError('conflict', 'The email address is already confirmed');
  await sendEmailVerification({ ...ctx, mailer: requireMailer(ctx) }, userId);
  await logAdminAction(
    ctx,
    adminUserId,
    'resend_confirmation',
    { type: 'user', id: userId },
    {
      email: user.email,
    },
  );
}

/** Marks the address as confirmed without the emailed link. */
export async function confirmEmailByAdmin(
  ctx: CoreContext,
  adminUserId: string,
  userId: string,
): Promise<void> {
  const { user } = await localUser(ctx, userId);
  if (user.emailVerifiedAt)
    throw new DomainError('conflict', 'The email address is already confirmed');
  await ctx.db
    .update(users)
    .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, userId));
  await logAdminAction(
    ctx,
    adminUserId,
    'confirm_email',
    { type: 'user', id: userId },
    {
      email: user.email,
    },
  );
}

/** Emails the person a link to choose a new password; the administrator never sees it. */
export async function sendPasswordResetByAdmin(
  ctx: AdminContext,
  adminUserId: string,
  userId: string,
): Promise<void> {
  const { user } = await localUser(ctx, userId);
  if (user.disabledAt || user.deletionRequestedAt)
    throw new DomainError('conflict', 'This account is closed');
  await requestPasswordReset({ ...ctx, mailer: requireMailer(ctx) }, user.email);
  await logAdminAction(
    ctx,
    adminUserId,
    'send_password_reset',
    { type: 'user', id: userId },
    {
      email: user.email,
    },
  );
}

/**
 * Clears the second factors (authenticator app, recovery codes, passkeys) of someone who lost
 * their device: they sign in with the password again and can set them up anew.
 */
export async function resetTwoFactorByAdmin(
  ctx: CoreContext,
  adminUserId: string,
  userId: string,
): Promise<void> {
  const { user } = await localUser(ctx, userId);
  if (adminUserId === userId)
    throw new DomainError('bad_request', 'Use your own security settings for your account');
  const passkeys = await ctx.db
    .delete(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId))
    .returning({ id: webauthnCredentials.id });
  await ctx.db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  await ctx.db
    .update(users)
    .set({ totpSecret: null, totpEnabledAt: null, updatedAt: new Date() })
    .where(eq(users.id, userId));
  await logAdminAction(
    ctx,
    adminUserId,
    'reset_two_factor',
    { type: 'user', id: userId },
    {
      totp: user.totpEnabledAt !== null,
      passkeys: passkeys.length,
    },
  );
}

/**
 * Deletes an account whose address was never confirmed (nobody could ever sign in to it, so
 * nothing was federated). Confirmed accounts are closed by their owner or suspended instead.
 */
export async function deleteUnconfirmedUser(
  ctx: CoreContext,
  adminUserId: string,
  userId: string,
): Promise<void> {
  const { user, actor } = await localUser(ctx, userId);
  const deleted = await ctx.db
    .delete(actors)
    .where(
      and(
        eq(actors.id, actor.id),
        sql`exists (select 1 from ${users} where ${users.actorId} = ${actor.id}
          and ${users.emailVerifiedAt} is null and ${users.lastSignInAt} is null)`,
      ),
    )
    .returning({ id: actors.id });
  if (deleted.length === 0)
    throw new DomainError('conflict', 'Only accounts never confirmed can be deleted here');
  await logAdminAction(
    ctx,
    adminUserId,
    'delete_unconfirmed_user',
    { type: 'user', id: userId },
    {
      username: actor.username,
      email: user.email,
    },
  );
}

/** How many local accounts still wait for the confirmation of their address. */
export async function countUnconfirmedUsers(ctx: CoreContext): Promise<number> {
  const [row] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .innerJoin(actors, eq(actors.id, users.actorId))
    .where(and(isNull(users.emailVerifiedAt), eq(actors.isGroup, false)));
  return row?.count ?? 0;
}
