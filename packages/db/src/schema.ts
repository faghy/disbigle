import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const protocolEnum = pgEnum('protocol', ['activitypub', 'diaspora']);
export const userRoleEnum = pgEnum('user_role', ['user', 'moderator', 'admin']);
export const sessionStageEnum = pgEnum('session_stage', ['mfa_pending', 'active']);
export const visibilityEnum = pgEnum('visibility', [
  'public',
  'unlisted',
  'followers',
  'limited',
  'direct',
]);
export const mediaTypeEnum = pgEnum('media_type', ['image', 'video', 'audio', 'unknown']);
export const domainBlockSeverityEnum = pgEnum('domain_block_severity', ['silence', 'suspend']);
export const reportCategoryEnum = pgEnum('report_category', [
  'spam',
  'illegal',
  'harassment',
  'violation',
  'other',
]);
export const notificationTypeEnum = pgEnum('notification_type', [
  'follow',
  'follow_request',
  'mention',
  'reply',
  'reblog',
  'like',
  'poll',
  'group_request',
  'group_invite',
  'group_accepted',
]);
/** public: anyone reads; private: members only, the group is listed; secret: members only, unlisted. */
export const groupPrivacyEnum = pgEnum('group_privacy', ['public', 'private', 'secret']);
export const groupRoleEnum = pgEnum('group_role', ['admin', 'moderator', 'member']);
/** requested: waiting for a moderator; invited: waiting for the invited person. */
export const groupMemberStateEnum = pgEnum('group_member_state', [
  'member',
  'requested',
  'invited',
]);

export type ProfileField = { name: string; value: string };

/**
 * Every account known to the instance, local (domain IS NULL) or remote.
 * Remote actors may be reachable through ActivityPub, diaspora, or both.
 */
export const actors = pgTable(
  'actors',
  {
    id: uuid('id').primaryKey(),
    username: text('username').notNull(),
    domain: text('domain'),
    displayName: text('display_name').notNull().default(''),
    summary: text('summary').notNull().default(''),
    avatarUrl: text('avatar_url'),
    headerUrl: text('header_url'),
    /** Original URLs of a remote account's images; avatar_url/header_url point to the local cache once stored. */
    avatarRemoteUrl: text('avatar_remote_url'),
    headerRemoteUrl: text('header_remote_url'),
    fields: jsonb('fields').$type<ProfileField[]>().notNull().default([]),
    locked: boolean('locked').notNull().default(false),
    discoverable: boolean('discoverable').notNull().default(true),
    bot: boolean('bot').notNull().default(false),
    /** A group (ours, or a remote ActivityPub Group such as a Lemmy community). */
    isGroup: boolean('is_group').notNull().default(false),
    publicKeyPem: text('public_key_pem').notNull(),
    apUri: text('ap_uri'),
    apUrl: text('ap_url'),
    apInbox: text('ap_inbox'),
    apSharedInbox: text('ap_shared_inbox'),
    apOutbox: text('ap_outbox'),
    apFollowers: text('ap_followers'),
    diasporaGuid: text('diaspora_guid'),
    diasporaReceiveUrl: text('diaspora_receive_url'),
    protocols: protocolEnum('protocols').array().notNull().default(sql`'{}'`),
    preferredProtocol: protocolEnum('preferred_protocol'),
    /** Other identities of this account (ActivityPub `alsoKnownAs`), as actor URIs. */
    alsoKnownAs: text('also_known_as').array().notNull().default(sql`'{}'`),
    /** Set when the account moved to another one (ActivityPub `movedTo` / `Move`). */
    movedToActorId: uuid('moved_to_actor_id'),
    lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    silencedAt: timestamp('silenced_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('actors_handle_idx').on(
      sql`lower(${t.username})`,
      sql`coalesce(lower(${t.domain}), '')`,
    ),
    uniqueIndex('actors_ap_uri_idx').on(t.apUri),
    uniqueIndex('actors_diaspora_guid_idx').on(t.diasporaGuid),
    index('actors_domain_idx').on(t.domain),
  ],
);

