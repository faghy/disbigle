import type {
  Account,
  Aspect,
  Conversation,
  CreatePostRequest,
  EditPostRequest,
  MediaAttachment,
  Notification,
  Relationship,
  Status,
  StatusContext,
} from '@disbigle/shared';
import { api, queryString } from './client.ts';

type Ok = { status: 'ok' };

/** Cursor parameters: `maxId` pages to older items, `minId` to newer ones. */
export interface PageParams {
  maxId?: string | undefined;
  minId?: string | undefined;
  limit?: number | undefined;
}

export const PAGE_SIZE = 20;

/** Offset paging for follower and following lists. */
export interface OffsetPage {
  limit?: number;
  offset?: number;
}

export type { Conversation };

export interface TagInfo {
  name: string;
  following: boolean;
  postsCount: number;
}

export const reportCategories = ['spam', 'illegal', 'harassment', 'violation', 'other'] as const;
export type ReportCategory = (typeof reportCategories)[number];

export interface ReportRequest {
  accountId: string;
  statusIds: string[];
  category: ReportCategory;
  comment: string;
}

const id = (value: string) => encodeURIComponent(value);

export type StatusAction =
  | 'like'
  | 'unlike'
  | 'reblog'
  | 'unreblog'
  | 'bookmark'
  | 'unbookmark'
  | 'pin'
  | 'unpin';
export type AccountAction = 'follow' | 'unfollow' | 'block' | 'unblock' | 'mute' | 'unmute';

export const social = {
  // Statuses
  createStatus: (body: CreatePostRequest) => api.post<Status>('/statuses', body),
  status: (statusId: string) => api.get<Status>(`/statuses/${id(statusId)}`),
  context: (statusId: string) => api.get<StatusContext>(`/statuses/${id(statusId)}/context`),
  editStatus: (statusId: string, body: EditPostRequest) =>
    api.put<Status>(`/statuses/${id(statusId)}`, body),
  deleteStatus: (statusId: string) => api.delete<Ok>(`/statuses/${id(statusId)}`),
  statusAction: (statusId: string, action: StatusAction) =>
    api.post<Status>(`/statuses/${id(statusId)}/${action}`),

  // Timelines
  homeTimeline: (page: PageParams) =>
    api.get<Status[]>(`/timelines/home${queryString({ ...page })}`),
  publicTimeline: (page: PageParams & { local?: boolean }) =>
    api.get<Status[]>(
      `/timelines/public${queryString({ ...page, local: page.local ? 'true' : undefined })}`,
    ),
  tagTimeline: (tag: string, page: PageParams) =>
    api.get<Status[]>(`/timelines/tag/${id(tag)}${queryString({ ...page })}`),
  aspectTimeline: (aspectId: string, page: PageParams) =>
    api.get<Status[]>(`/timelines/aspect/${id(aspectId)}${queryString({ ...page })}`),
  bookmarks: (page: PageParams) =>
    api.get<Status[]>(`/timelines/bookmarks${queryString({ ...page })}`),
  accountStatuses: (accountId: string, page: PageParams & { excludeReplies?: boolean }) =>
    api.get<Status[]>(
      `/accounts/${id(accountId)}/statuses${queryString({
        ...page,
        excludeReplies: page.excludeReplies ? 'true' : undefined,
      })}`,
    ),

  /** An account's pinned posts (up to 5), each with `pinned: true`. */
  pinnedStatuses: (accountId: string) =>
    api.get<Status[]>(`/accounts/${id(accountId)}/statuses?pinned=true`),

  // Accounts
  relationships: (ids: string[]) =>
    api.get<Relationship[]>(`/accounts/relationships${queryString({ 'id[]': ids })}`),
  accountAction: (accountId: string, action: AccountAction) =>
    api.post<Relationship>(`/accounts/${id(accountId)}/${action}`),
  setAspectMemberships: (accountId: string, aspectIds: string[]) =>
    api.put<Relationship>(`/accounts/${id(accountId)}/aspects`, { aspectIds }),
  followers: (accountId: string, page: OffsetPage = {}) =>
    api.get<Account[]>(`/accounts/${id(accountId)}/followers${queryString({ ...page })}`),
  following: (accountId: string, page: OffsetPage = {}) =>
    api.get<Account[]>(`/accounts/${id(accountId)}/following${queryString({ ...page })}`),
  authorizeFollowRequest: (accountId: string) =>
    api.post<Relationship>(`/follow_requests/${id(accountId)}/authorize`),
  rejectFollowRequest: (accountId: string) =>
    api.post<Relationship>(`/follow_requests/${id(accountId)}/reject`),

  // Aspects
  aspects: () => api.get<Aspect[]>('/aspects'),
  createAspect: (name: string) => api.post<Aspect>('/aspects', { name }),
  renameAspect: (aspectId: string, name: string) =>
    api.patch<Aspect>(`/aspects/${id(aspectId)}`, { name }),
  deleteAspect: (aspectId: string) => api.delete<Ok>(`/aspects/${id(aspectId)}`),
  aspectMembers: (aspectId: string) => api.get<Account[]>(`/aspects/${id(aspectId)}/members`),

  // Notifications
  notifications: (page: PageParams) =>
    api.get<Notification[]>(`/notifications${queryString({ ...page })}`),
  unreadCount: () => api.get<{ count: number }>('/notifications/unread_count'),
  markNotificationsRead: () => api.post<Ok>('/notifications/read'),

  // Private conversations (direct and limited threads)
  conversations: (page: PageParams) =>
    api.get<Conversation[]>(`/timelines/conversations${queryString({ ...page })}`),

  // Polls
  vote: (pollId: string, choices: number[]) =>
    api.post<Status>(`/polls/${id(pollId)}/votes`, { choices }),

  // Hashtags
  tag: (name: string) => api.get<TagInfo>(`/tags/${id(name)}`),
  followTag: (name: string, follow: boolean) =>
    api.post<TagInfo>(`/tags/${id(name)}/${follow ? 'follow' : 'unfollow'}`),
  followedTags: () => api.get<string[]>('/tags/followed'),

  // Search and reports
  /** Full-text search in posts the viewer may see, newest first. */
  searchStatuses: (q: string, page: PageParams) =>
    api.get<Status[]>(`/search/statuses${queryString({ q, ...page })}`),
  searchAccounts: (q: string) => api.get<Account[]>(`/search/accounts${queryString({ q })}`),
  /** Fetches a remote account by handle or URL; `null` when nothing was found. */
  resolveAccount: (q: string) => api.post<Account | null>('/search/resolve', { q }),
  /** Imports a public remote post by its URL; `null` when nothing was found. */
  resolveStatus: (q: string) => api.post<Status | null>('/search/resolve_status', { q }),
  report: (body: ReportRequest) => api.post<{ id: string }>('/reports', body),

  // Media
  uploadMedia: (file: File, description = '') => {
    const form = new FormData();
    // The server reads fields that come before the file, so the description goes first.
    form.append('description', description);
    form.append('file', file);
    return api.upload<MediaAttachment>('/media', form);
  },
  updateMedia: (mediaId: string, description: string) =>
    api.put<MediaAttachment>(`/media/${id(mediaId)}`, { description }),
};
