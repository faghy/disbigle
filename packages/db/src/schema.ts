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
    fields: jsonb('fields').$type<ProfileField[]>().notNull().default([]),
    locked: boolean('locked').notNull().default(false),
    discoverable: boolean('discoverable').notNull().default(true),
    bot: boolean('bot').notNull().default(false),
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
