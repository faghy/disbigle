import { type CurrentUser, type InstanceInfo, MAX_POST_LENGTH } from '@disbigle/shared';
import { QueryClient, queryOptions, useQuery } from '@tanstack/react-query';
import { ApiError } from './client.ts';
import { endpoints } from './endpoints.ts';

export const queryKeys = {
  me: ['me'] as const,
  instance: ['instance'] as const,
  passkeys: ['passkeys'] as const,
  account: (username: string) => ['account', username.toLowerCase()] as const,
};

/** The signed-in user, or `null` when signed out (the API answers 401). */
export const meQueryOptions = queryOptions({
  queryKey: queryKeys.me,
  queryFn: async (): Promise<CurrentUser | null> => {
    try {
      return await endpoints.me();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  staleTime: 60_000,
});

export const instanceQueryOptions = queryOptions({
  queryKey: queryKeys.instance,
  queryFn: endpoints.instance,
  staleTime: 10 * 60_000,
});

export const passkeysQueryOptions = queryOptions({
  queryKey: queryKeys.passkeys,
  queryFn: endpoints.passkeys,
});

export const accountQueryOptions = (username: string) =>
  queryOptions({
    queryKey: queryKeys.account(username),
    queryFn: () => endpoints.lookupAccount(username),
  });

export function useMe() {
  return useQuery(meQueryOptions);
}

/** The signed-in user, or `null` while loading or when signed out. */
export function useCurrentUser(): CurrentUser | null {
  return useQuery(meQueryOptions).data ?? null;
}

export function useInstance() {
  return useQuery(instanceQueryOptions);
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status > 0 && error.status < 500) return false;
          return failureCount < 2;
        },
      },
    },
  });
}

/** Drops cached data that belongs to the previous user (after sign-in or sign-out). */
export function clearUserData(queryClient: QueryClient) {
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] !== 'me' && query.queryKey[0] !== 'instance',
  });
}

/** Used until `/instance` answers; the server's values replace them. */
export const DEFAULT_LIMITS: InstanceInfo['limits'] = {
  maxPostLength: MAX_POST_LENGTH,
  maxMediaAttachments: 4,
  maxImageBytes: 8 * 1024 * 1024,
  maxVideoBytes: 20 * 1024 * 1024,
  acceptedMediaTypes: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'video/mp4',
    'video/webm',
    'audio/mpeg',
    'audio/ogg',
    'audio/mp4',
  ],
};

/** Post and upload limits announced by the server. */
export function useLimits(): InstanceInfo['limits'] {
  return useInstance().data?.limits ?? DEFAULT_LIMITS;
}
