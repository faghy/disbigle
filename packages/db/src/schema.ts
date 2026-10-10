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
