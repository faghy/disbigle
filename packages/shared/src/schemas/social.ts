import { z } from 'zod';
import type { Account } from './accounts.ts';

export const MAX_POST_LENGTH = 5000;
export const MAX_POLL_OPTIONS = 6;
export const visibilities = ['public', 'unlisted', 'followers', 'limited', 'direct'] as const;
export type Visibility = (typeof visibilities)[number];

const pollRequestSchema = z.object({
  options: z.array(z.string().trim().min(1).max(100)).min(2).max(MAX_POLL_OPTIONS),
  /** Seconds until the poll closes: 5 minutes to 30 days. */
  expiresIn: z
    .number()
    .int()
    .min(300)
    .max(30 * 24 * 3600),
  multiple: z.boolean().default(false),
});

export const createPostRequestSchema = z
  .object({
    content: z.string().max(MAX_POST_LENGTH).default(''),
    visibility: z.enum(visibilities).default('public'),
    /** Required when visibility is `limited`. */
    aspectIds: z.array(z.uuid()).max(50).default([]),
    inReplyToId: z.uuid().optional(),
    summary: z.string().trim().max(500).default(''),
    sensitive: z.boolean().default(false),
    language: z
      .string()
      .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/)
      .optional(),
    mediaIds: z.array(z.uuid()).max(4).default([]),
    poll: pollRequestSchema.optional(),
    /** Posts in a group; the group decides who reads it, so `visibility` is ignored. */
    groupId: z.uuid().optional(),
  })
  .refine((p) => p.content.trim().length > 0 || p.mediaIds.length > 0 || p.poll !== undefined, {
    message: 'A post needs text, media or a poll',
    path: ['content'],
  });
export type CreatePostRequest = z.input<typeof createPostRequestSchema>;

export const editPostRequestSchema = z.object({
  content: z.string().max(MAX_POST_LENGTH),
  summary: z.string().trim().max(500).default(''),
  sensitive: z.boolean().default(false),
  /** The attachments, in order, replacing the current ones. Left out, they stay as they are. */
  mediaIds: z.array(z.uuid()).max(4).optional(),
  /**
   * The poll: left out it stays as it is, `null` removes it. Changing the options or the choice
   * mode starts it over without votes; with the same options only the closing time changes.
   */
  poll: pollRequestSchema.nullable().optional(),
});
export type EditPostRequest = z.input<typeof editPostRequestSchema>;

export const paginationQuerySchema = z.object({
  maxId: z.uuid().optional(),
  minId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(40).default(20),
});
export type PaginationQuery = z.input<typeof paginationQuerySchema>;

export const aspectRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const aspectMembershipsRequestSchema = z.object({
  /** Full set of aspects the account should belong to (replaces the current set). */
  aspectIds: z.array(z.uuid()).max(100),
});

export interface Mention {
  id: string;
  username: string;
  acct: string;
  url: string | null;
}

export interface MediaAttachment {
  id: string;
  type: 'image' | 'video' | 'audio' | 'unknown';
  url: string;
  previewUrl: string | null;
  description: string;
  width: number | null;
  height: number | null;
  blurhash: string | null;
}

export interface Poll {
  id: string;
  expiresAt: string | null;
  expired: boolean;
  multiple: boolean;
  /** Total votes (with multiple choice, one voter can cast several). */
  votesCount: number;
  votersCount: number;
  options: { title: string; votesCount: number }[];
  /** Whether the viewer voted, and for which options. */
  voted: boolean;
  ownVotes: number[];
}

export const pollVoteRequestSchema = z.object({
  choices: z
    .array(
      z
        .number()
        .int()
        .min(0)
        .max(MAX_POLL_OPTIONS - 1),
    )
    .min(1)
    .max(MAX_POLL_OPTIONS),
});

