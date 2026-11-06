import { schema, uuidv7 } from '@disbigle/db';
import type { HiddenTag } from '@disbigle/shared';
import { and, desc, eq, isNull, type SQL, sql } from 'drizzle-orm';
import { serializeAccount } from '../accounts/serialize.ts';
import type { CoreContext } from '../context.ts';
import { DomainError } from '../errors.ts';
import { getVisiblePost } from './posts.ts';
import { normalizeTag } from './tags.ts';

const { hiddenPosts, tagHides, tags, actors, posts, postTags } = schema;

const MAX_HIDDEN_TAGS = 200;

/** Hides someone else's post from the viewer's timelines (and the reshares of it). */
export async function hidePost(ctx: CoreContext, actorId: string, postId: string): Promise<void> {
  const post = await getVisiblePost(ctx, actorId, postId);
  if (post.actorId === actorId)
    throw new DomainError('bad_request', 'You cannot hide your own post');
  await ctx.db
    .insert(hiddenPosts)
    .values({ actorId, postId: post.reblogOfId ?? post.id })
    .onConflictDoNothing();
}

export async function unhidePost(ctx: CoreContext, actorId: string, postId: string): Promise<void> {
  const [post] = await ctx.db.select().from(posts).where(eq(posts.id, postId));
  await ctx.db
    .delete(hiddenPosts)
    .where(
      and(eq(hiddenPosts.actorId, actorId), eq(hiddenPosts.postId, post?.reblogOfId ?? postId)),
    );
}

/** The hashtags the user hid, everyone's first, then by name. */
export async function listHiddenTags(ctx: CoreContext, actorId: string): Promise<HiddenTag[]> {
  const rows = await ctx.db
    .select({ id: tagHides.id, name: tags.name, account: actors })
    .from(tagHides)
    .innerJoin(tags, eq(tags.id, tagHides.tagId))
    .leftJoin(actors, eq(actors.id, tagHides.targetActorId))
    .where(eq(tagHides.actorId, actorId))
    .orderBy(sql`${tagHides.targetActorId} is not null`, tags.name, desc(tagHides.id));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    account: r.account ? serializeAccount(r.account) : null,
  }));
}

/** Hides a hashtag from the user's timelines: everyone's posts, or only those of `accountId`. */
export async function hideTag(
  ctx: CoreContext,
  actorId: string,
  name: string,
  accountId: string | null = null,
): Promise<HiddenTag> {
  const tag = normalizeTag(name);
  if (accountId === actorId) throw new DomainError('bad_request', 'You cannot hide your own posts');
  if (accountId) {
    const [target] = await ctx.db
      .select({ id: actors.id })
      .from(actors)
      .where(eq(actors.id, accountId));
    if (!target) throw new DomainError('not_found', 'Account not found');
  }
  const existing = await ctx.db
    .select({ id: tagHides.id })
    .from(tagHides)
    .where(eq(tagHides.actorId, actorId));
  if (existing.length >= MAX_HIDDEN_TAGS)
    throw new DomainError('bad_request', 'Too many hidden hashtags');
  await ctx.db.insert(tags).values({ id: uuidv7(), name: tag }).onConflictDoNothing();
  const [row] = await ctx.db.select().from(tags).where(eq(tags.name, tag));
  if (!row) throw new Error('Tag insert failed');
  await ctx.db
    .insert(tagHides)
    .values({ id: uuidv7(), actorId, tagId: row.id, targetActorId: accountId })
    .onConflictDoNothing();
  const list = await listHiddenTags(ctx, actorId);
  const hidden = list.find((h) => h.name === tag && (h.account?.id ?? null) === accountId);
  if (!hidden) throw new Error('Tag hide failed');
  return hidden;
}

export async function unhideTag(ctx: CoreContext, actorId: string, id: string): Promise<void> {
  const removed = await ctx.db
    .delete(tagHides)
    .where(and(eq(tagHides.id, id), eq(tagHides.actorId, actorId)))
    .returning({ id: tagHides.id });
  if (removed.length === 0) throw new DomainError('not_found', 'Hidden hashtag not found');
}

/** Whether the viewer hid this hashtag from everyone. */
export async function tagHiddenFor(ctx: CoreContext, actorId: string, tagId: string) {
  const [row] = await ctx.db
    .select({ id: tagHides.id })
    .from(tagHides)
    .where(
      and(eq(tagHides.actorId, actorId), eq(tagHides.tagId, tagId), isNull(tagHides.targetActorId)),
    );
  return row?.id ?? null;
}

/**
 * SQL condition for timelines: the post (or the post a reshare points to) is not one the viewer
 * hid, and carries no hashtag they hid, from everyone or from its author. Hiding wins over
 * following a hashtag. The viewer's own posts are never hidden.
 */
export function notHiddenFor(viewerActorId: string | null, options: { tags?: boolean } = {}): SQL {
  if (!viewerActorId) return sql`true`;
  const shown = sql`coalesce(${posts.reblogOfId}, ${posts.id})`;
  const hiddenTags =
    options.tags === false
      ? sql`false`
      : sql`exists (
          select 1 from ${tagHides} th
          join ${postTags} pt on pt.tag_id = th.tag_id
          where th.actor_id = ${viewerActorId} and pt.post_id = ${shown}
            and (th.target_actor_id is null
              or th.target_actor_id = (select op.actor_id from ${posts} op where op.id = ${shown}))
        )`;
  return sql`(
    ${posts.actorId} = ${viewerActorId}
    or not (
      exists (select 1 from ${hiddenPosts} hp where hp.actor_id = ${viewerActorId} and hp.post_id = ${shown})
      or ${hiddenTags}
    )
  )`;
}
