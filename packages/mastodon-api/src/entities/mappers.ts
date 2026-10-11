import type {
  Account,
  Aspect,
  MediaAttachment,
  Notification,
  NotificationType,
  Poll,
  Relationship,
  Status,
  Visibility,
} from '@disbigle/shared';
import type {
  MAccount,
  MList,
  MMediaAttachment,
  MMediaMeta,
  MNotification,
  MNotificationType,
  MPoll,
  MRelationship,
  MStatus,
  MTag,
  MVisibility,
} from './types.ts';

export interface AccountExtras {
  followersCount: number;
  followingCount: number;
  statusesCount: number;
  lastStatusAt: Date | null;
}

/** What mappers need besides the object itself; `extras` and `moved` come from the presenter. */
export interface MapContext {
  baseUrl: string;
  defaultAvatar: string;
  defaultHeader: string;
  extras?: Map<string, AccountExtras>;
  moved?: Map<string, Account>;
}

export function mapContext(baseUrl: string): MapContext {
  return {
    baseUrl,
    defaultAvatar: `${baseUrl}/assets/user/default.png`,
    defaultHeader: `${baseUrl}/api/mastodon/missing-header.png`,
  };
}

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Plain text (local bios) to the paragraph HTML Mastodon clients expect. */
export function plainToHtml(text: string): string {
  if (!text.trim()) return '';
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** Plain field value: escaped, with bare http(s) URLs linked (as Mastodon does). */
export function fieldValueToHtml(text: string): string {
  const escaped = escapeHtml(text);
  if (!/^https?:\/\/\S+$/.test(text.trim())) return escaped;
  const href = escapeHtml(text.trim());
  const shown = escapeHtml(text.trim().replace(/^https?:\/\//, ''));
  return `<a href="${href}" target="_blank" rel="nofollow noopener noreferrer me">${shown}</a>`;
}

const absolute = (ctx: MapContext, url: string | null | undefined): string | null => {
  if (!url) return null;
  if (/^https?:\/\//.test(url)) return url;
  return `${ctx.baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
};

export function mapAccount(ctx: MapContext, account: Account, depth = 0): MAccount {
  const extras = ctx.extras?.get(account.id);
  const profileUrl = account.url ?? `${ctx.baseUrl}/@${account.acct}`;
  const avatar = absolute(ctx, account.avatarUrl) ?? ctx.defaultAvatar;
  const header = absolute(ctx, account.headerUrl) ?? ctx.defaultHeader;
  const moved = account.movedToId && depth === 0 ? ctx.moved?.get(account.movedToId) : undefined;
  const result: MAccount = {
    id: account.id,
    username: account.username,
    acct: account.acct,
    display_name: account.displayName,
    locked: account.locked,
    bot: account.bot,
    discoverable: account.discoverable,
    indexable: account.discoverable,
    group: false,
    noindex: !account.discoverable,
    hide_collections: false,
    created_at: account.createdAt,
    // Local bios are plain text; remote ones arrive as sanitised HTML.
    note: account.local ? plainToHtml(account.note) : account.note,
    url: profileUrl,
    uri: profileUrl,
    avatar,
    avatar_static: avatar,
    header,
    header_static: header,
    followers_count: extras?.followersCount ?? account.followersCount ?? 0,
    following_count: extras?.followingCount ?? account.followingCount ?? 0,
    statuses_count: extras?.statusesCount ?? account.statusesCount ?? 0,
    last_status_at: extras?.lastStatusAt ? extras.lastStatusAt.toISOString().slice(0, 10) : null,
    emojis: [],
    roles: [],
    fields: account.fields.map((f) => ({
      name: f.name,
      value: account.local ? fieldValueToHtml(f.value) : f.value,
      verified_at: null,
    })),
  };
  if (account.movedToId) result.moved = moved ? mapAccount(ctx, moved, depth + 1) : null;
  return result;
}

/**
 * Visibility shown to clients. Aspect posts (`limited`) have no Mastodon equivalent: they are
 * shown as `private`, which clients render as "not public, do not boost".
 */
export function mapVisibility(visibility: Visibility): MVisibility {
  switch (visibility) {
    case 'public':
      return 'public';
    case 'unlisted':
      return 'unlisted';
    case 'followers':
    case 'limited':
      return 'private';
    case 'direct':
      return 'direct';
  }
}

/** Visibility requested by a client, in our terms. */
export function parseVisibility(value: string | undefined): Visibility | undefined {
  switch (value) {
    case 'public':
    case 'unlisted':
    case 'direct':
    case 'limited':
      return value;
    case 'private':
      return 'followers';
    default:
      return undefined;
  }
}

function meta(width: number | null, height: number | null): MMediaMeta | undefined {
  if (!width || !height) return undefined;
  return { width, height, size: `${width}x${height}`, aspect: width / height };
}

export function mapMedia(media: MediaAttachment): MMediaAttachment {
  const original = meta(media.width, media.height);
  return {
    id: media.id,
    type: media.type,
    url: media.url,
    preview_url: media.previewUrl ?? (media.type === 'image' ? media.url : null),
    remote_url: null,
    preview_remote_url: null,
    text_url: null,
    meta: original ? { original, small: original } : {},
    description: media.description ? media.description : null,
    blurhash: media.blurhash,
  };
}

export function mapPoll(poll: Poll, signedIn: boolean): MPoll {
  const result: MPoll = {
    id: poll.id,
    expires_at: poll.expiresAt,
    expired: poll.expired,
    multiple: poll.multiple,
    votes_count: poll.votesCount,
    voters_count: poll.votersCount,
    options: poll.options.map((o) => ({ title: o.title, votes_count: o.votesCount })),
    emojis: [],
  };
  if (signedIn) {
    result.voted = poll.voted;
    result.own_votes = poll.ownVotes;
  }
  return result;
}

export function tagUrl(ctx: MapContext, name: string): string {
  return `${ctx.baseUrl}/tags/${encodeURIComponent(name)}`;
}

export function mapTag(ctx: MapContext, name: string, following?: boolean): MTag {
  const tag: MTag = { name, url: tagUrl(ctx, name), history: [] };
  if (following !== undefined) tag.following = following;
  return tag;
}

export function mapStatus(
  ctx: MapContext,
  status: Status,
  options: { signedIn: boolean; includeSource?: boolean },
): MStatus {
  const result: MStatus = {
    id: status.id,
    uri: status.uri ?? status.url ?? `${ctx.baseUrl}/statuses/${status.id}`,
    url: status.url,
    created_at: status.createdAt,
    edited_at: status.editedAt,
    account: mapAccount(ctx, status.account),
    content: status.content,
    visibility: mapVisibility(status.visibility),
    sensitive: status.sensitive,
    spoiler_text: status.summary,
    media_attachments: status.media.map(mapMedia),
    application: null,
    mentions: status.mentions.map((m) => ({
      id: m.id,
      username: m.username,
      acct: m.acct,
      url: m.url ?? `${ctx.baseUrl}/@${m.acct}`,
    })),
    tags: status.tags.map((t) => mapTag(ctx, t.name)),
    emojis: [],
    reblogs_count: status.reblogsCount,
    favourites_count: status.likesCount,
    replies_count: status.repliesCount,
    in_reply_to_id: status.inReplyToId,
    in_reply_to_account_id: status.inReplyToAccountId,
    reblog: status.reblog ? mapStatus(ctx, status.reblog, options) : null,
    poll: status.poll ? mapPoll(status.poll, options.signedIn) : null,
    card: null,
    language: status.language,
  };
  if (options.signedIn) {
    result.favourited = status.liked;
    result.reblogged = status.reblogged;
    result.bookmarked = status.bookmarked;
    result.muted = false;
    result.pinned = status.pinned ?? false;
    result.filtered = [];
  }
  if (options.includeSource) result.text = status.source ?? null;
  return result;
}

/** Our notification types as Mastodon types: a reply is a mention, a like a favourite. */
export function mapNotificationType(type: NotificationType): MNotificationType {
  switch (type) {
    case 'reply':
      return 'mention';
    case 'like':
      return 'favourite';
    default:
      return type;
  }
}

/** Mastodon notification types to ours (for `types[]` / `exclude_types[]`). */
export function nativeNotificationTypes(types: string[]): NotificationType[] {
  const result = new Set<NotificationType>();
  for (const type of types) {
    if (type === 'mention') {
      result.add('mention');
      result.add('reply');
    } else if (type === 'favourite') result.add('like');
    else if (['reblog', 'follow', 'follow_request', 'poll'].includes(type)) {
      result.add(type as NotificationType);
    }
  }
  return [...result];
}

export function mapNotification(ctx: MapContext, notification: Notification): MNotification {
  return {
    id: notification.id,
    type: mapNotificationType(notification.type),
    group_key: `ungrouped-${notification.id}`,
    created_at: notification.createdAt,
    account: mapAccount(ctx, notification.account),
    status: notification.status ? mapStatus(ctx, notification.status, { signedIn: true }) : null,
  };
}

export function mapRelationship(rel: Relationship, requestedBy: boolean): MRelationship {
  return {
    id: rel.id,
    following: rel.following,
    showing_reblogs: rel.following,
    notifying: false,
    languages: null,
    followed_by: rel.followedBy,
    blocking: rel.blocking,
    blocked_by: rel.blockedBy,
    muting: rel.muting,
    // Our mutes also silence notifications from the account.
    muting_notifications: rel.muting,
    requested: rel.requested,
    requested_by: requestedBy,
    domain_blocking: false,
    endorsed: false,
    note: '',
  };
}

/** Aspects are presented as lists. */
export function mapList(aspect: Pick<Aspect, 'id' | 'name'>): MList {
  return { id: aspect.id, title: aspect.name, replies_policy: 'list', exclusive: false };
}