export interface Status {
  id: string;
  uri: string | null;
  url: string | null;
  createdAt: string;
  editedAt: string | null;
  account: Account;
  content: string;
  summary: string;
  sensitive: boolean;
  visibility: Visibility;
  language: string | null;
  inReplyToId: string | null;
  inReplyToAccountId: string | null;
  /** Handle of the replied-to author (`user` or `user@domain`), for "Replying to @…". */
  inReplyToAccountAcct: string | null;
  reblog: Status | null;
  repliesCount: number;
  reblogsCount: number;
  likesCount: number;
  mentions: Mention[];
  tags: { name: string }[];
  media: MediaAttachment[];
  poll: Poll | null;
  /** Viewer-specific flags; false when signed out. */
  liked: boolean;
  reblogged: boolean;
  bookmarked: boolean;
  /** Aspects a limited post was shared with; only present for the author. */
  aspectIds?: string[];
  /** True in the list of an account's pinned posts. */
  pinned?: boolean;
  /** Markdown source of a local post; only present for the author (for editing). */
  source?: string;
  /** The group the post was written in. */
  group?: GroupSummary | null;
}

export interface StatusContext {
  ancestors: Status[];
  descendants: Status[];
}

export interface Relationship {
  id: string;
  following: boolean;
  requested: boolean;
  followedBy: boolean;
  blocking: boolean;
  blockedBy: boolean;
  muting: boolean;
  /** Your aspects this account belongs to. */
  aspectIds: string[];
}

export interface Aspect {
  id: string;
  name: string;
  memberCount: number;
}

export type NotificationType =
  | 'follow'
  | 'follow_request'
  | 'mention'
  | 'reply'
  | 'reblog'
  | 'like'
  | 'poll'
  | 'group_request'
  | 'group_invite'
  | 'group_accepted';

export interface Notification {
  id: string;
  type: NotificationType;
  createdAt: string;
  read: boolean;
  account: Account;
  status: Status | null;
  /** For group requests, invitations and approvals. */
  group?: GroupSummary | null;
}

export const groupPrivacies = ['public', 'private', 'secret'] as const;
/**
 * public: anyone can read and join; private: listed, members only, joining needs approval;
 * secret: members only and unlisted, by invitation.
 */
export type GroupPrivacy = (typeof groupPrivacies)[number];
export const groupRoles = ['admin', 'moderator', 'member'] as const;
export type GroupRole = (typeof groupRoles)[number];
export type GroupMemberState = 'member' | 'requested' | 'invited';

export interface GroupSummary {
  id: string;
  /** Handle: `name` here, `name@domain` for the fediverse. */
  handle: string;
  name: string;
  privacy: GroupPrivacy;
  avatarUrl: string | null;
}

export interface Group extends GroupSummary {
  description: string;
  headerUrl: string | null;
  url: string;
  membersCount: number;
  createdAt: string;
  /** The viewer's place in the group, if any. */
  membership: { role: GroupRole; state: GroupMemberState } | null;
  /** Join requests waiting, for moderators and admins. */
  requestsCount?: number;
}

export interface GroupMember {
  account: Account;
  role: GroupRole;
  state: GroupMemberState;
  createdAt: string;
}

export const createGroupRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  handle: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_]{1,30}$/, 'Use 1-30 letters, digits or underscores'),
  description: z.string().trim().max(2000).default(''),
  privacy: z.enum(groupPrivacies).default('public'),
});
export type CreateGroupRequest = z.input<typeof createGroupRequestSchema>;

export const updateGroupRequestSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(2000).optional(),
  privacy: z.enum(groupPrivacies).optional(),
});
export type UpdateGroupRequest = z.input<typeof updateGroupRequestSchema>;

/** Messages pushed over the streaming WebSocket. */
export type StreamEvent =
  | { event: 'update'; stream: string; payload: Status }
  | { event: 'status.update'; stream: string; payload: Status }
  | { event: 'delete'; stream: string; payload: string }
  | { event: 'notification'; stream: string; payload: Notification };

/** A private conversation: a thread of direct posts. */
export interface Conversation {
  /** Id of the first post of the thread. */
  id: string;
  accounts: Account[];
  lastStatus: Status;
}
