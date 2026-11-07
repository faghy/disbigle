import { schema } from '@disbigle/db';
import type { Account, Conversation, ConversationDetail, ConversationSeen } from '@disbigle/shared';
import { and, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import { serializeAccount } from '../accounts/serialize.ts';
import type { CoreContext } from '../context.ts';
import { DomainError } from '../errors.ts';
import { hydrateStatuses } from './statuses.ts';
import { visibleTo } from './visibility.ts';

const { posts, postAudiences, actors, conversationReads } = schema;

export type { Conversation, ConversationDetail };

/** The direct posts of these threads the viewer can read. */
const readableIn = (viewerActorId: string, rootIds: string[]) =>
  and(
    inArray(posts.threadRootId, rootIds),
    eq(posts.visibility, 'direct'),
    visibleTo(viewerActorId),
  );

/**
 * Everyone in each conversation (authors and recipients of the messages the viewer can read,
 * the viewer included), by thread root.
 */
async function participantsOf(
  ctx: CoreContext,
  viewerActorId: string,
  rootIds: string[],
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  if (rootIds.length === 0) return result;
  const threadPosts = await ctx.db
    .select({ id: posts.id, actorId: posts.actorId, threadRootId: posts.threadRootId })
    .from(posts)
    // Participants come from the messages the viewer can read, not from the whole thread.
    .where(readableIn(viewerActorId, rootIds));
  const audience =
    threadPosts.length > 0
      ? await ctx.db
          .select({ postId: postAudiences.postId, actorId: postAudiences.actorId })
          .from(postAudiences)
          .where(
            inArray(
              postAudiences.postId,
              threadPosts.map((p) => p.id),
            ),
          )
      : [];
  const audienceOf = new Map<string, string[]>();
  for (const a of audience)
    audienceOf.set(a.postId, [...(audienceOf.get(a.postId) ?? []), a.actorId]);
  for (const post of threadPosts) {
    const root = post.threadRootId ?? post.id;
    const set = result.get(root) ?? new Set<string>();
    set.add(post.actorId);
    for (const id of audienceOf.get(post.id) ?? []) set.add(id);
    result.set(root, set);
  }
  return result;
}

async function accountsById(ctx: CoreContext, ids: string[]): Promise<Map<string, Account>> {
  if (ids.length === 0) return new Map();
  const rows = await ctx.db.select().from(actors).where(inArray(actors.id, ids));
  return new Map(rows.map((a) => [a.id, serializeAccount(a)]));
}

/**
 * Private conversations of the viewer: threads of direct posts they wrote or received, newest
 * activity first. Paginate with `maxId` = the `lastStatus.id` of the last item.
 */
export async function listConversations(
  ctx: CoreContext,
  viewerActorId: string,
  options: { maxId?: string; limit?: number } = {},
): Promise<Conversation[]> {
  const limit = Math.min(options.limit ?? 20, 40);
  const latest = await ctx.db
    .select({ threadRootId: posts.threadRootId, lastId: sql<string>`max(${posts.id}::text)` })
    .from(posts)
    .where(
      and(
        eq(posts.visibility, 'direct'),
        visibleTo(viewerActorId),
        options.maxId ? lt(posts.id, options.maxId) : undefined,
      ),
    )
    .groupBy(posts.threadRootId)
    .orderBy(desc(sql`max(${posts.id}::text)`))
    .limit(limit);
  if (latest.length === 0) return [];

  const lastRows = await ctx.db
    .select()
    .from(posts)
    .where(
      inArray(
        posts.id,
        latest.map((l) => l.lastId),
      ),
    );
  const statuses = new Map(
    (await hydrateStatuses(ctx, viewerActorId, lastRows)).map((s) => [s.id, s]),
  );

  const rootIds = latest.map((l) => l.threadRootId).filter((id): id is string => !!id);
  const participants = await participantsOf(ctx, viewerActorId, rootIds);
  const accounts = await accountsById(ctx, [
    ...new Set([...participants.values()].flatMap((s) => [...s])),
  ]);
  const reads = new Map(
    (
      await ctx.db
        .select({ root: conversationReads.threadRootId, lastReadId: conversationReads.lastReadId })
        .from(conversationReads)
        .where(
          and(
            eq(conversationReads.actorId, viewerActorId),
            inArray(conversationReads.threadRootId, rootIds),
          ),
        )
    ).map((r) => [r.root, r.lastReadId]),
  );

  return latest.flatMap((l) => {
    const lastStatus = statuses.get(l.lastId);
    if (!lastStatus || !l.threadRootId) return [];
    const others = [...(participants.get(l.threadRootId) ?? [])]
      .filter((id) => id !== viewerActorId)
      .map((id) => accounts.get(id))
      .filter((a): a is Account => !!a);
    const lastRead = reads.get(l.threadRootId);
    const unread =
      lastStatus.account.id !== viewerActorId && (!lastRead || lastRead < lastStatus.id);
    return [{ id: l.threadRootId, accounts: others, lastStatus, unread }];
  });
}

/** How many conversations have messages the viewer has not seen yet. */
export async function countUnreadConversations(
  ctx: CoreContext,
  viewerActorId: string,
): Promise<number> {
  const [row] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(
      ctx.db
        .select({
          // Named here: the raw condition below refers to these columns.
          root: sql<string>`${posts.threadRootId}`.as('root'),
          lastOther:
            sql<string>`max(${posts.id}::text) filter (where ${posts.actorId} <> ${viewerActorId})`.as(
              'last_other',
            ),
          lastAny: sql<string>`max(${posts.id}::text)`.as('last_any'),
        })
        .from(posts)
        .where(and(eq(posts.visibility, 'direct'), visibleTo(viewerActorId)))
        .groupBy(posts.threadRootId)
        .as('c'),
    )
    .where(
      sql`c.last_other is not null and c.last_other = c.last_any and not exists (
        select 1 from ${conversationReads} r
        where r.actor_id = ${viewerActorId} and r.thread_root_id = c.root
          and r.last_read_id::text >= c.last_other
      )`,
    );
  return row?.count ?? 0;
}

/** The participants of a conversation the viewer is in, or a 404. */
export async function conversationParticipants(
  ctx: CoreContext,
  viewerActorId: string,
  rootId: string,
): Promise<string[]> {
  const participants = (await participantsOf(ctx, viewerActorId, [rootId])).get(rootId);
  if (!participants?.has(viewerActorId))
    throw new DomainError('not_found', 'Conversation not found');
  return [...participants];
}

/**
 * One conversation: the other participants, a page of messages (newest first; `maxId` for older
 * ones) and how far the others on this server have read it.
 */
export async function getConversation(
  ctx: CoreContext,
  viewerActorId: string,
  rootId: string,
  options: { maxId?: string | undefined; limit?: number | undefined } = {},
): Promise<ConversationDetail> {
  const participants = await conversationParticipants(ctx, viewerActorId, rootId);
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 60);
  const rows = await ctx.db
    .select()
    .from(posts)
    .where(
      and(
        readableIn(viewerActorId, [rootId]),
        options.maxId ? lt(posts.id, options.maxId) : undefined,
      ),
    )
    .orderBy(desc(posts.id))
    .limit(limit);
  const others = participants.filter((id) => id !== viewerActorId);
  const accounts = await accountsById(ctx, others);
  const seen: ConversationSeen[] =
    others.length > 0
      ? (
          await ctx.db
            .select({
              accountId: conversationReads.actorId,
              lastReadId: conversationReads.lastReadId,
            })
            .from(conversationReads)
            .where(
              and(
                eq(conversationReads.threadRootId, rootId),
                inArray(conversationReads.actorId, others),
                ne(conversationReads.actorId, viewerActorId),
              ),
            )
        ).map((r) => ({ accountId: r.accountId, lastReadId: r.lastReadId }))
      : [];
  return {
    id: rootId,
    accounts: others.map((id) => accounts.get(id)).filter((a): a is Account => !!a),
    messages: await hydrateStatuses(ctx, viewerActorId, rows),
    seen,
  };
}

/**
 * Marks a conversation read up to its newest message. Returns that message's id and the
 * participants, to tell the others; null when there was nothing new.
 */
export async function markConversationRead(
  ctx: CoreContext,
  viewerActorId: string,
  rootId: string,
): Promise<{ lastReadId: string; participants: string[] } | null> {
  const participants = await conversationParticipants(ctx, viewerActorId, rootId);
  const [newest] = await ctx.db
    .select({ id: posts.id })
    .from(posts)
    .where(readableIn(viewerActorId, [rootId]))
    .orderBy(desc(posts.id))
    .limit(1);
  if (!newest) return null;
  const [saved] = await ctx.db
    .insert(conversationReads)
    .values({ actorId: viewerActorId, threadRootId: rootId, lastReadId: newest.id })
    .onConflictDoUpdate({
      target: [conversationReads.actorId, conversationReads.threadRootId],
      set: { lastReadId: newest.id, updatedAt: new Date() },
      setWhere: sql`${conversationReads.lastReadId} < ${newest.id}`,
    })
    .returning({ lastReadId: conversationReads.lastReadId });
  return saved ? { lastReadId: saved.lastReadId, participants } : null;
}
