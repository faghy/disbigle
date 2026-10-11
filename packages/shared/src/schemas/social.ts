import { z } from 'zod';
import type { Account } from './accounts.ts';

export const MAX_POST_LENGTH = 5000;
export const MAX_POLL_OPTIONS = 6;
export const visibilities = ['public', 'unlisted', 'followers', 'limited', 'direct'] as const;
export type Visibility = (typeof visibilities)[number];

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
    poll: z
      .object({
        options: z.array(z.string().trim().min(1).max(100)).min(2).max(MAX_POLL_OPTIONS),
        /** Seconds until the poll closes: 5 minutes to 30 days. */
        expiresIn: z
          .number()
          .int()
          .min(300)
          .max(30 * 24 * 3600),
        multiple: z.boolean().default(false),
      })
      .optional(),
  })
  .refine((p) => p.content.trim().length > 0 || p.mediaIds.length > 0, {
    message: 'A post needs text or media',
    path: ['content'],
  });
export type CreatePostRequest = z.input<typeof createPostRequestSchema>;

export const editPostRequestSchema = z.object({
  content: z.string().max(MAX_POST_LENGTH),
  summary: z.string().trim().max(500).default(''),
  sensitive: z.boolean().default(false),
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
  /** Markdown source of a local post; only present for the author (for editing). */
  source?: string;
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
  | 'like';

export interface Notification {
  id: string;
  type: NotificationType;
  createdAt: string;
  read: boolean;
  account: Account;
  status: Status | null;
}

/** Messages pushed over the streaming WebSocket. */
export type StreamEvent =
  | { event: 'update'; stream: string; payload: Status }
  | { event: 'status.update'; stream: string; payload: Status }
  | { event: 'delete'; stream: string; payload: string }
  | { event: 'notification'; stream: string; payload: Notification };
