// In-place migration of a diaspora* pod: reads the pod's database and uploads and writes the same
// people, keys, GUIDs and content into a Disbigle database. See README.md for the mapping rules.
import {
  type CoreContext,
  extractTags,
  localActorUrls,
  type MediaStorage,
  renderMarkdown,
  sanitizeRemoteHtml,
} from '@disbigle/core';
import { type Database, schema, uuidv7 } from '@disbigle/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { publicPemOf, toPkcs8Pem, toSpkiPem } from './keys.ts';
import {
  localPhotoName,
  localUploadName,
  mimeTypeFromName,
  originalName,
  readUpload,
  remotePhotoUrl,
} from './media.ts';
import { isDiasporaPasswordHash, wrapDiasporaPasswordHash } from './password.ts';
import { createPostgresReader } from './source/postgres.ts';
import type {
  AspectRow,
  CommentRow,
  ContactRow,
  ConversationRow,
  DiasporaReader,
  LikeRow,
  PersonRow,
  PhotoRow,
  ReshareRow,
  StatusMessageRow,
} from './source/types.ts';
import {
  convertMentions,
  displayNameOf,
  type MentionTarget,
  mapLocale,
  pollToMarkdown,
  profileDetails,
  splitHandle,
} from './text.ts';

const {
  actors,
  users,
  aspects,
  aspectMemberships,
  follows,
  posts,
  postAudiences,
  postAspects,
  mentions,
  tags,
  postTags,
  likes,
  mediaAttachments,
} = schema;

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Db = Database | Tx;
type PostInsert = typeof posts.$inferInsert;
type PostRow = typeof posts.$inferSelect;

export const PHASES = [
  'people',
  'aspects',
  'contacts',
  'statusMessages',
  'reshares',
  'comments',
  'likes',
  'conversations',
  'counters',
] as const;
export type Phase = (typeof PHASES)[number];

export interface ImportProgress {
  phase: Phase;
  /** Source rows read so far in this phase. */
  processed: number;
  /** Source rows in this phase, when known. */
  total: number | null;
}

export interface ImportOptions {
  /** diaspora's `public/uploads` directory. Without it, local photos keep their old URL. */
  uploadsDir?: string;
  /** Where copied files go. Required together with `uploadsDir` to copy files. */
  mediaStorage?: MediaStorage;
  /** Runs the whole import in a transaction that is rolled back; no file is written. */
  dryRun?: boolean;
  /** Source rows per batch (default 500). */
  batchSize?: number;
  onProgress?: (progress: ImportProgress) => void;
  /**
   * Also import bio, location, gender and birthday of profiles that diaspora* shows only to
   * contacts. Off by default: Disbigle profiles are public.
   */
  includePrivateProfileDetails?: boolean;
  /** Warnings kept in the summary (default 1000); the total is always counted. */
  maxWarnings?: number;
}

export interface EntityCounts {
  /** Rows written by this run. */
  created: number;
  /** Rows already present (earlier run), left as they are or refreshed. */
  existing: number;
  /** Source rows that could not be imported (see warnings). */
  skipped: number;
}

export interface ImportSummary {
  domain: string;
  dryRun: boolean;
  counts: Record<
    | 'localUsers'
    | 'remotePeople'
    | 'aspects'
    | 'aspectMemberships'
    | 'follows'
    | 'posts'
    | 'reshares'
    | 'comments'
    | 'likes'
    | 'conversations'
    | 'messages'
    | 'media',
    EntityCounts
  >;
  /** Local media files copied (or, in a dry run, found). */
  filesCopied: number;
  /** Local media files not found under `uploadsDir`; their old URL is kept. */
  filesMissing: number;
  warnings: string[];
  warningCount: number;
  durationMs: number;
}

export interface ImportParams {
  /** A reader on the diaspora* database, or a PostgreSQL connection URL. */
  source: DiasporaReader | string;
  target: CoreContext;
  options?: ImportOptions;
}

class DryRunRollback extends Error {}

/** What the importer remembers about every diaspora* person it mapped to an actor. */
interface PersonInfo {
  actorId: string;
  local: boolean;
  username: string;
  domain: string | null;
  apUri: string | null;
  apUrl: string | null;
  nsfw: boolean;
}

interface PreparedMedia {
  row: Omit<typeof mediaAttachments.$inferInsert, 'postId' | 'actorId' | 'id'>;
  files: { path: string; data: Buffer }[];
}

const emptyCounts = (): EntityCounts => ({ created: 0, existing: 0, skipped: 0 });
const DISBIGLE_USERNAME = /^[a-zA-Z0-9_]{1,30}$/;
/** UUIDv7 carrying the original creation time, so timelines keep the diaspora* order. */
const idAt = (date: Date) => uuidv7(Math.max(0, Math.min(date.getTime(), Date.now())));
const uniq = <T>(values: Iterable<T>) => [...new Set(values)];

export async function importDiasporaPod(params: ImportParams): Promise<ImportSummary> {
  const reader =
    typeof params.source === 'string' ? createPostgresReader(params.source) : params.source;
  try {
    const importer = new Importer(reader, params.target, params.options ?? {});
    return await importer.run();
  } finally {
    if (typeof params.source === 'string') await reader.close();
  }
}

class Importer {
  private readonly summary: ImportSummary;
  private readonly batchSize: number;
  private readonly maxWarnings: number;
  private readonly localDomain: string;
  private readonly base: string;
  /** diaspora person id → actor. */
  private readonly people = new Map<number, PersonInfo>();
  /** Lowercased diaspora* ID → person id. */
  private readonly handles = new Map<string, number>();
  /** diaspora user id → person id. */
  private readonly userPerson = new Map<number, number>();
  /** diaspora aspect id → Disbigle aspect id. */
  private readonly aspectIds = new Map<number, string>();
  private totals: Record<string, number> = {};
  private db: Db;

