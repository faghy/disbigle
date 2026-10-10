// A DiasporaReader on top of any SQL engine. The queries are portable between PostgreSQL and
// MySQL (`?` placeholders, no engine-specific casts); results are normalised here, so a MySQL
// reader only needs a `SqlClient` that runs a query and returns plain rows.
import type {
  AspectRow,
  CommentRow,
  ContactRow,
  ConversationRow,
  DiasporaReader,
  LikeRow,
  MessageRow,
  PersonRow,
  PhotoRow,
  PollRow,
  ReshareRow,
  StatusMessageRow,
} from './types.ts';

type Row = Record<string, unknown>;

export interface SqlClient {
  /** Runs a query with `?` placeholders and returns its rows. */
  query(sql: string, params?: unknown[]): Promise<Row[]>;
  close(): Promise<void>;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
/** PostgreSQL returns booleans, MySQL returns 0/1. */
const bool = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 't';
const date = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const dateOrNull = (v: unknown): Date | null => (v === null || v === undefined ? null : date(v));
const dayOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

function groupBy<T>(rows: T[], key: (row: T) => number | string): Map<number | string, T[]> {
  const map = new Map<number | string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

export class SqlDiasporaReader implements DiasporaReader {
  constructor(private readonly client: SqlClient) {}

  private q(sql: string, params: unknown[] = []): Promise<Row[]> {
    return this.client.query(sql, params);
  }

  /** Runs `sql` with an `IN (…)` list; returns nothing for an empty list. */
  private qIn(sql: string, ids: unknown[], params: unknown[] = []): Promise<Row[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.q(sql.replace('(:ids)', `(${placeholders(ids.length)})`), [...params, ...ids]);
  }

  async localHandles(limit: number): Promise<string[]> {
    const rows = await this.q(
      'select diaspora_handle from people where owner_id is not null order by id limit ?',
      [limit],
    );
    return rows.map((r) => str(r.diaspora_handle));
  }

  async people(afterId: number, limit: number): Promise<PersonRow[]> {
    const rows = await this.q(
      `select p.id, p.guid, p.diaspora_handle, p.serialized_public_key, p.owner_id,
              p.closed_account, p.created_at,
              po.host as pod_host, po.ssl as pod_ssl, po.port as pod_port,
              pr.id as profile_id, pr.first_name, pr.last_name, pr.image_url, pr.bio, pr.location,
              pr.birthday, pr.gender, pr.searchable, pr.nsfw, pr.public_details,
              u.id as user_id, u.username, u.email, u.encrypted_password, u.serialized_private_key,
              u.language, u.locked_at, u.last_sign_in_at, u.created_at as user_created_at
         from people p
         left join pods po on po.id = p.pod_id
         left join profiles pr on pr.person_id = p.id
         left join users u on u.id = p.owner_id
        where p.id > ?
        order by p.id
        limit ?`,
      [afterId, limit],
    );
    const roles = groupBy(
      await this.qIn(
        'select person_id, name from roles where person_id in (:ids)',
        rows.map((r) => r.id),
      ),
      (r) => num(r.person_id),
    );
    // A person can have several profile rows in broken databases; keep the first.
    const seen = new Set<number>();
    const people: PersonRow[] = [];
    for (const r of rows) {
      const id = num(r.id);
      if (seen.has(id)) continue;
      seen.add(id);
      people.push({
        id,
        guid: str(r.guid),
        diasporaHandle: str(r.diaspora_handle),
        serializedPublicKey: str(r.serialized_public_key),
        closedAccount: bool(r.closed_account),
        createdAt: date(r.created_at),
        pod: r.pod_host
          ? { host: str(r.pod_host), ssl: bool(r.pod_ssl), port: numOrNull(r.pod_port) }
          : null,
        profile:
          r.profile_id === null || r.profile_id === undefined
            ? null
            : {
                firstName: strOrNull(r.first_name),
                lastName: strOrNull(r.last_name),
                imageUrl: strOrNull(r.image_url),
                bio: strOrNull(r.bio),
                location: strOrNull(r.location),
                birthday: dayOrNull(r.birthday),
                gender: strOrNull(r.gender),
                searchable: bool(r.searchable),
                nsfw: bool(r.nsfw),
                publicDetails: bool(r.public_details),
              },
        user:
          r.user_id === null || r.user_id === undefined
            ? null
            : {
                id: num(r.user_id),
                username: str(r.username),
                email: str(r.email),
                encryptedPassword: str(r.encrypted_password),
                serializedPrivateKey: strOrNull(r.serialized_private_key),
                language: strOrNull(r.language),
                lockedAt: dateOrNull(r.locked_at),
                lastSignInAt: dateOrNull(r.last_sign_in_at),
                createdAt: date(r.user_created_at),
              },
        roles: (roles.get(id) ?? []).map((role) => str(role.name)),
      });
    }
    return people;
  }

  async aspects(afterId: number, limit: number): Promise<AspectRow[]> {
    const rows = await this.q(
      'select id, user_id, name, order_id, created_at from aspects where id > ? order by id limit ?',
      [afterId, limit],
    );
    return rows.map((r) => ({
      id: num(r.id),
      userId: num(r.user_id),
      name: str(r.name),
      orderId: numOrNull(r.order_id),
      createdAt: date(r.created_at),
    }));
  }

  async contacts(afterId: number, limit: number): Promise<ContactRow[]> {
    const rows = await this.q(
      `select id, user_id, person_id, sharing, receiving, created_at
         from contacts where id > ? order by id limit ?`,
      [afterId, limit],
    );
    const memberships = groupBy(
      await this.qIn(
        'select contact_id, aspect_id from aspect_memberships where contact_id in (:ids)',
        rows.map((r) => r.id),
      ),
      (r) => num(r.contact_id),
    );
    return rows.map((r) => ({
      id: num(r.id),
      userId: num(r.user_id),
      personId: num(r.person_id),
      sharing: bool(r.sharing),
      receiving: bool(r.receiving),
      createdAt: date(r.created_at),
      aspectIds: (memberships.get(num(r.id)) ?? []).map((m) => num(m.aspect_id)),
    }));
  }

  /** Mentioned person ids and tag names of posts or comments, keyed by their id. */
  private async mentionsAndTags(type: 'Post' | 'Comment', ids: number[]) {
    const mentions = groupBy(
      await this.qIn(
        `select mentions_container_id as cid, person_id from mentions
          where mentions_container_type = ? and mentions_container_id in (:ids)`,
        ids,
        [type],
      ),
      (r) => num(r.cid),
    );
    const tags = groupBy(
      await this.qIn(
        `select tg.taggable_id as tid, t.name from taggings tg join tags t on t.id = tg.tag_id
          where tg.taggable_type = ? and tg.taggable_id in (:ids)`,
        ids,
        [type],
      ),
      (r) => num(r.tid),
    );
    return {
      mentions: (id: number) => (mentions.get(id) ?? []).map((m) => num(m.person_id)),
      tags: (id: number) => (tags.get(id) ?? []).map((t) => str(t.name)),
    };
  }

  async statusMessages(afterId: number, limit: number): Promise<StatusMessageRow[]> {
    const rows = await this.q(
      `select id, guid, author_id, public, text, created_at from posts
        where type = 'StatusMessage' and id > ? order by id limit ?`,
      [afterId, limit],
    );
    const ids = rows.map((r) => num(r.id));
    const guids = rows.map((r) => str(r.guid));

    const photos = groupBy(
      (
        await this.qIn(
          `select id, guid, author_id, status_message_guid, text, remote_photo_path,
                  remote_photo_name, unprocessed_image, processed_image, width, height
             from photos where status_message_guid in (:ids) order by id`,
          guids,
        )
      ).map(
        (r): PhotoRow => ({
          id: num(r.id),
          guid: str(r.guid),
          authorId: num(r.author_id),
          statusMessageGuid: str(r.status_message_guid),
          text: strOrNull(r.text),
          remotePhotoPath: strOrNull(r.remote_photo_path),
          remotePhotoName: strOrNull(r.remote_photo_name),
          unprocessedImage: strOrNull(r.unprocessed_image),
          processedImage: strOrNull(r.processed_image),
          width: numOrNull(r.width),
          height: numOrNull(r.height),
        }),
      ),
      (p) => p.statusMessageGuid,
    );

    const pollRows = await this.qIn(
      'select id, question, status_message_id from polls where status_message_id in (:ids)',
      ids,
    );
    const answers = groupBy(
      await this.qIn(
        'select poll_id, answer, vote_count from poll_answers where poll_id in (:ids) order by id',
        pollRows.map((p) => p.id),
      ),
      (a) => num(a.poll_id),
    );
    const polls = new Map<number, PollRow>();
    for (const p of pollRows) {
      polls.set(num(p.status_message_id), {
        question: str(p.question),
        answers: (answers.get(num(p.id)) ?? []).map((a) => ({
          answer: str(a.answer),
          voteCount: num(a.vote_count ?? 0),
        })),
      });
    }

    const aspectVis = groupBy(
      await this.qIn(
        `select shareable_id, aspect_id from aspect_visibilities
          where shareable_type = 'Post' and shareable_id in (:ids)`,
        ids,
      ),
      (r) => num(r.shareable_id),
    );
    const shareVis = groupBy(
      await this.qIn(
        `select shareable_id, user_id from share_visibilities
          where shareable_type = 'Post' and shareable_id in (:ids)`,
        ids,
      ),
      (r) => num(r.shareable_id),
    );
    const extra = await this.mentionsAndTags('Post', ids);

    return rows.map((r) => {
      const id = num(r.id);
      return {
        id,
        guid: str(r.guid),
        authorId: num(r.author_id),
        public: bool(r.public),
        text: str(r.text),
        createdAt: date(r.created_at),
        photos: photos.get(str(r.guid)) ?? [],
        poll: polls.get(id) ?? null,
        aspectIds: (aspectVis.get(id) ?? []).map((a) => num(a.aspect_id)),
        recipientUserIds: (shareVis.get(id) ?? []).map((s) => num(s.user_id)),
        mentionedPersonIds: extra.mentions(id),
        tags: extra.tags(id),
      };
    });
  }

  async reshares(afterId: number, limit: number): Promise<ReshareRow[]> {
    const rows = await this.q(
      `select id, guid, author_id, root_guid, created_at from posts
        where type = 'Reshare' and id > ? order by id limit ?`,
      [afterId, limit],
    );
    return rows.map((r) => ({
      id: num(r.id),
      guid: str(r.guid),
      authorId: num(r.author_id),
      rootGuid: strOrNull(r.root_guid),
      createdAt: date(r.created_at),
    }));
  }

  async comments(afterId: number, limit: number): Promise<CommentRow[]> {
    const rows = await this.q(
      `select c.id, c.guid, c.author_id, c.text, c.created_at, p.guid as parent_guid
         from comments c join posts p on p.id = c.commentable_id
        where c.commentable_type = 'Post' and c.id > ?
        order by c.id limit ?`,
      [afterId, limit],
    );
    const extra = await this.mentionsAndTags(
      'Comment',
      rows.map((r) => num(r.id)),
    );
    return rows.map((r) => ({
      id: num(r.id),
      guid: str(r.guid),
      authorId: num(r.author_id),
      text: str(r.text),
      createdAt: date(r.created_at),
      parentGuid: str(r.parent_guid),
      mentionedPersonIds: extra.mentions(num(r.id)),
      tags: extra.tags(num(r.id)),
    }));
  }

  async likes(afterId: number, limit: number): Promise<LikeRow[]> {
    const rows = await this.q(
      `select l.id, l.guid, l.author_id, l.created_at, l.target_type,
              p.guid as post_guid, c.guid as comment_guid
         from likes l
         left join posts p on l.target_type = 'Post' and p.id = l.target_id
         left join comments c on l.target_type = 'Comment' and c.id = l.target_id
        where l.id > ? and (l.positive is null or l.positive = TRUE) and l.author_id is not null
        order by l.id limit ?`,
      [afterId, limit],
    );
    const likes: LikeRow[] = [];
    for (const r of rows) {
      const targetGuid = strOrNull(r.post_guid) ?? strOrNull(r.comment_guid);
      likes.push({
        id: num(r.id),
        guid: strOrNull(r.guid),
        authorId: num(r.author_id),
        targetGuid: targetGuid ?? '',
        targetType: str(r.target_type) === 'Comment' ? 'Comment' : 'Post',
        createdAt: date(r.created_at),
      });
    }
    return likes;
  }

  async conversations(afterId: number, limit: number): Promise<ConversationRow[]> {
    const rows = await this.q(
      `select id, guid, subject, author_id, created_at from conversations
        where id > ? order by id limit ?`,
      [afterId, limit],
    );
    const ids = rows.map((r) => r.id);
    const participants = groupBy(
      await this.qIn(
        'select conversation_id, person_id from conversation_visibilities where conversation_id in (:ids)',
        ids,
      ),
      (r) => num(r.conversation_id),
    );
    const messages = groupBy(
      (
        await this.qIn(
          `select id, conversation_id, guid, author_id, text, created_at from messages
            where conversation_id in (:ids) order by created_at, id`,
          ids,
        )
      ).map((r) => ({
        conversationId: num(r.conversation_id),
        message: {
          id: num(r.id),
          guid: str(r.guid),
          authorId: num(r.author_id),
          text: str(r.text),
          createdAt: date(r.created_at),
        } satisfies MessageRow,
      })),
      (m) => m.conversationId,
    );
    return rows.map((r) => ({
      id: num(r.id),
      guid: str(r.guid),
      subject: strOrNull(r.subject),
      authorId: num(r.author_id),
      createdAt: date(r.created_at),
      participantPersonIds: (participants.get(num(r.id)) ?? []).map((p) => num(p.person_id)),
      messages: (messages.get(num(r.id)) ?? []).map((m) => m.message),
    }));
  }

  async counts(): Promise<Record<string, number>> {
    const tables = {
      people: 'select count(*) as n from people',
      aspects: 'select count(*) as n from aspects',
      contacts: 'select count(*) as n from contacts',
      statusMessages: "select count(*) as n from posts where type = 'StatusMessage'",
      reshares: "select count(*) as n from posts where type = 'Reshare'",
      comments: "select count(*) as n from comments where commentable_type = 'Post'",
      likes: 'select count(*) as n from likes',
      conversations: 'select count(*) as n from conversations',
    };
    const result: Record<string, number> = {};
    for (const [name, sql] of Object.entries(tables)) {
      const [row] = await this.q(sql);
      result[name] = num(row?.n ?? 0);
    }
    return result;
  }

  close(): Promise<void> {
    return this.client.close();
  }
}
