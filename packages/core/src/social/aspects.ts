import { schema, uuidv7 } from '@disbigle/db';
import type { Aspect } from '@disbigle/shared';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';
import { DomainError } from '../errors.ts';

const { aspects, aspectMemberships, actors } = schema;

/** Aspects created for every new account, as in diaspora. */
export const defaultAspectNames: Record<string, string[]> = {
  en: ['Family', 'Friends', 'Work', 'Acquaintances'],
  it: ['Famiglia', 'Amici', 'Lavoro', 'Conoscenti'],
  es: ['Familia', 'Amigos', 'Trabajo', 'Conocidos'],
};

export async function createDefaultAspects(ctx: CoreContext, ownerActorId: string, locale: string) {
  const names = defaultAspectNames[locale] ?? defaultAspectNames.en ?? [];
  await ctx.db
    .insert(aspects)
    .values(names.map((name, position) => ({ id: uuidv7(), ownerActorId, name, position })));
}

export async function listAspects(ctx: CoreContext, ownerActorId: string): Promise<Aspect[]> {
  return ctx.db
    .select({
      id: aspects.id,
      name: aspects.name,
      memberCount: sql<number>`(select count(*)::int from ${aspectMemberships} where ${aspectMemberships.aspectId} = ${aspects.id})`,
    })
    .from(aspects)
    .where(eq(aspects.ownerActorId, ownerActorId))
    .orderBy(aspects.position, aspects.createdAt);
}

async function getOwnedAspect(ctx: CoreContext, ownerActorId: string, aspectId: string) {
  const [aspect] = await ctx.db
    .select()
    .from(aspects)
    .where(and(eq(aspects.id, aspectId), eq(aspects.ownerActorId, ownerActorId)));
  if (!aspect) throw new DomainError('not_found', 'Aspect not found');
  return aspect;
}

function mapNameConflict(error: unknown): unknown {
  const cause = (error as { cause?: { code?: string } })?.cause ?? (error as { code?: string });
  return cause?.code === '23505'
    ? new DomainError('conflict', 'An aspect with this name already exists')
    : error;
}

export async function createAspect(
  ctx: CoreContext,
  ownerActorId: string,
  name: string,
): Promise<Aspect> {
  const [{ max } = { max: -1 }] = await ctx.db
    .select({ max: sql<number>`coalesce(max(${aspects.position}), -1)::int` })
    .from(aspects)
    .where(eq(aspects.ownerActorId, ownerActorId));
  try {
    const [aspect] = await ctx.db
      .insert(aspects)
      .values({ id: uuidv7(), ownerActorId, name: name.trim(), position: max + 1 })
      .returning();
    if (!aspect) throw new Error('Insert failed');
    return { id: aspect.id, name: aspect.name, memberCount: 0 };
  } catch (error) {
    throw mapNameConflict(error);
  }
}

export async function renameAspect(
  ctx: CoreContext,
  ownerActorId: string,
  aspectId: string,
  name: string,
) {
  await getOwnedAspect(ctx, ownerActorId, aspectId);
  try {
    await ctx.db.update(aspects).set({ name: name.trim() }).where(eq(aspects.id, aspectId));
  } catch (error) {
    throw mapNameConflict(error);
  }
  const all = await listAspects(ctx, ownerActorId);
  const updated = all.find((a) => a.id === aspectId);
  if (!updated) throw new DomainError('not_found', 'Aspect not found');
  return updated;
}

/** Deleting an aspect keeps posts already shared with it visible to their recipients. */
export async function deleteAspect(ctx: CoreContext, ownerActorId: string, aspectId: string) {
  await getOwnedAspect(ctx, ownerActorId, aspectId);
  await ctx.db.delete(aspects).where(eq(aspects.id, aspectId));
}

export async function listAspectMembers(ctx: CoreContext, ownerActorId: string, aspectId: string) {
  await getOwnedAspect(ctx, ownerActorId, aspectId);
  return ctx.db
    .select({ actor: actors })
    .from(aspectMemberships)
    .innerJoin(actors, eq(actors.id, aspectMemberships.actorId))
    .where(eq(aspectMemberships.aspectId, aspectId))
    .orderBy(aspectMemberships.createdAt)
    .then((rows) => rows.map((r) => r.actor));
}

/** Sets exactly which of the owner's aspects an account belongs to. */
export async function setAspectMemberships(
  ctx: CoreContext,
  ownerActorId: string,
  memberActorId: string,
  aspectIds: string[],
): Promise<string[]> {
  if (ownerActorId === memberActorId)
    throw new DomainError('bad_request', 'You cannot add yourself');
  const [member] = await ctx.db
    .select({ id: actors.id })
    .from(actors)
    .where(eq(actors.id, memberActorId));
  if (!member) throw new DomainError('not_found', 'Account not found');

  const owned = await ctx.db
    .select({ id: aspects.id })
    .from(aspects)
    .where(eq(aspects.ownerActorId, ownerActorId));
  const ownedIds = new Set(owned.map((a) => a.id));
  const wanted = [...new Set(aspectIds)];
  if (wanted.some((id) => !ownedIds.has(id)))
    throw new DomainError('not_found', 'Aspect not found');

  await ctx.db.transaction(async (tx) => {
    const ownedList = [...ownedIds];
    if (ownedList.length > 0) {
      await tx
        .delete(aspectMemberships)
        .where(
          and(
            eq(aspectMemberships.actorId, memberActorId),
            inArray(aspectMemberships.aspectId, ownedList),
            wanted.length > 0 ? notInArray(aspectMemberships.aspectId, wanted) : sql`true`,
          ),
        );
    }
    if (wanted.length > 0) {
      await tx
        .insert(aspectMemberships)
        .values(wanted.map((aspectId) => ({ aspectId, actorId: memberActorId })))
        .onConflictDoNothing();
    }
  });
  return wanted;
}