/** Credentials and settings of local accounts. */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    privateKeyPem: text('private_key_pem').notNull(),
    /** Ed25519 key pair (PKCS#8 / SPKI PEM) for Object Integrity Proofs (FEP-8b32). */
    ed25519PrivateKeyPem: text('ed25519_private_key_pem'),
    ed25519PublicKeyPem: text('ed25519_public_key_pem'),
    role: userRoleEnum('role').notNull().default('user'),
    locale: text('locale').notNull().default('en'),
    approved: boolean('approved').notNull().default(true),
    registrationReason: text('registration_reason'),
    totpSecret: text('totp_secret'),
    totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    /** Set when the user deletes their account; data is purged once the deletion has federated. */
    deletionRequestedAt: timestamp('deletion_requested_at', { withTimezone: true }),
    lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_actor_id_idx').on(t.actorId),
    uniqueIndex('users_email_idx').on(sql`lower(${t.email})`),
  ],
);

/** Browser sessions. Only a hash of the token is stored. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    stage: sessionStageEnum('stage').notNull().default('active'),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_idx').on(t.tokenHash),
    index('sessions_user_id_idx').on(t.userId),
  ],
);

/** Passkeys (WebAuthn credentials). */
export const webauthnCredentials = pgTable(
  'webauthn_credentials',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    credentialId: text('credential_id').notNull(),
    publicKey: bytea('public_key').notNull(),
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    transports: text('transports').array().notNull().default(sql`'{}'`),
    name: text('name').notNull().default(''),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('webauthn_credentials_credential_id_idx').on(t.credentialId),
    index('webauthn_credentials_user_id_idx').on(t.userId),
  ],
);

/** One-time recovery codes for two-factor authentication. Only hashes are stored. */
export const recoveryCodes = pgTable(
  'recovery_codes',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('recovery_codes_user_id_idx').on(t.userId)],
);

/** Invitation codes for invite-only registration. */
export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    maxUses: integer('max_uses'),
    uses: integer('uses').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('invites_code_idx').on(t.code)],
);

const actorRef = (name: string) =>
  uuid(name)
    .notNull()
    .references(() => actors.id, { onDelete: 'cascade' });

/** Accepted follow relationships: `actorId` follows `targetActorId`. */
export const follows = pgTable(
  'follows',
  {
    id: uuid('id').primaryKey(),
    actorId: actorRef('actor_id'),
    targetActorId: actorRef('target_actor_id'),
    /** URI of the Follow activity, when federated. */
    apUri: text('ap_uri'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('follows_pair_idx').on(t.actorId, t.targetActorId),
    index('follows_target_idx').on(t.targetActorId),
  ],
);

/** Pending follow requests to locked accounts. */
export const followRequests = pgTable(
  'follow_requests',
  {
    id: uuid('id').primaryKey(),
    actorId: actorRef('actor_id'),
    targetActorId: actorRef('target_actor_id'),
    apUri: text('ap_uri'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('follow_requests_pair_idx').on(t.actorId, t.targetActorId),
    index('follow_requests_target_idx').on(t.targetActorId),
  ],
);

export const blocks = pgTable(
  'blocks',
  {
    id: uuid('id').primaryKey(),
    actorId: actorRef('actor_id'),
    targetActorId: actorRef('target_actor_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('blocks_pair_idx').on(t.actorId, t.targetActorId),
    index('blocks_target_idx').on(t.targetActorId),
  ],
);

export const mutes = pgTable(
  'mutes',
  {
    id: uuid('id').primaryKey(),
    actorId: actorRef('actor_id'),
    targetActorId: actorRef('target_actor_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('mutes_pair_idx').on(t.actorId, t.targetActorId)],
);

/**
 * Aspects ("circles"): private, named groups of actors owned by a local actor.
 * Members never learn which aspect they are in.
 */
export const aspects = pgTable(
  'aspects',
  {
    id: uuid('id').primaryKey(),
    ownerActorId: actorRef('owner_actor_id'),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('aspects_owner_name_idx').on(t.ownerActorId, sql`lower(${t.name})`)],
);

export const aspectMemberships = pgTable(
  'aspect_memberships',
  {
    aspectId: uuid('aspect_id')
      .notNull()
      .references(() => aspects.id, { onDelete: 'cascade' }),
    actorId: actorRef('actor_id'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.aspectId, t.actorId] }),
    index('aspect_memberships_actor_idx').on(t.actorId),
  ],
);

/**
 * Groups hosted here. Name, description and pictures live on the group's actor (its handle is
 * the actor's username), so a public group can federate as an ActivityPub Group (FEP-1b12).
 */
export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey(),
    actorId: actorRef('actor_id'),
    privacy: groupPrivacyEnum('privacy').notNull().default('public'),
    /** RSA key of the group's actor, which signs what the group shares on other servers. */
    privateKeyPem: text('private_key_pem').notNull(),
    createdById: uuid('created_by_id').references(() => actors.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('groups_actor_idx').on(t.actorId)],
);

/** Members of a group, local or remote, with pending requests and invitations. */
export const groupMembers = pgTable(
  'group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    actorId: actorRef('actor_id'),
    role: groupRoleEnum('role').notNull().default('member'),
    state: groupMemberStateEnum('state').notNull().default('member'),
    invitedById: uuid('invited_by_id').references(() => actors.id, { onDelete: 'set null' }),
    /** URI of the Follow activity, for remote members. */
    apUri: text('ap_uri'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.actorId] }),
    index('group_members_actor_idx').on(t.actorId),
  ],
);