  constructor(
    private readonly reader: DiasporaReader,
    private readonly ctx: CoreContext,
    private readonly options: ImportOptions,
  ) {
    this.db = ctx.db;
    this.batchSize = Math.max(1, options.batchSize ?? 500);
    this.maxWarnings = options.maxWarnings ?? 1000;
    this.localDomain = ctx.config.LOCAL_DOMAIN.toLowerCase();
    this.base = ctx.config.PUBLIC_URL;
    this.summary = {
      domain: this.localDomain,
      dryRun: Boolean(options.dryRun),
      counts: {
        localUsers: emptyCounts(),
        remotePeople: emptyCounts(),
        aspects: emptyCounts(),
        aspectMemberships: emptyCounts(),
        follows: emptyCounts(),
        posts: emptyCounts(),
        reshares: emptyCounts(),
        comments: emptyCounts(),
        likes: emptyCounts(),
        conversations: emptyCounts(),
        messages: emptyCounts(),
        media: emptyCounts(),
      },
      filesCopied: 0,
      filesMissing: 0,
      warnings: [],
      warningCount: 0,
      durationMs: 0,
    };
  }

  private warn(message: string): void {
    this.summary.warningCount += 1;
    if (this.summary.warnings.length < this.maxWarnings) this.summary.warnings.push(message);
  }

  async run(): Promise<ImportSummary> {
    const started = Date.now();
    await this.checkDomain();
    this.totals = await this.reader.counts();
    if (this.options.dryRun) {
      try {
        await this.ctx.db.transaction(async (tx) => {
          this.db = tx;
          await this.phases();
          throw new DryRunRollback('dry run');
        });
      } catch (error) {
        if (!(error instanceof DryRunRollback)) throw error;
      } finally {
        this.db = this.ctx.db;
      }
    } else {
      await this.phases();
    }
    this.summary.durationMs = Date.now() - started;
    return this.summary;
  }

  private async phases(): Promise<void> {
    await this.batches(
      'people',
      (after, n) => this.reader.people(after, n),
      (rows) => this.importPeople(rows),
    );
    await this.batches(
      'aspects',
      (after, n) => this.reader.aspects(after, n),
      (rows) => this.importAspects(rows),
    );
    await this.batches(
      'contacts',
      (after, n) => this.reader.contacts(after, n),
      (rows) => this.importContacts(rows),
    );
    await this.batches(
      'statusMessages',
      (after, n) => this.reader.statusMessages(after, n),
      (rows) => this.importStatusMessages(rows),
    );
    await this.batches(
      'reshares',
      (after, n) => this.reader.reshares(after, n),
      (rows) => this.importReshares(rows),
    );
    await this.batches(
      'comments',
      (after, n) => this.reader.comments(after, n),
      (rows) => this.importComments(rows),
    );
    await this.batches(
      'likes',
      (after, n) => this.reader.likes(after, n),
      (rows) => this.importLikes(rows),
    );
    await this.batches(
      'conversations',
      (after, n) => this.reader.conversations(after, n),
      (rows) => this.importConversations(rows),
    );
    this.options.onProgress?.({ phase: 'counters', processed: 0, total: null });
    await this.recomputeCounters();
  }

  private async batches<T extends { id: number }>(
    phase: Phase,
    read: (afterId: number, limit: number) => Promise<T[]>,
    handle: (rows: T[]) => Promise<void>,
  ): Promise<void> {
    let after = 0;
    let processed = 0;
    const total = this.totals[phase] ?? null;
    this.options.onProgress?.({ phase, processed, total });
    for (;;) {
      const rows = await read(after, this.batchSize);
      if (rows.length === 0) break;
      await handle(rows);
      processed += rows.length;
      after = rows[rows.length - 1]?.id ?? after;
      this.options.onProgress?.({ phase, processed, total });
      if (rows.length < this.batchSize) break;
    }
  }

  /** The Disbigle instance must run on the pod's domain, or every handle would change. */
  private async checkDomain(): Promise<void> {
    const handles = await this.reader.localHandles(20);
    const domains = uniq(handles.map((h) => splitHandle(h)?.domain).filter(Boolean));
    if (domains.length > 0 && !domains.includes(this.localDomain)) {
      throw new Error(
        `The diaspora* pod runs on ${domains.join(', ')} but LOCAL_DOMAIN is ${this.localDomain}. ` +
          'An in-place migration must keep the same domain.',
      );
    }
  }

  // ---------------------------------------------------------------------------------------------
  // People

  private remember(person: PersonRow, info: PersonInfo): void {
    this.people.set(person.id, info);
    this.handles.set(person.diasporaHandle.toLowerCase(), person.id);
    if (person.user) this.userPerson.set(person.user.id, person.id);
  }

  private async importPeople(rows: PersonRow[]): Promise<void> {
    const guids = rows.map((p) => p.guid);
    const byGuid = new Map(
      (await this.db.select().from(actors).where(inArray(actors.diasporaGuid, guids))).map((a) => [
        a.diasporaGuid,
        a,
      ]),
    );
    for (const person of rows) {
      if (person.user) await this.importLocalPerson(person, byGuid.get(person.guid));
      else await this.importRemotePerson(person, byGuid.get(person.guid));
    }
  }

  private avatarFor(person: PersonRow): Promise<string | null> {
    const url = person.profile?.imageUrl ?? null;
    if (!url) return Promise.resolve(null);
    if (!person.user) {
      const parsed = this.absoluteUrl(url, this.podBase(person));
      return Promise.resolve(parsed);
    }
    return this.copyAvatar(url);
  }

