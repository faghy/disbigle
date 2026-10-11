import { randomBytes } from 'node:crypto';
import { schema, uuidv7 } from '@disbigle/db';
import { and, desc, eq } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';
import { DomainError } from '../errors.ts';

const { invites } = schema;

export interface Invite {
  id: string;
  code: string;
  url: string;
  maxUses: number | null;
  uses: number;
  expiresAt: string | null;
  createdAt: string;
}

function serialize(ctx: CoreContext, row: typeof invites.$inferSelect): Invite {
  return {
    id: row.id,
    code: row.code,
    url: `${ctx.config.PUBLIC_URL}/register?invite=${encodeURIComponent(row.code)}`,
    maxUses: row.maxUses,
    uses: row.uses,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Creates an invitation link. `maxUses` null = unlimited; `expiresIn` in seconds, null = never. */
export async function createInvite(
  ctx: CoreContext,
  userId: string,
  options: { maxUses?: number | null; expiresIn?: number | null } = {},
): Promise<Invite> {
  const mine = await ctx.db
    .select({ id: invites.id })
    .from(invites)
    .where(eq(invites.createdById, userId));
  if (mine.length >= 50)
    throw new DomainError('rate_limited', 'Too many invitations, delete some first');
  const [row] = await ctx.db
    .insert(invites)
    .values({
      id: uuidv7(),
      code: randomBytes(9).toString('base64url'),
      createdById: userId,
      maxUses: options.maxUses ?? null,
      expiresAt: options.expiresIn ? new Date(Date.now() + options.expiresIn * 1000) : null,
    })
    .returning();
  if (!row) throw new Error('Insert failed');
  return serialize(ctx, row);
}

export async function listInvites(ctx: CoreContext, userId: string): Promise<Invite[]> {
  const rows = await ctx.db
    .select()
    .from(invites)
    .where(eq(invites.createdById, userId))
    .orderBy(desc(invites.id));
  return rows.map((row) => serialize(ctx, row));
}

export async function deleteInvite(
  ctx: CoreContext,
  userId: string,
  inviteId: string,
): Promise<void> {
  const removed = await ctx.db
    .delete(invites)
    .where(and(eq(invites.id, inviteId), eq(invites.createdById, userId)))
    .returning({ id: invites.id });
  if (removed.length === 0) throw new DomainError('not_found', 'Invitation not found');
}