/** Status messages, replies and reblogs, local or remote. */
export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey(),
    actorId: actorRef('actor_id'),
    local: boolean('local').notNull(),
    visibility: visibilityEnum('visibility').notNull(),
    /** Markdown source, for local posts. */
    source: text('source'),
    /** Sanitised HTML shown to readers. */
    contentHtml: text('content_html').notNull().default(''),
    /** Content warning / spoiler text. */
    summary: text('summary').notNull().default(''),
    sensitive: boolean('sensitive').notNull().default(false),
    language: text('language'),
    inReplyToId: uuid('in_reply_to_id'),
    inReplyToActorId: uuid('in_reply_to_actor_id'),
    /** Federated id of the parent when the parent is not (yet) stored locally. */
    inReplyToUri: text('in_reply_to_uri'),
    /** First post of the thread; equals `id` for a thread root. */
    threadRootId: uuid('thread_root_id'),
    reblogOfId: uuid('reblog_of_id'),
    /** The group the post was written in; replies inherit it from the thread. */
    groupId: uuid('group_id').references(() => groups.id, { onDelete: 'cascade' }),
    apUri: text('ap_uri'),
    apUrl: text('ap_url'),
    diasporaGuid: text('diaspora_guid'),
    repliesCount: integer('replies_count').notNull().default(0),
    reblogsCount: integer('reblogs_count').notNull().default(0),
    likesCount: integer('likes_count').notNull().default(0),
    createdAt: createdAt(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (t) => [
    index('posts_actor_idx').on(t.actorId, t.id),
    index('posts_reply_idx').on(t.inReplyToId),
    index('posts_thread_idx').on(t.threadRootId),
    index('posts_reblog_idx').on(t.reblogOfId),
    index('posts_public_local_idx').on(t.id).where(sql`${t.visibility} = 'public' and ${t.local}`),
    index('posts_public_idx').on(t.id).where(sql`${t.visibility} = 'public'`),
    index('posts_group_idx').on(t.groupId, t.id).where(sql`${t.groupId} is not null`),
    index('posts_search_idx').using(
      'gin',
      sql`to_tsvector('simple', regexp_replace(${t.contentHtml} || ' ' || ${t.summary}, '<[^>]+>', ' ', 'g'))`,
    ),
    uniqueIndex('posts_ap_uri_idx').on(t.apUri),
    uniqueIndex('posts_diaspora_guid_idx').on(t.diasporaGuid),
    uniqueIndex('posts_reblog_unique_idx')
      .on(t.actorId, t.reblogOfId)
      .where(sql`${t.reblogOfId} is not null`),
  ],
);

