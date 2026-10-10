import { schema } from '@disbigle/db';
import {
  type ChangePasswordRequest,
  type CurrentUser,
  changePasswordRequestSchema,
  type UpdateProfileRequest,
  type UpdateSettingsRequest,
  updateProfileRequestSchema,
  updateSettingsRequestSchema,
} from '@disbigle/shared';
import { eq, sql } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';
import { hashPassword, verifyPassword } from '../crypto/passwords.ts';
import { DomainError } from '../errors.ts';
import { serializeAccount } from './serialize.ts';
import { revokeOtherSessions } from './sessions.ts';

export async function getCurrentUser(ctx: CoreContext, userId: string): Promise<CurrentUser> {
  const [row] = await ctx.db
    .select({
      user: schema.users,
      actor: schema.actors,
      passkeyCount: sql<number>`(select count(*)::int from ${schema.webauthnCredentials} where ${schema.webauthnCredentials.userId} = ${schema.users.id})`,
    })
    .from(schema.users)
    .innerJoin(schema.actors, eq(schema.actors.id, schema.users.actorId))
    .where(eq(schema.users.id, userId));
  if (!row) throw new DomainError('not_found', 'User not found');
  return {
    account: serializeAccount(row.actor),
    email: row.user.email,
    role: row.user.role,
    locale: row.user.locale,
    totpEnabled: row.user.totpEnabledAt !== null,
    passkeyCount: row.passkeyCount,
  };
}

export async function updateProfile(
  ctx: CoreContext,
  actorId: string,
  request: UpdateProfileRequest,
) {
  const input = updateProfileRequestSchema.parse(request);
  const changes: Partial<typeof schema.actors.$inferInsert> = { updatedAt: new Date() };
  if (input.displayName !== undefined) changes.displayName = input.displayName;
  if (input.note !== undefined) changes.summary = input.note;
  if (input.fields !== undefined) changes.fields = input.fields.filter((f) => f.name || f.value);
  if (input.locked !== undefined) changes.locked = input.locked;
  if (input.discoverable !== undefined) changes.discoverable = input.discoverable;
  if (input.bot !== undefined) changes.bot = input.bot;

  const [actor] = await ctx.db
    .update(schema.actors)
    .set(changes)
    .where(eq(schema.actors.id, actorId))
    .returning();
  if (!actor) throw new DomainError('not_found', 'Account not found');
  return serializeAccount(actor);
}

export async function updateSettings(
  ctx: CoreContext,
  userId: string,
  request: UpdateSettingsRequest,
) {
  const input = updateSettingsRequestSchema.parse(request);
  if (input.locale) {
    await ctx.db
      .update(schema.users)
      .set({ locale: input.locale, updatedAt: new Date() })
      .where(eq(schema.users.id, userId));
  }
}

/** Changes the password and signs out every other session. */
export async function changePassword(
  ctx: CoreContext,
  userId: string,
  request: ChangePasswordRequest,
  currentSessionId?: string,
): Promise<void> {
  const input = changePasswordRequestSchema.parse(request);
  const [user] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) throw new DomainError('not_found', 'User not found');
  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw new DomainError('wrong_password', 'Wrong password');
  }
  await ctx.db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(input.newPassword), updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
  await revokeOtherSessions(ctx, userId, currentSessionId);
}

export async function findLocalActorByUsername(ctx: CoreContext, username: string) {
  const [actor] = await ctx.db
    .select()
    .from(schema.actors)
    .where(
      sql`lower(${schema.actors.username}) = lower(${username}) and ${schema.actors.domain} is null`,
    );
  return actor ?? null;
}