  private absoluteUrl(url: string, base: string): string | null {
    try {
      return new URL(url, base).href;
    } catch {
      return null;
    }
  }

  /** Copies a local profile image into media storage; falls back to the old URL. */
  private async copyAvatar(url: string): Promise<string | null> {
    const absolute = this.absoluteUrl(url, `https://${this.localDomain}/`);
    const name = localUploadName(url, this.localDomain);
    const { uploadsDir, mediaStorage } = this.options;
    if (!name || !uploadsDir || !mediaStorage) return absolute;
    for (const candidate of uniq([name, originalName(name)])) {
      const data = await readUpload(uploadsDir, candidate);
      if (!data) continue;
      const path = `diaspora/avatars/${candidate}`;
      if (!this.options.dryRun) await mediaStorage.put(path, data);
      this.summary.filesCopied += 1;
      return `${this.base}/media/${path}`;
    }
    this.summary.filesMissing += 1;
    this.warn(`Avatar file ${name} not found in ${uploadsDir}/images; keeping ${absolute}`);
    return absolute;
  }

  private podBase(person: PersonRow): string {
    const pod = person.pod;
    const domain = splitHandle(person.diasporaHandle)?.domain ?? this.localDomain;
    if (!pod) return `https://${domain}/`;
    const port = pod.port && pod.port !== (pod.ssl ? 443 : 80) ? `:${pod.port}` : '';
    return `${pod.ssl ? 'https' : 'http'}://${pod.host}${port}/`;
  }

  private async importLocalPerson(
    person: PersonRow,
    existing: typeof actors.$inferSelect | undefined,
  ): Promise<void> {
    const user = person.user;
    if (!user) return;
    const counts = this.summary.counts.localUsers;
    const handle = splitHandle(person.diasporaHandle);
    const username = user.username || handle?.username || '';
    if (!handle || handle.domain !== this.localDomain) {
      counts.skipped += 1;
      this.warn(`Local user ${username} has handle ${person.diasporaHandle} on another domain`);
      return;
    }
    if (!DISBIGLE_USERNAME.test(username)) {
      this.warn(
        `Username "${username}" does not follow Disbigle's rules (1–30 letters, digits, _); ` +
          'it is kept for federation, but @mentions cannot address it',
      );
    }
    const nsfw = person.profile?.nsfw ?? false;
    const details = profileDetails(
      person.profile,
      Boolean(this.options.includePrivateProfileDetails),
    );
    const role = person.roles.includes('admin')
      ? 'admin'
      : person.roles.includes('moderator')
        ? 'moderator'
        : 'user';
    const disabledAt = person.closedAccount ? (user.lockedAt ?? new Date()) : user.lockedAt;
    const passwordHash = wrapDiasporaPasswordHash(user.encryptedPassword);

    if (existing) {
      if (existing.domain !== null) {
        counts.skipped += 1;
        this.warn(`GUID ${person.guid} of local user ${username} belongs to a remote actor`);
        return;
      }
      this.remember(person, {
        actorId: existing.id,
        local: true,
        username: existing.username,
        domain: null,
        apUri: existing.apUri,
        apUrl: existing.apUrl,
        nsfw,
      });
      counts.existing += 1;
      // Refresh accounts nobody has used on Disbigle yet (still on the diaspora* password), so
      // a second run at switch-over picks up what changed on the pod since the first one.
      const [current] = await this.db.select().from(users).where(eq(users.actorId, existing.id));
      if (current && isDiasporaPasswordHash(current.passwordHash)) {
        await this.db
          .update(users)
          .set({
            ...(passwordHash ? { passwordHash } : {}),
            role,
            locale: mapLocale(user.language),
            disabledAt,
            updatedAt: new Date(),
          })
          .where(eq(users.id, current.id));
        await this.db
          .update(actors)
          .set({
            displayName: displayNameOf(person.profile, username),
            summary: details.bio,
            fields: details.fields,
            avatarUrl: await this.avatarFor(person),
            discoverable: person.profile?.searchable ?? true,
            suspendedAt: person.closedAccount ? (existing.suspendedAt ?? new Date()) : null,
            updatedAt: new Date(),
          })
          .where(eq(actors.id, existing.id));
      }
      return;
    }

    const [taken] = await this.db
      .select({ id: actors.id })
      .from(actors)
      .where(and(sql`lower(${actors.username}) = lower(${username})`, isNull(actors.domain)));
    if (taken) {
      counts.skipped += 1;
      this.warn(
        `Local username ${username} already exists on Disbigle with another GUID; not imported`,
      );
      return;
    }

    let privateKeyPem: string;
    let publicKeyPem: string;
    try {
      if (!user.serializedPrivateKey) throw new Error('missing private key');
      privateKeyPem = toPkcs8Pem(user.serializedPrivateKey);
      const derived = publicPemOf(privateKeyPem);
      publicKeyPem = derived;
      try {
        const published = toSpkiPem(person.serializedPublicKey);
        if (published !== derived) {
          this.warn(
            `Public key of ${person.diasporaHandle} does not match its private key; using the one derived from the private key`,
          );
        }
      } catch {
        this.warn(`Public key of ${person.diasporaHandle} is unreadable; derived from private key`);
      }
    } catch (error) {
      counts.skipped += 1;
      this.warn(`Local user ${username}: unusable private key (${(error as Error).message})`);
      return;
    }
    if (!passwordHash) {
      this.warn(`User ${username} has no usable password hash; they must reset their password`);
    }

    let email = user.email.trim();
    const [emailTaken] = email
      ? await this.db
          .select({ id: users.id })
          .from(users)
          .where(sql`lower(${users.email}) = lower(${email})`)
      : [];
    if (!email || emailTaken) {
      this.warn(
        `User ${username}: email "${email}" is empty or already used; a placeholder is set`,
      );
      email = `${username}.${person.guid}@invalid.invalid`;
    }

    const avatarUrl = await this.avatarFor(person);
    const actorId = idAt(user.createdAt);
    const urls = localActorUrls(this.ctx.config, username, person.guid);
    await this.db.transaction(async (tx) => {
      await tx.insert(actors).values({
        id: actorId,
        username,
        domain: null,
        displayName: displayNameOf(person.profile, username),
        summary: details.bio,
        fields: details.fields,
        avatarUrl,
        discoverable: person.profile?.searchable ?? true,
        publicKeyPem,
        diasporaGuid: person.guid,
        protocols: ['activitypub', 'diaspora'],
        suspendedAt: person.closedAccount ? disabledAt : null,
        createdAt: user.createdAt,
        ...urls,
      });
      await tx.insert(users).values({
        id: idAt(user.createdAt),
        actorId,
        email,
        passwordHash: passwordHash ?? '!no-password',
        privateKeyPem,
        role,
        locale: mapLocale(user.language),
        approved: true,
        disabledAt,
        lastSignInAt: user.lastSignInAt,
        createdAt: user.createdAt,
      });
    });
    this.remember(person, {
      actorId,
      local: true,
      username,
      domain: null,
      apUri: urls.apUri,
      apUrl: urls.apUrl,
      nsfw,
    });
    counts.created += 1;
  }

