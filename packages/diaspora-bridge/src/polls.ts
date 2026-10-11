// diaspora* polls: single choice, no expiry, one guid per answer.
import { createHash } from 'node:crypto';
import type { CoreContext } from '@disbigle/core';
import { schema } from '@disbigle/db';
import type { Poll } from '@disbigle/diaspora';
import { eq } from 'drizzle-orm';
import type { PostRow } from './actors.ts';
import { htmlToText } from './text.ts';

export type PollRow = typeof schema.polls.$inferSelect;
type OptionWithGuid = PollRow['options'][number] & { diasporaGuid?: string };

/**
 * Guid of an answer of a local poll, derived from the poll guid and the position, so it needs
 * no storage and stays stable.
 */
export function answerGuid(pollGuid: string, index: number): string {
  return createHash('sha256').update(`${pollGuid}:${index}`).digest('hex').slice(0, 32);
}

export async function pollOfPost(ctx: CoreContext, postId: string): Promise<PollRow | null> {
  const [row] = await ctx.db.select().from(schema.polls).where(eq(schema.polls.postId, postId));
  return row ?? null;
}

export async function pollByGuid(ctx: CoreContext, guid: string): Promise<PollRow | null> {
  const [row] = await ctx.db.select().from(schema.polls).where(eq(schema.polls.diasporaGuid, guid));
  return row ?? null;
}

/** Answer guids by option index: derived for local polls, as received for remote ones. */
export function answerGuids(poll: PollRow, local: boolean): Array<string | null> {
  return poll.options.map((option, index) =>
    local && poll.diasporaGuid
      ? answerGuid(poll.diasporaGuid, index)
      : ((option as OptionWithGuid).diasporaGuid ?? null),
  );
}

/** Keeps the answer guids of a remote poll in its options (`PollOption.diasporaGuid`). */
export async function storeAnswerGuids(
  ctx: CoreContext,
  pollId: string,
  guids: string[],
): Promise<void> {
  const [poll] = await ctx.db.select().from(schema.polls).where(eq(schema.polls.id, pollId));
  if (!poll) return;
  const options = poll.options.map((option, index) => ({
    ...option,
    ...(guids[index] ? { diasporaGuid: guids[index] } : {}),
  }));
  await ctx.db.update(schema.polls).set({ options }).where(eq(schema.polls.id, pollId));
}

/** The question shown by diaspora*: the first line of the post, at most 255 characters. */
export function pollQuestion(post: PostRow): string {
  const text = post.source ?? htmlToText(post.contentHtml);
  const line = text
    .split('\n')
    .map((l) => l.replace(/^[#>*\-\s]+/, '').trim())
    .find((l) => l.length > 0);
  return (line ?? 'Poll').slice(0, 255);
}

/**
 * The diaspora* Poll of a local post, or a markdown fallback for polls diaspora* cannot show
 * (multiple choice).
 */
export function diasporaPollOf(
  post: PostRow,
  poll: PollRow,
): { poll: Poll } | { fallbackText: string } {
  if (poll.multiple || !poll.diasporaGuid) {
    return { fallbackText: poll.options.map((o) => `- [ ] ${o.title}`).join('\n') };
  }
  const guid = poll.diasporaGuid;
  return {
    poll: {
      type: 'Poll',
      guid,
      question: pollQuestion(post),
      pollAnswers: poll.options.map((option, index) => ({
        type: 'PollAnswer',
        guid: answerGuid(guid, index),
        answer: option.title.slice(0, 255),
      })),
    },
  };
}
