import type { Notification, Status, StatusContext } from '@disbigle/shared';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';

export type TimelinePages = InfiniteData<Status[], string | undefined>;
export type NotificationPages = InfiniteData<Notification[], string | undefined>;

/** Every list of statuses is cached under a key starting with `timeline`. */
export const socialKeys = {
  timelines: ['timeline'] as const,
  timeline: (...parts: string[]) => ['timeline', ...parts] as const,
  status: (id: string) => ['status', id] as const,
  context: (id: string) => ['context', id] as const,
  aspects: ['aspects'] as const,
  aspectMembers: (id: string) => ['aspectMembers', id] as const,
  relationship: (accountId: string) => ['relationship', accountId] as const,
  followers: (accountId: string) => ['followers', accountId] as const,
  following: (accountId: string) => ['following', accountId] as const,
  notifications: ['notifications'] as const,
  pinned: (accountId: string) => ['pinned', accountId] as const,
  unreadCount: ['unreadCount'] as const,
};

/** The post a card shows: the reshared post for reshares, the status itself otherwise. */
export const shownStatus = (status: Status): Status => status.reblog ?? status;

type StatusMapper = (status: Status) => Status;

/** Applies `fn` to the status with this id, including when it appears inside a reshare. */
function mapOne(status: Status, statusId: string, fn: StatusMapper): Status {
  if (status.id === statusId) return fn(status);
  if (status.reblog?.id === statusId) return { ...status, reblog: fn(status.reblog) };
  return status;
}

/** Updates one post wherever it is cached: timelines, post pages, threads and notifications. */
export function updateStatusEverywhere(qc: QueryClient, statusId: string, fn: StatusMapper) {
  qc.setQueriesData<TimelinePages>({ queryKey: socialKeys.timelines }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) => page.map((status) => mapOne(status, statusId, fn))),
        }
      : data,
  );
  qc.setQueriesData<Status>({ queryKey: ['status'] }, (data) =>
    data ? mapOne(data, statusId, fn) : data,
  );
  qc.setQueriesData<StatusContext>({ queryKey: ['context'] }, (data) =>
    data
      ? {
          ancestors: data.ancestors.map((status) => mapOne(status, statusId, fn)),
          descendants: data.descendants.map((status) => mapOne(status, statusId, fn)),
        }
      : data,
  );
  qc.setQueriesData<NotificationPages>({ queryKey: socialKeys.notifications }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) =>
            page.map((n) => (n.status ? { ...n, status: mapOne(n.status, statusId, fn) } : n)),
          ),
        }
      : data,
  );
}

/** Copies the server's view of a post (counts and flags) into every cached copy. */
export function storeStatus(qc: QueryClient, status: Status) {
  updateStatusEverywhere(qc, status.id, (cached) => ({ ...cached, ...status }));
}

/** Removes a post, and reshares of it, from every cached list. */
export function removeStatusEverywhere(qc: QueryClient, statusId: string) {
  const keep = (status: Status) => status.id !== statusId && status.reblog?.id !== statusId;
  qc.setQueriesData<TimelinePages>({ queryKey: socialKeys.timelines }, (data) =>
    data ? { ...data, pages: data.pages.map((page) => page.filter(keep)) } : data,
  );
  qc.setQueriesData<StatusContext>({ queryKey: ['context'] }, (data) =>
    data
      ? { ancestors: data.ancestors.filter(keep), descendants: data.descendants.filter(keep) }
      : data,
  );
  qc.setQueriesData<NotificationPages>({ queryKey: socialKeys.notifications }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) =>
            page.filter((n) => !n.status || n.status.id !== statusId),
          ),
        }
      : data,
  );
  qc.removeQueries({ queryKey: socialKeys.status(statusId) });
}

/** Ids already present in a cached timeline, to skip duplicates from the stream. */
export function timelineIds(qc: QueryClient, key: readonly unknown[]): Set<string> {
  const data = qc.getQueryData<TimelinePages>(key);
  return new Set(data?.pages.flat().map((status) => status.id) ?? []);
}

/** Adds statuses (newest first) to the top of a cached timeline, skipping known ids. */
export function prependToTimeline(qc: QueryClient, key: readonly unknown[], statuses: Status[]) {
  qc.setQueryData<TimelinePages>(key, (data) => {
    if (!data) return data;
    const known = new Set(data.pages.flat().map((status) => status.id));
    const fresh = statuses.filter((status) => !known.has(status.id));
    if (fresh.length === 0) return data;
    const [first = [], ...rest] = data.pages;
    return { ...data, pages: [[...fresh, ...first], ...rest] };
  });
}
