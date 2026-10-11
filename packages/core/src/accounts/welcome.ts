import { schema } from '@disbigle/db';
import { eq } from 'drizzle-orm';
import type { CoreContext } from '../context.ts';
import { getInstanceSettings } from '../settings.ts';
import { createPost } from '../social/posts.ts';
import { follow } from '../social/relationships.ts';
import { findLocalActorByUsername } from './profile.ts';

/**
 * Welcomes a newly active account, as diaspora*'s "autofollow on join" and welcome message:
 * the newcomer follows the welcome account (usually the admin), the welcome account follows
 * back and puts them in the chosen aspect, then sends them the welcome message privately.
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
    await follow(ctx, host.id, actorId).catch(() => undefined);

    const aspectName = settings.welcomeAspect.trim().toLowerCase();
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

    const message = settings.welcomeMessage.trim();
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
    .select({ id: schema.actors.id, username: schema.actors.username })
    .from(schema.actors)
    .where(eq(schema.actors.id, actorId));
  return actor ?? null;
}
