import { queryOptions, useQuery } from '@tanstack/react-query';
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
