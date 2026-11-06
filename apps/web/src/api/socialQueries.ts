import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { socialKeys } from './cache.ts';
import { useCurrentUser } from './queries.ts';
import { social } from './social.ts';

export const aspectsQueryOptions = queryOptions({
  queryKey: socialKeys.aspects,
  queryFn: social.aspects,
  staleTime: 60_000,
});

export const unreadCountQueryOptions = queryOptions({
  queryKey: socialKeys.unreadCount,
  queryFn: async () => (await social.unreadCount()).count,
  staleTime: 60_000,
});

export const statusQueryOptions = (id: string) =>
  queryOptions({ queryKey: socialKeys.status(id), queryFn: () => social.status(id) });

export const contextQueryOptions = (id: string) =>
  queryOptions({ queryKey: socialKeys.context(id), queryFn: () => social.context(id) });

export const relationshipQueryOptions = (accountId: string) =>
  queryOptions({
    queryKey: socialKeys.relationship(accountId),
    queryFn: async () => {
      const [relationship] = await social.relationships([accountId]);
      if (!relationship) throw new Error('Missing relationship');
      return relationship;
    },
  });

export const aspectMembersQueryOptions = (aspectId: string) =>
  queryOptions({
    queryKey: socialKeys.aspectMembers(aspectId),
    queryFn: () => social.aspectMembers(aspectId),
  });

/** The signed-in user's aspects; empty while signed out. */
export function useAspects() {
  const user = useCurrentUser();
  return useQuery({ ...aspectsQueryOptions, enabled: Boolean(user) });
}

export function useUnreadCount() {
  const user = useCurrentUser();
  return useQuery({ ...unreadCountQueryOptions, enabled: Boolean(user) });
}

const RELATIONSHIP_BATCH = 40;

/**
 * Loads relationships for many accounts in batches of 40 and stores each one under its own
 * key, so `FollowButton`s in a list need no request of their own.
 */
export function useRelationships(ids: string[]) {
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const wanted = [...new Set(ids)].filter((id) => id !== user?.account.id).sort();
  return useQuery({
    queryKey: ['relationships', ...wanted],
    enabled: Boolean(user) && wanted.length > 0,
    queryFn: async () => {
      const batches: string[][] = [];
      for (let i = 0; i < wanted.length; i += RELATIONSHIP_BATCH)
        batches.push(wanted.slice(i, i + RELATIONSHIP_BATCH));
      const results = (
        await Promise.all(batches.map((batch) => social.relationships(batch)))
      ).flat();
      for (const relationship of results)
        queryClient.setQueryData(socialKeys.relationship(relationship.id), relationship);
      return results;
    },
  });
}

export const tagKeys = {
  tag: (name: string) => ['tag', name] as const,
  followed: ['tags', 'followed'] as const,
  hidden: ['tags', 'hidden'] as const,
};

/** Follows or unfollows a hashtag, updating its info, the followed list and Home. */
export function useFollowTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, follow }: { name: string; follow: boolean }) =>
      social.followTag(name, follow),
    onSuccess: (info) => {
      queryClient.setQueryData(tagKeys.tag(info.name), info);
      queryClient.setQueryData<string[]>(tagKeys.followed, (list) => {
        const rest = (list ?? []).filter((n) => n !== info.name);
        return info.following ? [...rest, info.name].sort() : rest;
      });
      void queryClient.invalidateQueries({ queryKey: socialKeys.timeline('home') });
    },
  });
}

/** Hashtags the signed-in user follows (their public posts appear in Home). */
export function useFollowedTags() {
  const user = useCurrentUser();
  return useQuery({
    queryKey: tagKeys.followed,
    queryFn: social.followedTags,
    enabled: Boolean(user),
    staleTime: 60_000,
  });
}

/** Hashtags hidden from the signed-in user's timelines, from everyone or from one account. */
export function useHiddenTags() {
  const user = useCurrentUser();
  return useQuery({
    queryKey: tagKeys.hidden,
    queryFn: social.hiddenTags,
    enabled: Boolean(user),
    staleTime: 60_000,
  });
}

/**
 * After hiding or showing again: the lists and the hashtag pages catch up, and the timelines too
 * unless the change was made from a post, which then stays in place to offer "Undo".
 */
function afterHiding(queryClient: ReturnType<typeof useQueryClient>, timelines: boolean) {
  void queryClient.invalidateQueries({ queryKey: ['tags'] });
  void queryClient.invalidateQueries({ queryKey: ['tag'] });
  if (timelines) void queryClient.invalidateQueries({ queryKey: socialKeys.timelines });
}

export function useHideTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, accountId = null }: HideTagInput) => social.hideTag(name, accountId),
    onSuccess: (_, input) => afterHiding(queryClient, !input.fromPost),
  });
}

interface HideTagInput {
  name: string;
  accountId?: string | null;
  fromPost?: boolean;
}

export function useUnhideTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; fromPost?: boolean }) => social.unhideTag(id),
    onSuccess: (_, input) => afterHiding(queryClient, !input.fromPost),
  });
}

/** Hides one post from your timelines; it stays on screen as a note with "Undo" until reloaded. */
export function useHidePost() {
  return useMutation({
    mutationFn: ({ statusId, hide }: { statusId: string; hide: boolean }) =>
      social.hidePost(statusId, hide),
  });
}
