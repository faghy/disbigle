// Normalised rows read from a diaspora* database. Readers for different SQL engines
// (PostgreSQL today, MySQL later) return exactly these shapes.

export interface PodRow {
  host: string;
  ssl: boolean;
  port: number | null;
}

export interface ProfileRow {
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
  bio: string | null;
  location: string | null;
  birthday: string | null;
  gender: string | null;
  searchable: boolean;
  nsfw: boolean;
  publicDetails: boolean;
}

export interface LocalUserRow {
  id: number;
  username: string;
  email: string;
  encryptedPassword: string;
  serializedPrivateKey: string | null;
  language: string | null;
  lockedAt: Date | null;
  lastSignInAt: Date | null;
  createdAt: Date;
}

export interface PersonRow {
  id: number;
  guid: string;
  diasporaHandle: string;
  serializedPublicKey: string;
  closedAccount: boolean;
  createdAt: Date;
  pod: PodRow | null;
  profile: ProfileRow | null;
  /** Set for people owned by a local user. */
  user: LocalUserRow | null;
  /** Names from the `roles` table: admin, moderator, spotlight. */
  roles: string[];
}

export interface AspectRow {
  id: number;
  userId: number;
  name: string;
  orderId: number | null;
  createdAt: Date;
}

export interface ContactRow {
  id: number;
  userId: number;
  personId: number;
  /** The person shares with the user: the user receives the person's posts. */
  sharing: boolean;
  /** The user shares with the person: the person receives the user's posts. */
  receiving: boolean;
  createdAt: Date;
  aspectIds: number[];
}

export interface PhotoRow {
  id: number;
  guid: string;
  authorId: number;
  statusMessageGuid: string;
  text: string | null;
  remotePhotoPath: string | null;
  remotePhotoName: string | null;
  unprocessedImage: string | null;
  processedImage: string | null;
  width: number | null;
  height: number | null;
}

export interface PollAnswerRow {
  id: number;
  guid: string | null;
  answer: string;
  voteCount: number;
}

export interface PollParticipationRow {
  id: number;
  guid: string | null;
  authorId: number;
  pollAnswerId: number;
  createdAt: Date;
}

export interface PollRow {
  id: number;
  guid: string | null;
  question: string;
  /** In diaspora's order (`poll_answers.id`), which is the order of the options. */
  answers: PollAnswerRow[];
  participations: PollParticipationRow[];
}

export interface StatusMessageRow {
  id: number;
  guid: string;
  authorId: number;
  public: boolean;
  text: string;
  createdAt: Date;
  photos: PhotoRow[];
  poll: PollRow | null;
  /** Aspects (diaspora ids) a private post was shared with. */
  aspectIds: number[];
  /** Local users (diaspora user ids) who received a private post. */
  recipientUserIds: number[];
  /** Mentioned people (diaspora person ids). */
  mentionedPersonIds: number[];
  tags: string[];
}

export interface ReshareRow {
  id: number;
  guid: string;
  authorId: number;
  rootGuid: string | null;
  createdAt: Date;
}

export interface CommentRow {
  id: number;
  guid: string;
  authorId: number;
  text: string;
  createdAt: Date;
  parentGuid: string;
  mentionedPersonIds: number[];
  tags: string[];
}

export interface LikeRow {
  id: number;
  guid: string | null;
  authorId: number;
  targetGuid: string;
  targetType: 'Post' | 'Comment';
  createdAt: Date;
}

export interface MessageRow {
  id: number;
  guid: string;
  authorId: number;
  text: string;
  createdAt: Date;
}

export interface ConversationRow {
  id: number;
  guid: string;
  subject: string | null;
  authorId: number;
  createdAt: Date;
  participantPersonIds: number[];
  messages: MessageRow[];
}

/**
 * Read access to a diaspora* database. Every list method is keyset-paginated on the diaspora
 * primary key: it returns up to `limit` rows with `id > afterId`, ordered by id.
 */
export interface DiasporaReader {
  /** diaspora* handles of a few local users, to detect the pod's domain. */
  localHandles(limit: number): Promise<string[]>;
  people(afterId: number, limit: number): Promise<PersonRow[]>;
  aspects(afterId: number, limit: number): Promise<AspectRow[]>;
  contacts(afterId: number, limit: number): Promise<ContactRow[]>;
  statusMessages(afterId: number, limit: number): Promise<StatusMessageRow[]>;
  reshares(afterId: number, limit: number): Promise<ReshareRow[]>;
  comments(afterId: number, limit: number): Promise<CommentRow[]>;
  likes(afterId: number, limit: number): Promise<LikeRow[]>;
  conversations(afterId: number, limit: number): Promise<ConversationRow[]>;
  /** Row counts per table, for progress reporting. */
  counts(): Promise<Record<string, number>>;
  close(): Promise<void>;
}
