import type { CreatePostRequest, ScheduledPost } from '@disbigle/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from './queries.ts';
import { social } from './social.ts';

/** Your scheduled posts (issue #28), the next first. */
export const scheduledKey = ['scheduled'] as const;

export function useScheduledPosts() {
  const user = useCurrentUser();
  return useQuery({
    queryKey: scheduledKey,
    queryFn: social.scheduledPosts,
    enabled: Boolean(user),
    staleTime: 60_000,
  });
}

const byTime = (posts: ScheduledPost[]) =>
  [...posts].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

export function useSchedulePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePostRequest & { scheduledAt: string }) => social.schedulePost(body),
    onSuccess: (post) => {
      queryClient.setQueryData<ScheduledPost[]>(scheduledKey, (posts) =>
        posts ? byTime([...posts, post]) : posts,
      );
    },
  });
}

export function useReschedulePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, scheduledAt }: { id: string; scheduledAt: string }) =>
      social.reschedulePost(id, scheduledAt),
    onSuccess: (post) => {
      queryClient.setQueryData<ScheduledPost[]>(scheduledKey, (posts) =>
        posts ? byTime(posts.map((p) => (p.id === post.id ? post : p))) : posts,
      );
    },
  });
}

export function useDeleteScheduledPost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => social.deleteScheduledPost(id),
    onSuccess: (_result, id) => {
      queryClient.setQueryData<ScheduledPost[]>(scheduledKey, (posts) =>
        posts?.filter((p) => p.id !== id),
      );
    },
  });
}

/** `datetime-local` value (local time, minutes) of a date. */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** The limits of the time picker: 5 minutes from now to 90 days. */
export function scheduleBounds(now = new Date()) {
  return {
    min: toLocalInput(new Date(now.getTime() + 6 * 60_000)),
    max: toLocalInput(new Date(now.getTime() + 90 * 24 * 3600_000 - 60_000)),
  };
}
