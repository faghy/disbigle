/**
 * Mastodon REST entities (https://docs.joinmastodon.org/entities/), the subset we produce.
 * Field names are snake_case as on the wire; ids are strings (our UUIDv7).
 */

export interface MCustomEmoji {
  shortcode: string;
  url: string;
  static_url: string;
  visible_in_picker: boolean;
}

export interface MField {
  name: string;
  value: string;
  verified_at: string | null;
}

export interface MAccount {
  id: string;
  username: string;
  acct: string;
  display_name: string;
  locked: boolean;
  bot: boolean;
  discoverable: boolean;
  indexable: boolean;
  group: boolean;
  noindex: boolean;
  hide_collections: boolean;
  created_at: string;
  note: string;
  url: string;
  uri: string;
  avatar: string;
  avatar_static: string;
  header: string;
  header_static: string;
  followers_count: number;
  following_count: number;
  statuses_count: number;
  last_status_at: string | null;
  emojis: MCustomEmoji[];
  roles: unknown[];
  fields: MField[];
  moved?: MAccount | null;
}

export interface MCredentialAccount extends MAccount {
  source: {
    privacy: 'public' | 'unlisted' | 'private' | 'direct';
    sensitive: boolean;
    language: string | null;
    note: string;
    fields: MField[];
    follow_requests_count: number;
    hide_collections: boolean;
    discoverable: boolean;
    indexable: boolean;
  };
  role: { id: string; name: string; permissions: string; color: string; highlighted: boolean };
}

export interface MMediaMeta {
  width: number;
  height: number;
  size: string;
  aspect: number;
}

export interface MMediaAttachment {
  id: string;
  type: 'image' | 'gifv' | 'video' | 'audio' | 'unknown';
  url: string;
  preview_url: string | null;
  remote_url: string | null;
  preview_remote_url: string | null;
  text_url: string | null;
  meta: { original?: MMediaMeta; small?: MMediaMeta; focus?: { x: number; y: number } };
  description: string | null;
  blurhash: string | null;
}

export interface MMention {
  id: string;
  username: string;
  url: string;
  acct: string;
}

export interface MTag {
  name: string;
  url: string;
  history: { day: string; uses: string; accounts: string }[];
  following?: boolean;
}

export interface MPoll {
  id: string;
  expires_at: string | null;
  expired: boolean;
  multiple: boolean;
  votes_count: number;
  voters_count: number | null;
  options: { title: string; votes_count: number | null }[];
  emojis: MCustomEmoji[];
  voted?: boolean;
  own_votes?: number[];
}

export type MVisibility = 'public' | 'unlisted' | 'private' | 'direct';

export interface MStatus {
  id: string;
  uri: string;
  url: string | null;
  created_at: string;
  edited_at: string | null;
  account: MAccount;
  content: string;
  visibility: MVisibility;
  sensitive: boolean;
  spoiler_text: string;
  media_attachments: MMediaAttachment[];
  application: { name: string; website: string | null } | null;
  mentions: MMention[];
  tags: MTag[];
  emojis: MCustomEmoji[];
  reblogs_count: number;
  favourites_count: number;
  replies_count: number;
  in_reply_to_id: string | null;
  in_reply_to_account_id: string | null;
  reblog: MStatus | null;
  poll: MPoll | null;
  card: null;
  language: string | null;
  text?: string | null;
  favourited?: boolean;
  reblogged?: boolean;
  muted?: boolean;
  bookmarked?: boolean;
  pinned?: boolean;
  filtered?: unknown[];
}

export type MNotificationType =
  | 'mention'
  | 'status'
  | 'reblog'
  | 'follow'
  | 'follow_request'
  | 'favourite'
  | 'poll'
  | 'update';

export interface MNotification {
  id: string;
  type: MNotificationType;
  group_key: string;
  created_at: string;
  account: MAccount;
  status?: MStatus | null;
}

export interface MRelationship {
  id: string;
  following: boolean;
  showing_reblogs: boolean;
  notifying: boolean;
  languages: string[] | null;
  followed_by: boolean;
  blocking: boolean;
  blocked_by: boolean;
  muting: boolean;
  muting_notifications: boolean;
  requested: boolean;
  requested_by: boolean;
  domain_blocking: boolean;
  endorsed: boolean;
  note: string;
}

export interface MList {
  id: string;
  title: string;
  replies_policy: 'followed' | 'list' | 'none';
  exclusive: boolean;
}

export interface MContext {
  ancestors: MStatus[];
  descendants: MStatus[];
}

export interface MConversation {
  id: string;
  unread: boolean;
  accounts: MAccount[];
  last_status: MStatus | null;
}

export interface MApplication {
  id: string;
  name: string;
  website: string | null;
  scopes: string[];
  redirect_uri: string;
  redirect_uris: string[];
  vapid_key?: string;
}

export interface MCredentialApplication extends MApplication {
  client_id: string;
  client_secret: string;
  client_secret_expires_at: number;
}