  private async importRemotePerson(
    person: PersonRow,
    existingByGuid: typeof actors.$inferSelect | undefined,
  ): Promise<void> {
    const counts = this.summary.counts.remotePeople;
    const handle = splitHandle(person.diasporaHandle);
    if (!handle) {
      counts.skipped += 1;
      this.warn(`Person ${person.id} has an invalid handle "${person.diasporaHandle}"`);
      return;
    }
    if (handle.domain === this.localDomain) {
      counts.skipped += 1;
      this.warn(`Person ${person.diasporaHandle} is on this pod but has no user; skipped`);
      return;
    }
    const nsfw = person.profile?.nsfw ?? false;
    const remember = (a: typeof actors.$inferSelect) =>
      this.remember(person, {
        actorId: a.id,
        local: false,
        username: a.username,
        domain: a.domain,
        apUri: a.apUri,
        apUrl: a.apUrl,
        nsfw,
      });

    const base = this.podBase(person);
    const receiveUrl = `${base}receive/users/${person.guid}`;
    if (existingByGuid) {
      remember(existingByGuid);
      counts.existing += 1;
      return;
    }
    const [byHandle] = await this.db
      .select()
      .from(actors)
      .where(
        and(
          sql`lower(${actors.username}) = lower(${handle.username})`,
          sql`lower(${actors.domain}) = ${handle.domain}`,
        ),
      );
    if (byHandle) {
      // Known through ActivityPub: add the diaspora* identity.
      if (!byHandle.diasporaGuid) {
        await this.db
          .update(actors)
          .set({
            diasporaGuid: person.guid,
            diasporaReceiveUrl: receiveUrl,
            protocols: uniq([...byHandle.protocols, 'diaspora' as const]),
            updatedAt: new Date(),
          })
          .where(eq(actors.id, byHandle.id));
      }
      remember(byHandle);
      counts.existing += 1;
      return;
    }
    if (person.closedAccount) {
      counts.skipped += 1;
      return;
    }
    let publicKeyPem: string;
    try {
      publicKeyPem = toSpkiPem(person.serializedPublicKey);
    } catch {
      counts.skipped += 1;
      this.warn(`Person ${person.diasporaHandle} has an unreadable public key; skipped`);
      return;
    }
    const details = profileDetails(
      person.profile,
      Boolean(this.options.includePrivateProfileDetails),
    );
    const summary = details.bio
      ? sanitizeRemoteHtml(
          renderMarkdown(details.bio, {
            resolveMention: () => null,
            tagUrl: (tag) => `${this.base}/tags/${encodeURIComponent(tag)}`,
          }),
        ).slice(0, 20000)
      : '';
    const [created] = await this.db
      .insert(actors)
      .values({
        id: idAt(person.createdAt),
        username: handle.username,
        domain: handle.domain,
        displayName: displayNameOf(person.profile, handle.username),
        summary,
        fields: details.fields,
        avatarUrl: await this.avatarFor(person),
        discoverable: person.profile?.searchable ?? true,
        publicKeyPem,
        apUrl: `${base}people/${person.guid}`,
        diasporaGuid: person.guid,
        diasporaReceiveUrl: receiveUrl,
        protocols: ['diaspora'],
        preferredProtocol: 'diaspora',
        createdAt: person.createdAt,
      })
      .onConflictDoNothing()
      .returning();
    if (!created) {
      counts.skipped += 1;
      this.warn(`Person ${person.diasporaHandle} conflicts with an existing account; skipped`);
      return;
    }
    remember(created);
    counts.created += 1;
  }

  // ---------------------------------------------------------------------------------------------
  // Aspects and contacts

  private localActorOfUser(userId: number): PersonInfo | null {
    const personId = this.userPerson.get(userId);
    const info = personId === undefined ? undefined : this.people.get(personId);
    return info?.local ? info : null;
  }

