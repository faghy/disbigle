import type { CreatePostRequest, EditPostRequest, Poll, Status } from '@disbigle/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  prependToTimeline,
  removeStatusEverywhere,
  socialKeys,
  storeStatus,
  updateStatusEverywhere,
} from './cache.ts';
import { type StatusAction, social } from './social.ts';

export type ToggleKind = 'like' | 'reblog' | 'bookmark';

const toggles: Record<
  ToggleKind,
  { on: StatusAction; off: StatusAction; flag: 'liked' | 'reblogged' | 'bookmarked' }
> = {
  like: { on: 'like', off: 'unlike', flag: 'liked' },
  reblog: { on: 'reblog', off: 'unreblog', flag: 'reblogged' },
  bookmark: { on: 'bookmark', off: 'unbookmark', flag: 'bookmarked' },
};

const counters: Partial<Record<ToggleKind, 'likesCount' | 'reblogsCount'>> = {
  like: 'likesCount',
  reblog: 'reblogsCount',
};

/** The optimistic change for turning a toggle on or off. */
function applyToggle(status: Status, kind: ToggleKind, value: boolean): Status {
  const { flag } = toggles[kind];
  if (status[flag] === value) return status;
  const counter = counters[kind];
  const next = { ...status, [flag]: value };
  if (counter) next[counter] = Math.max(0, status[counter] + (value ? 1 : -1));
  return next;
}

/**
 * Like, reshare and bookmark toggles. The UI changes at once; the server's answer then
 * replaces the guess, and a failure puts things back.
 */
export function useToggleStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ status, kind, value }: { status: Status; kind: ToggleKind; value: boolean }) =>
      social.statusAction(status.id, value ? toggles[kind].on : toggles[kind].off),
    onMutate: async ({ status, kind, value }) => {
      await queryClient.cancelQueries({ queryKey: socialKeys.timelines });
      updateStatusEverywhere(queryClient, status.id, (s) => applyToggle(s, kind, value));
    },
    onError: (_error, { status, kind, value }) => {
      updateStatusEverywhere(queryClient, status.id, (s) => applyToggle(s, kind, !value));
    },
    onSuccess: (updated) => storeStatus(queryClient, updated),
  });
}

export function useDeleteStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (status: Status) => social.deleteStatus(status.id),
    onSuccess: (_result, status) => {
      removeStatusEverywhere(queryClient, status.id);
      if (status.inReplyToId) {
        updateStatusEverywhere(queryClient, status.inReplyToId, (parent) => ({
          ...parent,
          repliesCount: Math.max(0, parent.repliesCount - 1),
        }));
      }
    },
  });
}

/** Publishes a post and shows it right away where it belongs. */
export function useCreateStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePostRequest) => social.createStatus(body),
    onSuccess: (status) => {
      if (status.inReplyToId) {
        const parentId = status.inReplyToId;
        updateStatusEverywhere(queryClient, parentId, (parent) => ({
          ...parent,
          repliesCount: parent.repliesCount + 1,
        }));
        // Add the reply to every open thread that contains its parent.
        for (const [key, context] of queryClient.getQueriesData<{
          ancestors: Status[];
          descendants: Status[];
        }>({ queryKey: ['context'] })) {
          if (!context) continue;
          const threadRoot = key[1];
          const inThread =
            threadRoot === parentId ||
            context.ancestors.some((s) => s.id === parentId) ||
            context.descendants.some((s) => s.id === parentId);
          if (inThread && !context.descendants.some((s) => s.id === status.id)) {
            queryClient.setQueryData(key, {
              ...context,
              descendants: [...context.descendants, status],
            });
          }
        }
      }
      prependToTimeline(queryClient, socialKeys.timeline('home'), [status]);
      for (const aspectId of status.aspectIds ?? [])
        prependToTimeline(queryClient, socialKeys.timeline('aspect', aspectId), [status]);
    },
  });
}

export function useEditStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: EditPostRequest }) =>
      social.editStatus(id, body),
    onSuccess: (status) => storeStatus(queryClient, status),
  });
}

/** The poll as it looks right after the viewer's vote, before the server answers. */
export function applyVote(poll: Poll, choices: number[]): Poll {
  return {
    ...poll,
    voted: true,
    ownVotes: choices,
    votesCount: poll.votesCount + choices.length,
    votersCount: poll.votersCount + 1,
    options: poll.options.map((option, index) =>
      choices.includes(index) ? { ...option, votesCount: option.votesCount + 1 } : option,
    ),
  };
}

/** Votes in a poll: results show at once and are replaced by the server's counts. */
export function useVotePoll() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ poll, choices }: { status: Status; poll: Poll; choices: number[] }) =>
      social.vote(poll.id, choices),
    onMutate: ({ status, poll, choices }) => {
      updateStatusEverywhere(queryClient, status.id, (s) =>
        s.poll ? { ...s, poll: applyVote(s.poll, choices) } : s,
      );
      return { previous: poll };
    },
    onError: (_error, { status }, context) => {
      if (!context) return;
      updateStatusEverywhere(queryClient, status.id, (s) => ({ ...s, poll: context.previous }));
    },
    onSuccess: (updated) => storeStatus(queryClient, updated),
  });
}

/** Fetches the latest counts of a poll (for example after others voted). */
export function useRefreshStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (status: Status) => social.status(status.id),
    onSuccess: (updated) => storeStatus(queryClient, updated),
  });
}