/** Explicit recipients of a post (mentions, limited and direct posts). */
export const postAudiences = pgTable(
  'post_audiences',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    actorId: actorRef('actor_id'),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.actorId] }),
    index('post_audiences_actor_idx').on(t.actorId, t.postId),
  ],
);

/** Aspects a limited post was shared with. Visible to the author only. */
export const postAspects = pgTable(
  'post_aspects',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    aspectId: uuid('aspect_id')
      .notNull()
      .references(() => aspects.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.aspectId] }),
    index('post_aspects_aspect_idx').on(t.aspectId),
  ],
);

export const mentions = pgTable(
  'mentions',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    actorId: actorRef('actor_id'),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.actorId] }),
    index('mentions_actor_idx').on(t.actorId),
  ],
);

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey(),
    /** Lowercase tag name without the leading `#`. */
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('tags_name_idx').on(t.name)],
);

export const postTags = pgTable(
  'post_tags',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.tagId] }),
    index('post_tags_tag_idx').on(t.tagId, t.postId),
  ],
);

export const tagFollows = pgTable(
  'tag_follows',
  {
    actorId: actorRef('actor_id'),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.actorId, t.tagId] })],
);

export const likes = pgTable(
  'likes',
  {
    id: uuid('id').primaryKey(),
    actorId: actorRef('actor_id'),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    apUri: text('ap_uri'),
    diasporaGuid: text('diaspora_guid'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('likes_pair_idx').on(t.actorId, t.postId),
    index('likes_post_idx').on(t.postId),
  ],
);

export const bookmarks = pgTable(
  'bookmarks',
  {
    actorId: actorRef('actor_id'),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.actorId, t.postId] })],
);

export const mediaAttachments = pgTable(
  'media_attachments',
  {
    id: uuid('id').primaryKey(),
    actorId: actorRef('actor_id'),
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'cascade' }),
    type: mediaTypeEnum('type').notNull(),
    mimeType: text('mime_type').notNull(),
    /** Path relative to MEDIA_DIR, for files stored locally. */
    filePath: text('file_path'),
    previewPath: text('preview_path'),
    remoteUrl: text('remote_url'),
    width: integer('width'),
    height: integer('height'),
    blurhash: text('blurhash'),
    description: text('description').notNull().default(''),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index('media_attachments_post_idx').on(t.postId),
    index('media_attachments_actor_idx').on(t.actorId),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey(),
    /** Local actor receiving the notification. */
    actorId: actorRef('actor_id'),
    type: notificationTypeEnum('type').notNull(),
    fromActorId: actorRef('from_actor_id'),
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'cascade' }),
    /** For group notifications (requests, invitations, approvals). */
    groupId: uuid('group_id').references(() => groups.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_actor_idx').on(t.actorId, t.id)],
);

/** URIs of deleted federated objects, so they are never re-created from stale copies. */
export const tombstones = pgTable(
  'tombstones',
  {
    id: uuid('id').primaryKey(),
    uri: text('uri').notNull(),
    actorId: uuid('actor_id').references(() => actors.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('tombstones_uri_idx').on(t.uri)],
);

/** Instance-wide moderation of other servers. */
export const domainBlocks = pgTable(
  'domain_blocks',
  {
    id: uuid('id').primaryKey(),
    domain: text('domain').notNull(),
    /** silence: hidden from public timelines; suspend: no federation at all, content removed. */
    severity: domainBlockSeverityEnum('severity').notNull(),
    publicComment: text('public_comment').notNull().default(''),
    privateComment: text('private_comment').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('domain_blocks_domain_idx').on(t.domain)],
);

/** User reports about accounts and posts. */
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey(),
    reporterActorId: actorRef('reporter_actor_id'),
    targetActorId: actorRef('target_actor_id'),
    postIds: uuid('post_ids').array().notNull().default(sql`'{}'`),
    category: reportCategoryEnum('category').notNull().default('other'),
    comment: text('comment').notNull().default(''),
    /** Whether a copy was sent to the target's server. */
    forwarded: boolean('forwarded').notNull().default(false),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedById: uuid('resolved_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('reports_target_idx').on(t.targetActorId),
    index('reports_open_idx').on(t.id).where(sql`${t.resolvedAt} is null`),
  ],
);

