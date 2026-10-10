import { randomBytes } from 'node:crypto';
import { schema, uuidv7 } from '@disbigle/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';
import { verifyPassword } from '../crypto/passwords.ts';
import { sha256 } from '../crypto/tokens.ts';
import { DomainError } from '../errors.ts';

const CODE_COUNT = 10;

/** Codes look like `a1b2c-d3e4f`; they are compared without the dash and case-insensitively. */
function newCode(): string {
  const hex = randomBytes(5).toString('hex');
  return `${hex.slice(0, 5)}-${hex.slice(5)}`;
}

const normalize = (code: string) => code.replace(/[\s-]/g, '').toLowerCase();

/** Replaces all recovery codes of a user and returns the new plaintext codes (shown once). */
export async function generateRecoveryCodes(ctx: CoreContext, userId: string): Promise<string[]> {
  const codes = Array.from({ length: CODE_COUNT }, newCode);
  await ctx.db.transaction(async (tx) => {
    await tx.delete(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, userId));
    await tx
      .insert(schema.recoveryCodes)
      .values(codes.map((code) => ({ id: uuidv7(), userId, codeHash: sha256(normalize(code)) })));
  });
  return codes;
}

export async function regenerateRecoveryCodes(ctx: CoreContext, userId: string, password: string) {
  const [user] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) throw new DomainError('not_found', 'User not found');
  if (!user.totpEnabledAt)
    throw new DomainError('bad_request', 'Two-factor authentication is not enabled');
  if (!(await verifyPassword(user.passwordHash, password))) {
    throw new DomainError('invalid_credentials', 'Wrong password');
  }
  return generateRecoveryCodes(ctx, userId);
}

/** Marks a matching unused code as used. Returns false when no such code exists. */
export async function consumeRecoveryCode(
  ctx: CoreContext,
  userId: string,
  code: string,
): Promise<boolean> {
  const { recoveryCodes } = schema;
  const [used] = await ctx.db
    .update(recoveryCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(recoveryCodes.userId, userId),
        eq(recoveryCodes.codeHash, sha256(normalize(code))),
        isNull(recoveryCodes.usedAt),
      ),
    )
    .returning({ id: recoveryCodes.id });
  return Boolean(used);
}
