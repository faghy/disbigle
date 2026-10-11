import { randomBytes } from 'node:crypto';
import { schema, uuidv7 } from '@disbigle/db';
import type { Poll, Status } from '@disbigle/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { type CoreContext, emit } from '../context.ts';
import { DomainError } from '../errors.ts';
import { getStatus, getVisiblePost } from './posts.ts';

const { polls, pollVotes, actors } = schema;
type PollRow = typeof polls.$inferSelect;

export function serializePoll(poll: PollRow, ownVotes: number[]): Poll {
  return {
    id: poll.id,
    expiresAt: poll.expiresAt?.toISOString() ?? null,
    expired: poll.expiresAt !== null && poll.expiresAt.getTime() <= Date.now(),
    multiple: poll.multiple,
    votesCount: poll.options.reduce((sum, o) => sum + o.votesCount, 0),
    votersCount: poll.votersCount,
    options: poll.options,
    voted: ownVotes.length > 0,
    ownVotes,
  };
}

/** Polls of the given posts, with the viewer's own votes. */
export async function loadPolls(ctx: CoreContext, viewerActorId: string | null, postIds: string[]) {
  if (postIds.length === 0) return new Map<string, Poll>();
  const rows = await ctx.db.select().from(polls).where(inArray(polls.postId, postIds));
  const votes =
    viewerActorId && rows.length > 0
      ? await ctx.db
          .select({ pollId: pollVotes.pollId, choice: pollVotes.choice })
          .from(pollVotes)
          .where(
            and(
              eq(pollVotes.actorId, viewerActorId),
              inArray(
                pollVotes.pollId,
                rows.map((p) => p.id),
              ),
            ),
          )
      : [];
  return new Map(
    rows.map((poll) => [
      poll.postId,
      serializePoll(
        poll,
        votes
          .filter((v) => v.pollId === poll.id)
          .map((v) => v.choice)
          .sort(),
      ),
    ]),
  );
}

/** Recomputes option and voter counts of a local poll from its votes. */
export async function recountPoll(ctx: CoreContext, pollId: string): Promise<void> {
  const [poll] = await ctx.db.select().from(polls).where(eq(polls.id, pollId));
  if (!poll) return;
  const counts = await ctx.db
    .select({ choice: pollVotes.choice, n: sql<number>`count(*)::int` })
    .from(pollVotes)
    .where(eq(pollVotes.pollId, pollId))
    .groupBy(pollVotes.choice);
  const [voters] = await ctx.db
    .select({ n: sql<number>`count(distinct ${pollVotes.actorId})::int` })
    .from(pollVotes)
    .where(eq(pollVotes.pollId, pollId));
  await ctx.db
    .update(polls)
    .set({
      options: poll.options.map((o, i) => ({
        ...o,
        votesCount: counts.find((c) => c.choice === i)?.n ?? 0,
      })),
      votersCount: voters?.n ?? 0,
    })
    .where(eq(polls.id, pollId));
}

/**
 * Votes in a poll. Works for local voters on any poll and for remote voters on local polls
 * (`options.apUris` carries the ids of incoming vote objects).
 */
export async function votePoll(
  ctx: CoreContext,
  actorId: string,
  pollId: string,
  choices: number[],
  options: { apUris?: string[]; diasporaGuid?: string } = {},
): Promise<Status> {
  const [poll] = await ctx.db.select().from(polls).where(eq(polls.id, pollId));
  if (!poll) throw new DomainError('not_found', 'Poll not found');
  const post = await getVisiblePost(ctx, actorId, poll.postId);
  if (poll.expiresAt && poll.expiresAt.getTime() <= Date.now()) {
    throw new DomainError('bad_request', 'This poll has ended');
  }
  const unique = [...new Set(choices)];
  if (unique.some((c) => c < 0 || c >= poll.options.length)) {
    throw new DomainError('validation_failed', 'Invalid choice', [
      { path: 'choices', message: 'Invalid choice' },
    ]);
  }
  if (!poll.multiple && unique.length !== 1) {
    throw new DomainError('validation_failed', 'Choose one option', [
      { path: 'choices', message: 'Choose one option' },
    ]);
  }
  const [already] = await ctx.db
    .select({ id: pollVotes.id })
    .from(pollVotes)
    .where(and(eq(pollVotes.pollId, poll.id), eq(pollVotes.actorId, actorId)))
    .limit(1);
  if (already) throw new DomainError('conflict', 'You already voted');

  const [voter] = await ctx.db.select().from(actors).where(eq(actors.id, actorId));
  const rows = unique.map((choice, i) => {
    const id = uuidv7();
    return {
      id,
      pollId: poll.id,
      actorId,
      choice,
      apUri: options.apUris?.[i] ?? (voter?.domain === null ? `${voter.apUri}#votes/${id}` : null),
      diasporaGuid:
        options.diasporaGuid ?? (voter?.domain === null ? randomBytes(16).toString('hex') : null),
    };
  });
  await ctx.db.insert(pollVotes).values(rows).onConflictDoNothing();
  if (post.local) await recountPoll(ctx, poll.id);
  else {
    // Remote poll: count our vote locally until the author's server sends updated totals.
    await ctx.db
      .update(polls)
      .set({
        options: poll.options.map((o, i) => ({
          ...o,
          votesCount: o.votesCount + (unique.includes(i) ? 1 : 0),
        })),
        votersCount: poll.votersCount + 1,
      })
      .where(eq(polls.id, poll.id));
  }
  await emit(ctx, {
    type: 'poll.voted',
    pollId: poll.id,
    postId: post.id,
    actorId,
    voteIds: rows.map((r) => r.id),
  });
  return getStatus(ctx, actorId, post.id);
}

/** Stores the latest totals of a remote poll (from an ActivityPub Update or a refetch). */
export async function updateRemotePollCounts(
  ctx: CoreContext,
  postId: string,
  counts: { options: { title: string; votesCount: number }[]; votersCount?: number },
): Promise<void> {
  const [poll] = await ctx.db.select().from(polls).where(eq(polls.postId, postId));
  if (!poll) return;
  await ctx.db
    .update(polls)
    .set({
      options: poll.options.map((o, i) => ({
        ...o,
        votesCount: counts.options[i]?.votesCount ?? o.votesCount,
      })),
      ...(counts.votersCount !== undefined ? { votersCount: counts.votersCount } : {}),
    })
    .where(eq(polls.id, poll.id));
}