/** Audit trail of moderation actions. */
export const adminActionLogs = pgTable(
  'admin_action_logs',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    details: jsonb('details').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('admin_action_logs_created_idx').on(t.id)],
);

/** Key pairs of the instance itself (the "instance actor" used to sign fetches). One row. */
export const instanceKeys = pgTable('instance_keys', {
  id: text('id').primaryKey(),
  rsaPrivateKeyPem: text('rsa_private_key_pem').notNull(),
  rsaPublicKeyPem: text('rsa_public_key_pem').notNull(),
  ed25519PrivateKeyPem: text('ed25519_private_key_pem').notNull(),
  ed25519PublicKeyPem: text('ed25519_public_key_pem').notNull(),
  /** VAPID key pair for Web Push (base64url), created on first use. */
  vapidPublicKey: text('vapid_public_key'),
  vapidPrivateKey: text('vapid_private_key'),
  createdAt: createdAt(),
});

/** diaspora* relayables (comments, likes) as received, author signature included, for relaying and /fetch. */
export const diasporaRelayables = pgTable(
  'diaspora_relayables',
  {
    guid: text('guid').primaryKey(),
    entityType: text('entity_type').notNull(),
    parentGuid: text('parent_guid').notNull(),
    /** diaspora* ID of the author. */
    author: text('author').notNull(),
    /** Entity XML exactly as signed (order and unknown elements kept). */
    xml: text('xml').notNull(),
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'cascade' }),
    likeId: uuid('like_id').references(() => likes.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [index('diaspora_relayables_parent_idx').on(t.parentGuid)],
);

export type PollOption = {
  title: string;
  votesCount: number;
  /** diaspora* answer guid (remote polls). */
  diasporaGuid?: string;
};

/** A poll attached to a post (ActivityPub Question, diaspora Poll). */
export const polls = pgTable(
  'polls',
  {
    id: uuid('id').primaryKey(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    options: jsonb('options').$type<PollOption[]>().notNull(),
    multiple: boolean('multiple').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    votersCount: integer('voters_count').notNull().default(0),
    /** Set once voters and the author were told that the poll ended. */
    endNotifiedAt: timestamp('end_notified_at', { withTimezone: true }),
    /** diaspora poll guid. */
    diasporaGuid: text('diaspora_guid'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('polls_post_idx').on(t.postId)],
);

export const pollVotes = pgTable(
  'poll_votes',
  {
    id: uuid('id').primaryKey(),
    pollId: uuid('poll_id')
      .notNull()
      .references(() => polls.id, { onDelete: 'cascade' }),
    actorId: actorRef('actor_id'),
    choice: integer('choice').notNull(),
    apUri: text('ap_uri'),
    diasporaGuid: text('diaspora_guid'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('poll_votes_unique_idx').on(t.pollId, t.actorId, t.choice),
    index('poll_votes_actor_idx').on(t.actorId),
  ],
);

export type PushAlerts = Partial<
  Record<
    | 'follow'
    | 'follow_request'
    | 'mention'
    | 'reply'
    | 'reblog'
    | 'like'
    | 'poll'
    | 'group_request'
    | 'group_invite'
    | 'group_accepted',
    boolean
  >
>;

export type MastodonPushData = {
  policy: 'all' | 'followed' | 'follower' | 'none';
  standard: boolean;
  /** The access token, encrypted: Mastodon push payloads carry it. */
  sealedToken: string;
};

/** Browser push subscriptions (Web Push). */
export const webPushSubscriptions = pgTable(
  'web_push_subscriptions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    alerts: jsonb('alerts').$type<PushAlerts>().notNull().default({}),
    /** Set for subscriptions made by a Mastodon app: the access token they belong to. */
    tokenId: uuid('token_id').references(() => oauthAccessTokens.id, { onDelete: 'cascade' }),
    mastodon: jsonb('mastodon').$type<MastodonPushData>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('web_push_subscriptions_endpoint_idx').on(t.endpoint),
    uniqueIndex('web_push_subscriptions_token_idx').on(t.tokenId),
    index('web_push_subscriptions_user_idx').on(t.userId),
  ],
);

export type InstanceSettingsData = {
  title?: string;
  description?: string;
  registrationMode?: 'open' | 'approval' | 'invite' | 'closed';
  rules?: string[];
  contactEmail?: string;
  welcomeAccount?: string;
  welcomeAspect?: string;
  welcomeMessage?: string;
};

/** Settings an administrator can change at run time (one row); environment values are the defaults. */
export const instanceSettings = pgTable('instance_settings', {
  id: text('id').primaryKey(),
  data: jsonb('data').$type<InstanceSettingsData>().notNull().default({}),
  updatedAt: updatedAt(),
});

/** Posts pinned to the top of a local profile (ActivityPub `featured`). */
export const pins = pgTable(
  'pins',
  {
    actorId: actorRef('actor_id'),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.actorId, t.postId] })],
);

