import { schema } from '@disbigle/db';
import type { Locale } from '@disbigle/shared';
import { and, eq, isNull, ne, notExists, sql } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';
import { DomainError } from '../errors.ts';
import { logAdminAction } from '../moderation.ts';
import { getInstanceSettings } from '../settings.ts';
import { createPost } from '../social/posts.ts';
import { follow } from '../social/relationships.ts';
import { findLocalActorByUsername } from './profile.ts';

/**
 * Welcomes a newly active account, as diaspora*'s "autofollow on join" and welcome message:
 * the newcomer follows the welcome account; unless the admin turned it off, the welcome account
 * follows back and puts them in the chosen aspect (an official news account only gets
 * followed); then it sends them the welcome message privately, in their language when there is
 * one.
 * Nothing happens unless an admin has chosen a welcome account. Never throws: a failed
 * welcome must not block a sign-up.
 */
export async function welcomeNewAccount(ctx: CoreContext, actorId: string): Promise<void> {
  try {
    const settings = await getInstanceSettings(ctx);
    if (!settings.welcomeAccount) return;
    const host = await findLocalActorByUsername(ctx, settings.welcomeAccount);
    if (!host || host.id === actorId || host.suspendedAt) return;
    const newcomer = await findLocalActorById(ctx, actorId);
    if (!newcomer) return;

    await follow(ctx, actorId, host.id).catch(() => undefined);
    if (settings.welcomeFollowBack) await follow(ctx, host.id, actorId).catch(() => undefined);

    const aspectName = settings.welcomeFollowBack
      ? settings.welcomeAspect.trim().toLowerCase()
      : '';
    if (aspectName) {
      const aspects = await ctx.db
        .select({ id: schema.aspects.id, name: schema.aspects.name })
        .from(schema.aspects)
        .where(eq(schema.aspects.ownerActorId, host.id));
      const aspect = aspects.find((a) => a.name.trim().toLowerCase() === aspectName);
      if (aspect) {
        await ctx.db
          .insert(schema.aspectMemberships)
          .values({ aspectId: aspect.id, actorId })
          .onConflictDoNothing();
      }
    }

    const message = (
      settings.welcomeMessages[newcomer.locale as Locale] || settings.welcomeMessage
    ).trim();
    if (message) {
      await createPost(ctx, host.id, {
        content: `@${newcomer.username}\n\n${message}`,
        visibility: 'direct',
      });
    }
  } catch {
    // The account works anyway; the admin can still greet them by hand.
  }
}

async function findLocalActorById(ctx: CoreContext, actorId: string) {
  const [actor] = await ctx.db
    .select({
      id: schema.actors.id,
      username: schema.actors.username,
      locale: sql<string>`coalesce(${schema.users.locale}, 'en')`,
    })
    .from(schema.actors)
    .leftJoin(schema.users, eq(schema.users.actorId, schema.actors.id))
    .where(eq(schema.actors.id, actorId));
  return actor ?? null;
}

/**
 * Makes every active local account follow the welcome account, for people who joined before it
 * was chosen. One way only: the welcome account does not follow back. People can unfollow it
 * as any other account; those who already follow it are left alone. Returns how many now do.
 */
export async function followWelcomeAccountForAll(
  ctx: CoreContext,
  adminUserId: string,
): Promise<number> {
  const settings = await getInstanceSettings(ctx);
  const host = settings.welcomeAccount
    ? await findLocalActorByUsername(ctx, settings.welcomeAccount)
    : null;
  if (!host || host.suspendedAt)
    throw new DomainError('bad_request', 'Choose a welcome account first');
  const { users, actors, follows } = schema;
  const people = await ctx.db
    .select({ actorId: actors.id })
    .from(users)
    .innerJoin(actors, eq(actors.id, users.actorId))
    .where(
      and(
        ne(actors.id, host.id),
        eq(actors.isGroup, false),
        isNull(actors.suspendedAt),
        isNull(users.disabledAt),
        isNull(users.deletionRequestedAt),
        eq(users.approved, true),
        notExists(
          ctx.db
            .select({ one: sql`1` })
            .from(follows)
            .where(and(eq(follows.actorId, actors.id), eq(follows.targetActorId, host.id))),
        ),
      ),
    );
  let added = 0;
  for (const person of people) {
    const done = await follow(ctx, person.actorId, host.id)
      .then(() => true)
      .catch(() => false);
    if (done) added += 1;
  }
  await logAdminAction(
    ctx,
    adminUserId,
    'follow_welcome_account',
    { type: 'actor', id: host.id },
    {
      added,
    },
  );
  return added;
}