  private async importAspects(rows: AspectRow[]): Promise<void> {
    const counts = this.summary.counts.aspects;
    for (const aspect of rows) {
      const owner = this.localActorOfUser(aspect.userId);
      if (!owner) {
        counts.skipped += 1;
        continue;
      }
      const name = aspect.name.trim().slice(0, 100) || `Aspect ${aspect.id}`;
      const [created] = await this.db
        .insert(aspects)
        .values({
          id: idAt(aspect.createdAt),
          ownerActorId: owner.actorId,
          name,
          position: aspect.orderId ?? aspect.id,
          createdAt: aspect.createdAt,
        })
        .onConflictDoNothing()
        .returning({ id: aspects.id });
      if (created) {
        this.aspectIds.set(aspect.id, created.id);
        counts.created += 1;
        continue;
      }
      const [existing] = await this.db
        .select({ id: aspects.id })
        .from(aspects)
        .where(
          and(
            eq(aspects.ownerActorId, owner.actorId),
            sql`lower(${aspects.name}) = lower(${name})`,
          ),
        );
      if (existing) {
        this.aspectIds.set(aspect.id, existing.id);
        counts.existing += 1;
      } else {
        counts.skipped += 1;
      }
    }
  }

  /**
   * diaspora* contacts are one row per (local user, person) with two flags (see contact.rb):
   * `sharing` — the person shares with the user, so the user receives the person's posts;
   * `receiving` — the user shares with the person, so the person receives the user's posts.
   * In follow terms: `sharing` = user follows person, `receiving` = person follows user.
   */
  private async importContacts(rows: ContactRow[]): Promise<void> {
    const followCounts = this.summary.counts.follows;
    const memberCounts = this.summary.counts.aspectMemberships;
    const followRows: (typeof follows.$inferInsert)[] = [];
    const memberRows: (typeof aspectMemberships.$inferInsert)[] = [];
    for (const contact of rows) {
      const user = this.localActorOfUser(contact.userId);
      const person = this.people.get(contact.personId);
      if (!user || !person || user.actorId === person.actorId) {
        followCounts.skipped += Number(contact.sharing) + Number(contact.receiving);
        memberCounts.skipped += contact.aspectIds.length;
        continue;
      }
      if (contact.sharing) {
        followRows.push({
          id: idAt(contact.createdAt),
          actorId: user.actorId,
          targetActorId: person.actorId,
          createdAt: contact.createdAt,
        });
      }
      if (contact.receiving) {
        followRows.push({
          id: idAt(contact.createdAt),
          actorId: person.actorId,
          targetActorId: user.actorId,
          createdAt: contact.createdAt,
        });
      }
      for (const aspectId of contact.aspectIds) {
        const mapped = this.aspectIds.get(aspectId);
        if (!mapped) {
          memberCounts.skipped += 1;
          continue;
        }
        memberRows.push({
          aspectId: mapped,
          actorId: person.actorId,
          createdAt: contact.createdAt,
        });
      }
    }
    if (followRows.length > 0) {
      const inserted = await this.db
        .insert(follows)
        .values(followRows)
        .onConflictDoNothing()
        .returning({ id: follows.id });
      followCounts.created += inserted.length;
      followCounts.existing += followRows.length - inserted.length;
    }
    if (memberRows.length > 0) {
      const inserted = await this.db
        .insert(aspectMemberships)
        .values(memberRows)
        .onConflictDoNothing()
        .returning({ aspectId: aspectMemberships.aspectId });
      memberCounts.created += inserted.length;
      memberCounts.existing += memberRows.length - inserted.length;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Text

  private mentionTarget = (diasporaId: string): MentionTarget | null => {
    const personId = this.handles.get(diasporaId);
    const info = personId === undefined ? undefined : this.people.get(personId);
    if (!info) return null;
    return { username: info.username, domain: info.domain, url: info.apUrl };
  };

  /** Converts diaspora* markdown to Disbigle markdown and renders it like the core does. */
  private render(text: string): { source: string; html: string; tags: string[] } {
    const source = convertMentions(text, this.mentionTarget);
    const html = renderMarkdown(source, {
      resolveMention: (username, domain) => {
        const id = `${username}@${domain ?? this.localDomain}`.toLowerCase();
        return this.mentionTarget(id)?.url ?? null;
      },
      tagUrl: (tag) => `${this.base}/tags/${encodeURIComponent(tag)}`,
      localOrigin: new URL(this.base).origin,
    });
    return { source, html, tags: extractTags(source) };
  }

  private actorIdsOfPeople(personIds: number[]): string[] {
    return uniq(
      personIds.map((id) => this.people.get(id)?.actorId).filter((id): id is string => !!id),
    );
  }

  private actorIdsOfUsers(userIds: number[]): string[] {
    return uniq(
      userIds.map((id) => this.localActorOfUser(id)?.actorId).filter((id): id is string => !!id),
    );
  }

  private async existingPostGuids(guids: string[]): Promise<Set<string>> {
    if (guids.length === 0) return new Set();
    const rows = await this.db
      .select({ guid: posts.diasporaGuid })
      .from(posts)
      .where(inArray(posts.diasporaGuid, guids));
    return new Set(rows.map((r) => r.guid).filter((g): g is string => !!g));
  }

  private async postsByGuid(guids: string[]): Promise<Map<string, PostRow>> {
    const list = uniq(guids.filter(Boolean));
    if (list.length === 0) return new Map();
    const rows = await this.db.select().from(posts).where(inArray(posts.diasporaGuid, list));
    // Interactions with a reshare go to the reshared post, as in the core.
    const reblogOf = uniq(rows.map((r) => r.reblogOfId).filter((id): id is string => !!id));
    const originals = new Map(
      reblogOf.length > 0
        ? (await this.db.select().from(posts).where(inArray(posts.id, reblogOf))).map((p) => [
            p.id,
            p,
          ])
        : [],
    );
    const result = new Map<string, PostRow>();
    for (const row of rows) {
      const target = row.reblogOfId ? originals.get(row.reblogOfId) : row;
      if (row.diasporaGuid && target) result.set(row.diasporaGuid, target);
    }
    return result;
  }

  private async audiencesOf(postIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (postIds.length === 0) return map;
    const rows = await this.db
      .select()
      .from(postAudiences)
      .where(inArray(postAudiences.postId, uniq(postIds)));
    for (const row of rows) {
      const list = map.get(row.postId);
      if (list) list.push(row.actorId);
      else map.set(row.postId, [row.actorId]);
    }
    return map;
  }

  /** Local URLs for a post of a local author, as the core builds them. */
  private localPostUrls(author: PersonInfo, id: string) {
    return author.local
      ? { apUri: `${author.apUri}/statuses/${id}`, apUrl: `${this.base}/@${author.username}/${id}` }
      : { apUri: null, apUrl: null };
  }

  /** Writes posts with their audience, aspects, mentions, tags and media in one transaction. */
  private async writePosts(
    items: {
      row: PostInsert;
      audience: string[];
      aspectIds?: string[];
      mentionIds: string[];
      tags: string[];
      media?: PreparedMedia[];
    }[],
  ): Promise<void> {
    if (items.length === 0) return;
    const tagNames = uniq(items.flatMap((i) => i.tags)).filter((t) => t.length <= 100);
    await this.db.transaction(async (tx) => {
      await tx.insert(posts).values(items.map((i) => i.row));
      const audienceRows = items.flatMap((i) =>
        uniq(i.audience)
          .filter((a) => a !== i.row.actorId)
          .map((actorId) => ({ postId: i.row.id, actorId })),
      );
      if (audienceRows.length > 0)
        await tx.insert(postAudiences).values(audienceRows).onConflictDoNothing();
      const aspectRows = items.flatMap((i) =>
        uniq(i.aspectIds ?? []).map((aspectId) => ({ postId: i.row.id, aspectId })),
      );
      if (aspectRows.length > 0)
        await tx.insert(postAspects).values(aspectRows).onConflictDoNothing();
      const mentionRows = items.flatMap((i) =>
        uniq(i.mentionIds)
          .filter((a) => a !== i.row.actorId)
          .map((actorId) => ({ postId: i.row.id, actorId })),
      );
      if (mentionRows.length > 0)
        await tx.insert(mentions).values(mentionRows).onConflictDoNothing();
      if (tagNames.length > 0) {
        await tx
          .insert(tags)
          .values(tagNames.map((name) => ({ id: uuidv7(), name })))
          .onConflictDoNothing();
        const tagRows = await tx
          .select({ id: tags.id, name: tags.name })
          .from(tags)
          .where(inArray(tags.name, tagNames));
        const tagId = new Map(tagRows.map((t) => [t.name, t.id]));
        const postTagRows = items.flatMap((i) =>
          uniq(i.tags)
            .map((name) => tagId.get(name))
            .filter((id): id is string => !!id)
            .map((id) => ({ postId: i.row.id, tagId: id })),
        );
        if (postTagRows.length > 0)
          await tx.insert(postTags).values(postTagRows).onConflictDoNothing();
      }
      const mediaRows = items.flatMap((i) =>
        (i.media ?? []).map((m, position) => ({
          ...m.row,
          id: uuidv7(),
          actorId: i.row.actorId,
          postId: i.row.id,
          position,
          createdAt: i.row.createdAt,
        })),
      );
      if (mediaRows.length > 0) await tx.insert(mediaAttachments).values(mediaRows);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Status messages

  private async prepareMedia(photo: PhotoRow, author: PersonInfo): Promise<PreparedMedia | null> {
    const counts = this.summary.counts.media;
    const description = (photo.text ?? '').slice(0, 1500);
    const base = { width: photo.width, height: photo.height, description };
    const name = author.local ? localPhotoName(photo) : null;
    const remoteUrl =
      remotePhotoUrl(photo) ?? (name ? `${this.base}/uploads/images/${name}` : null);
    const { uploadsDir, mediaStorage } = this.options;
    if (name && uploadsDir && mediaStorage) {
      const data = await readUpload(uploadsDir, name);
      if (data) {
        const files = [{ path: `diaspora/images/${name}`, data }];
        let previewPath: string | null = null;
        for (const prefix of ['scaled_full_', 'thumb_large_']) {
          const preview = await readUpload(uploadsDir, `${prefix}${name}`);
          if (preview) {
            previewPath = `diaspora/images/${prefix}${name}`;
            files.push({ path: previewPath, data: preview });
            break;
          }
        }
        counts.created += 1;
        return {
          row: {
            ...base,
            type: 'image',
            mimeType: mimeTypeFromName(name),
            filePath: files[0]?.path ?? null,
            previewPath,
          },
          files,
        };
      }
      this.summary.filesMissing += 1;
      this.warn(`Photo ${photo.guid}: file ${name} not found; keeping its old URL`);
    }
    if (!remoteUrl) {
      counts.skipped += 1;
      this.warn(`Photo ${photo.guid} has no file and no URL; skipped`);
      return null;
    }
    counts.created += 1;
    return {
      row: { ...base, type: 'image', mimeType: mimeTypeFromName(remoteUrl), remoteUrl },
      files: [],
    };
  }

  private async storeFiles(media: PreparedMedia[]): Promise<void> {
    for (const item of media) {
      for (const file of item.files) {
        if (!this.options.dryRun) await this.options.mediaStorage?.put(file.path, file.data);
        this.summary.filesCopied += 1;
      }
    }
  }

  private async aspectMembers(aspectIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (aspectIds.length === 0) return map;
    const rows = await this.db
      .select()
      .from(aspectMemberships)
      .where(inArray(aspectMemberships.aspectId, uniq(aspectIds)));
    for (const row of rows) {
      const list = map.get(row.aspectId);
      if (list) list.push(row.actorId);
      else map.set(row.aspectId, [row.actorId]);
    }
    return map;
  }

  private async importStatusMessages(rows: StatusMessageRow[]): Promise<void> {
    const counts = this.summary.counts.posts;
    const existing = await this.existingPostGuids(rows.map((r) => r.guid));
    const fresh = rows.filter((r) => {
      if (existing.has(r.guid)) counts.existing += 1;
      return !existing.has(r.guid);
    });
    const mappedAspects = (r: StatusMessageRow) =>
      r.aspectIds.map((id) => this.aspectIds.get(id)).filter((id): id is string => !!id);
    const members = await this.aspectMembers(fresh.flatMap(mappedAspects));

    const items = [];
    for (const message of fresh) {
      const author = this.people.get(message.authorId);
      if (!author) {
        counts.skipped += 1;
        this.warn(`Post ${message.guid}: author (person ${message.authorId}) not imported`);
        continue;
      }
      let text = message.text;
      if (message.poll) text = `${text.trim()}\n\n${pollToMarkdown(message.poll)}`.trim();
      const rendered = this.render(text);
      const mentionIds = this.actorIdsOfPeople(message.mentionedPersonIds);
      const aspectIds = author.local ? mappedAspects(message) : [];
      const audience = message.public
        ? mentionIds
        : [
            ...this.actorIdsOfUsers(message.recipientUserIds),
            ...aspectIds.flatMap((id) => members.get(id) ?? []),
          ];
      const media: PreparedMedia[] = [];
      for (const photo of message.photos) {
        const prepared = await this.prepareMedia(photo, author);
        if (prepared) media.push(prepared);
      }
      const id = idAt(message.createdAt);
      items.push({
        row: {
          id,
          actorId: author.actorId,
          local: author.local,
          visibility: message.public ? ('public' as const) : ('limited' as const),
          source: author.local ? rendered.source : null,
          contentHtml: rendered.html,
          sensitive: author.nsfw,
          threadRootId: id,
          diasporaGuid: message.guid,
          createdAt: message.createdAt,
          ...this.localPostUrls(author, id),
        },
        audience,
        aspectIds,
        mentionIds,
        tags: uniq([...rendered.tags, ...message.tags.map((t) => t.toLowerCase())]),
        media,
      });
    }
    await this.storeFiles(items.flatMap((i) => i.media));
    await this.writePosts(items);
    counts.created += items.length;
  }

  // ---------------------------------------------------------------------------------------------
  // Reshares, comments, likes

  private async importReshares(rows: ReshareRow[]): Promise<void> {
    const counts = this.summary.counts.reshares;
    const existing = await this.existingPostGuids(rows.map((r) => r.guid));
    const roots = await this.postsByGuid(rows.map((r) => r.rootGuid ?? ''));
    for (const reshare of rows) {
      if (existing.has(reshare.guid)) {
        counts.existing += 1;
        continue;
      }
      const author = this.people.get(reshare.authorId);
      const root = reshare.rootGuid ? roots.get(reshare.rootGuid) : undefined;
      if (!author || !root || (root.visibility !== 'public' && root.visibility !== 'unlisted')) {
        counts.skipped += 1;
        if (author && !root)
          this.warn(`Reshare ${reshare.guid}: reshared post ${reshare.rootGuid} is not available`);
        continue;
      }
      const id = idAt(reshare.createdAt);
      const inserted = await this.db
        .insert(posts)
        .values({
          id,
          actorId: author.actorId,
          local: author.local,
          visibility: root.visibility,
          reblogOfId: root.id,
          threadRootId: id,
          apUri: author.local ? `${author.apUri}/statuses/${id}/activity` : null,
          diasporaGuid: reshare.guid,
          createdAt: reshare.createdAt,
        })
        .onConflictDoNothing()
        .returning({ id: posts.id });
      if (inserted.length > 0) counts.created += 1;
      else counts.existing += 1;
    }
  }

  private async importComments(rows: CommentRow[]): Promise<void> {
    const counts = this.summary.counts.comments;
    const existing = await this.existingPostGuids(rows.map((r) => r.guid));
    const fresh = rows.filter((r) => {
      if (existing.has(r.guid)) counts.existing += 1;
      return !existing.has(r.guid);
    });
    const parents = await this.postsByGuid(fresh.map((r) => r.parentGuid));
    const audiences = await this.audiencesOf(
      [...parents.values()].filter((p) => !isPublic(p)).map((p) => p.id),
    );
    const items = [];
    for (const comment of fresh) {
      const author = this.people.get(comment.authorId);
      const parent = parents.get(comment.parentGuid);
      if (!author || !parent) {
        counts.skipped += 1;
        this.warn(
          `Comment ${comment.guid}: ${author ? `post ${comment.parentGuid}` : 'author'} not imported`,
        );
        continue;
      }
      const rendered = this.render(comment.text);
      const mentionIds = this.actorIdsOfPeople(comment.mentionedPersonIds);
      // Comments live in the conversation of their post: private posts keep their audience.
      const audience = isPublic(parent)
        ? mentionIds
        : [...(audiences.get(parent.id) ?? []), parent.actorId];
      const id = idAt(comment.createdAt);
      items.push({
        row: {
          id,
          actorId: author.actorId,
          local: author.local,
          visibility: parent.visibility,
          source: author.local ? rendered.source : null,
          contentHtml: rendered.html,
          sensitive: author.nsfw,
          inReplyToId: parent.id,
          inReplyToActorId: parent.actorId,
          threadRootId: parent.threadRootId ?? parent.id,
          diasporaGuid: comment.guid,
          createdAt: comment.createdAt,
          ...this.localPostUrls(author, id),
        },
        audience,
        mentionIds,
        tags: uniq([...rendered.tags, ...comment.tags.map((t) => t.toLowerCase())]),
      });
    }
    await this.writePosts(items);
    counts.created += items.length;
  }

  private async importLikes(rows: LikeRow[]): Promise<void> {
    const counts = this.summary.counts.likes;
    const targets = await this.postsByGuid(rows.map((r) => r.targetGuid));
    const values: (typeof likes.$inferInsert)[] = [];
    for (const like of rows) {
      const author = this.people.get(like.authorId);
      const target = targets.get(like.targetGuid);
      if (!author || !target) {
        counts.skipped += 1;
        continue;
      }
      const id = idAt(like.createdAt);
      values.push({
        id,
        actorId: author.actorId,
        postId: target.id,
        apUri: author.local ? `${author.apUri}#likes/${id}` : null,
        diasporaGuid: like.guid,
        createdAt: like.createdAt,
      });
    }
    if (values.length === 0) return;
    const inserted = await this.db
      .insert(likes)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: likes.id });
    counts.created += inserted.length;
    counts.existing += values.length - inserted.length;
  }

  // ---------------------------------------------------------------------------------------------
  // Conversations

  /**
   * One direct thread per conversation, as the diaspora* bridge stores them: the root post
   * carries the conversation GUID and `**subject**` + the first message; every other message is
   * a reply to the root carrying its own GUID.
   */
  private async importConversations(rows: ConversationRow[]): Promise<void> {
    const convCounts = this.summary.counts.conversations;
    const msgCounts = this.summary.counts.messages;
    const roots = await this.postsByGuid(rows.map((r) => r.guid));
    const existingMessages = await this.existingPostGuids(
      rows.flatMap((r) => r.messages.map((m) => m.guid)),
    );
    const rootAudiences = await this.audiencesOf([...roots.values()].map((p) => p.id));

    for (const conversation of rows) {
      const [first, ...rest] = conversation.messages;
      let root = roots.get(conversation.guid);
      let rootAudience = root ? (rootAudiences.get(root.id) ?? []) : [];
      if (root) {
        convCounts.existing += 1;
      } else {
        const author = this.people.get(conversation.authorId);
        if (!author) {
          convCounts.skipped += 1;
          msgCounts.skipped += conversation.messages.length;
          this.warn(`Conversation ${conversation.guid}: author not imported`);
          continue;
        }
        rootAudience = this.actorIdsOfPeople(conversation.participantPersonIds).filter(
          (id) => id !== author.actorId,
        );
        const subject = conversation.subject?.trim() ?? '';
        const text = [subject ? `**${subject}**` : '', first?.text ?? '']
          .filter(Boolean)
          .join('\n\n');
        const rendered = this.render(text);
        const createdAt = first?.createdAt ?? conversation.createdAt;
        const id = idAt(createdAt);
        const row: PostInsert = {
          id,
          actorId: author.actorId,
          local: author.local,
          visibility: 'direct',
          source: author.local ? rendered.source : null,
          contentHtml: rendered.html,
          threadRootId: id,
          diasporaGuid: conversation.guid,
          createdAt,
          ...this.localPostUrls(author, id),
        };
        await this.writePosts([
          { row, audience: rootAudience, mentionIds: [], tags: rendered.tags },
        ]);
        root = { ...row, reblogOfId: null } as PostRow;
        convCounts.created += 1;
        if (first) msgCounts.created += 1;
      }

      const parent = root;
      const items = [];
      for (const message of rest) {
        if (existingMessages.has(message.guid)) {
          msgCounts.existing += 1;
          continue;
        }
        const author = this.people.get(message.authorId);
        if (!author) {
          msgCounts.skipped += 1;
          continue;
        }
        const rendered = this.render(message.text);
        const id = idAt(message.createdAt);
        items.push({
          row: {
            id,
            actorId: author.actorId,
            local: author.local,
            visibility: 'direct' as const,
            source: author.local ? rendered.source : null,
            contentHtml: rendered.html,
            inReplyToId: parent.id,
            inReplyToActorId: parent.actorId,
            threadRootId: parent.id,
            diasporaGuid: message.guid,
            createdAt: message.createdAt,
            ...this.localPostUrls(author, id),
          },
          audience: [...rootAudience, parent.actorId],
          mentionIds: [],
          tags: rendered.tags,
        });
      }
      await this.writePosts(items);
      msgCounts.created += items.length;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Counters

  private async recomputeCounters(): Promise<void> {
    await this.db.execute(sql`
      update ${posts} p set replies_count = c.n
        from (select in_reply_to_id as id, count(*)::int as n from ${posts}
               where in_reply_to_id is not null group by in_reply_to_id) c
       where p.id = c.id and p.replies_count <> c.n`);
    await this.db.execute(sql`
      update ${posts} p set reblogs_count = c.n
        from (select reblog_of_id as id, count(*)::int as n from ${posts}
               where reblog_of_id is not null group by reblog_of_id) c
       where p.id = c.id and p.reblogs_count <> c.n`);
    await this.db.execute(sql`
      update ${posts} p set likes_count = c.n
        from (select post_id as id, count(*)::int as n from ${likes} group by post_id) c
       where p.id = c.id and p.likes_count <> c.n`);
  }
}

const isPublic = (post: PostRow) => post.visibility === 'public' || post.visibility === 'unlisted';