export const filterContextEnum = pgEnum('filter_context', [
  'home',
  'public',
  'notifications',
  'thread',
]);

/** Muted words or phrases of a user. */
export const keywordFilters = pgTable(
  'keyword_filters',
  {
    id: uuid('id').primaryKey(),
    actorId: actorRef('actor_id'),
    phrase: text('phrase').notNull(),
    wholeWord: boolean('whole_word').notNull().default(true),
    contexts: filterContextEnum('contexts').array().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('keyword_filters_actor_idx').on(t.actorId)],
);

/** OAuth 2 client applications (Mastodon-compatible apps). */
export const oauthApplications = pgTable(
  'oauth_applications',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    website: text('website'),
    redirectUris: text('redirect_uris').array().notNull().default(sql`'{}'`),
    scopes: text('scopes').array().notNull().default(sql`'{}'`),
    clientId: text('client_id').notNull(),
    clientSecretHash: text('client_secret_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('oauth_applications_client_id_idx').on(t.clientId)],
);

export const oauthAccessGrants = pgTable(
  'oauth_access_grants',
  {
    id: uuid('id').primaryKey(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => oauthApplications.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    redirectUri: text('redirect_uri').notNull(),
    scopes: text('scopes').array().notNull(),
    codeChallenge: text('code_challenge'),
    codeChallengeMethod: text('code_challenge_method'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('oauth_access_grants_code_hash_idx').on(t.codeHash),
    index('oauth_access_grants_expires_idx').on(t.expiresAt),
  ],
);

export const oauthAccessTokens = pgTable(
  'oauth_access_tokens',
  {
    id: uuid('id').primaryKey(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => oauthApplications.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    scopes: text('scopes').array().notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('oauth_access_tokens_token_hash_idx').on(t.tokenHash),
    index('oauth_access_tokens_user_idx').on(t.userId),
    index('oauth_access_tokens_application_idx').on(t.applicationId),
  ],
);

/**
 * Bridge identities: how a remote account appears on the network it doesn't speak. When someone
 * on ActivityPub comments on a local post, diaspora* people see the comment from their bridge
 * identity here (and the other way round), signed with these keys, which are ours.
 */
export const bridgeIdentities = pgTable(
  'bridge_identities',
  {
    id: uuid('id').primaryKey(),
    /** The remote account being bridged. */
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    /** Local username of the bridge identity: `user_at_domain`. */
    username: text('username').notNull(),
    diasporaGuid: text('diaspora_guid').notNull(),
    publicKeyPem: text('public_key_pem').notNull(),
    privateKeyPem: text('private_key_pem').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('bridge_identities_actor_idx').on(t.actorId),
    uniqueIndex('bridge_identities_username_idx').on(sql`lower(${t.username})`),
    uniqueIndex('bridge_identities_guid_idx').on(t.diasporaGuid),
  ],
);
