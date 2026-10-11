import type { Poll, Status } from '@disbigle/shared';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client.ts';
import { errorMessage } from '../api/errors.ts';
import { useRefreshStatus, useVotePoll } from '../api/mutations.ts';
import { useCurrentUser } from '../api/queries.ts';
import { fullDateTime, relativeTime } from '../lib/time.ts';
import { CheckIcon } from './icons.tsx';
import { Alert, Button, cx } from './ui.tsx';

/** Closed by the server, or past its end date on this device's clock. */
export function isPollClosed(poll: Poll, now = Date.now()): boolean {
  return poll.expired || (poll.expiresAt !== null && new Date(poll.expiresAt).getTime() <= now);
}

/**
 * Share of each option. Single choice: of all votes. Multiple choice: of the people who
 * voted, so shares can add up to more than 100%.
 */
export function optionShare(poll: Poll, votes: number): number {
  const total = poll.multiple ? poll.votersCount : poll.votesCount;
  return total > 0 ? Math.round((votes / total) * 100) : 0;
}

export function PollView({ status, poll }: { status: Status; poll: Poll }) {
  const { t, i18n } = useTranslation();
  const user = useCurrentUser();
  const vote = useVotePoll();
  const refresh = useRefreshStatus();
  const name = useId();
  const [choices, setChoices] = useState<number[]>([]);
  const [peeking, setPeeking] = useState(false);

  const closed = isPollClosed(poll);
  const canVote = Boolean(user) && !poll.voted && !closed;
  const showResults = !canVote || peeking;
  const leader = Math.max(...poll.options.map((option) => option.votesCount));

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (choices.length === 0 || vote.isPending) return;
    vote.mutate(
      { status, poll, choices: [...choices].sort((a, b) => a - b) },
      {
        onError: (error) => {
          // Already voted elsewhere, or the poll just closed: show the current state.
          if (error instanceof ApiError && (error.status === 409 || error.status === 400))
            refresh.mutate(status);
        },
      },
    );
  };

  const toggle = (index: number, checked: boolean) =>
    setChoices((list) =>
      poll.multiple ? (checked ? [...list, index] : list.filter((i) => i !== index)) : [index],
    );

  const voteError =
    vote.error instanceof ApiError && vote.error.status === 409
      ? t('poll.errors.alreadyVoted')
      : vote.error instanceof ApiError && vote.error.status === 400
        ? t('poll.errors.closed')
        : vote.error
          ? errorMessage(vote.error)
          : null;

  const footer = (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-fg-muted">
      <span>{t('poll.voters', { count: poll.votersCount })}</span>
      <span aria-hidden="true">·</span>
      {poll.expiresAt ? (
        <time dateTime={poll.expiresAt} title={fullDateTime(poll.expiresAt, i18n.language)}>
          {closed
            ? t('poll.closed')
            : t('poll.endsIn', { time: relativeTime(poll.expiresAt, i18n.language) })}
        </time>
      ) : (
        <span>{closed ? t('poll.closed') : t('poll.open')}</span>
      )}
      {showResults && (
        <>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() => refresh.mutate(status)}
            disabled={refresh.isPending}
            className="rounded font-medium text-accent hover:underline focus-ring disabled:opacity-50"
          >
            {refresh.isPending ? t('poll.refreshing') : t('poll.refresh')}
          </button>
        </>
      )}
      {canVote && (
        <>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() => setPeeking((value) => !value)}
            className="rounded font-medium text-accent hover:underline focus-ring"
          >
            {peeking ? t('poll.backToVoting') : t('poll.seeResults')}
          </button>
        </>
      )}
    </p>
  );

  if (showResults) {
    return (
      <div className="mt-3 space-y-2">
        <ul aria-label={t('poll.results')} className="space-y-1.5">
          {poll.options.map((option, index) => {
            const share = optionShare(poll, option.votesCount);
            const mine = poll.ownVotes.includes(index);
            const winning = closed && option.votesCount > 0 && option.votesCount === leader;
            return (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: options are addressed by position
                key={index}
                className="relative overflow-hidden rounded-lg border border-border"
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    'absolute inset-y-0 left-0 transition-[width]',
                    winning ? 'bg-accent/25' : 'bg-surface-muted',
                  )}
                  style={{ width: `${share}%` }}
                />
                <span className="relative flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="w-11 shrink-0 font-semibold tabular-nums">{share}%</span>
                  <span className={cx('min-w-0 flex-1 break-words', winning && 'font-semibold')}>
                    {option.title}
                  </span>
                  {mine && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-accent">
                      <CheckIcon size={14} />
                      {t('poll.yourChoice')}
                    </span>
                  )}
                  <span className="sr-only">
                    {t('poll.optionVotes', { count: option.votesCount })}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        {footer}
        <Alert>{voteError ?? (refresh.error ? errorMessage(refresh.error) : null)}</Alert>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-2">
      <fieldset>
        <legend className="sr-only">
          {poll.multiple ? t('poll.legendMultiple') : t('poll.legendSingle')}
        </legend>
        <div className="space-y-1.5">
          {poll.options.map((option, index) => (
            <label
              // biome-ignore lint/suspicious/noArrayIndexKey: options are addressed by position
              key={index}
              className={cx(
                'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm',
                choices.includes(index)
                  ? 'border-accent/60 bg-accent-soft/50'
                  : 'border-border hover:bg-surface-muted',
              )}
            >
              <input
                type={poll.multiple ? 'checkbox' : 'radio'}
                name={name}
                checked={choices.includes(index)}
                onChange={(event) => toggle(index, event.target.checked)}
                className="size-4 shrink-0 accent-accent"
              />
              <span className="min-w-0 break-words">{option.title}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {poll.multiple && <p className="text-xs text-fg-muted">{t('poll.multipleHint')}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="secondary"
          className="min-h-9 px-4 py-1"
          disabled={choices.length === 0}
          loading={vote.isPending}
        >
          {t('poll.vote')}
        </Button>
        {footer}
      </div>
      <Alert>{voteError}</Alert>
    </form>
  );
}
