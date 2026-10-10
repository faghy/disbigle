// Typed representations of the diaspora* federation entities.
// Property names are the camelCase form of the XML element names; property order
// on the wire is defined by the schemas in `schema.ts`.

/** Fields shared by every relayable entity (Comment, Like, PollParticipation, EventParticipation). */
export interface RelayableFields {
  author: string;
  guid: string;
  parentGuid: string;
  /** Signature of the relayable author over the ordered property values. */
  authorSignature?: string;
  /**
   * XML element names in signature order, without signature elements. Filled in when parsing
   * and used verbatim when signing, verifying and re-serialising (relaying).
   * When absent, the order of the schema is used.
   */
  propertyOrder?: string[];
  /** Unknown XML elements (name → text), kept for signature verification and relaying. */
  additionalData?: Record<string, string>;
}

export interface AccountDeletion {
  type: 'AccountDeletion';
  author: string;
}

export interface AccountMigration {
  type: 'AccountMigration';
  /** Either the old or the new identity; the other one signs. */
  author: string;
  /** Profile of the new identity (its `author` is the new diaspora* ID). */
  profile: Profile;
  /** Signature of `AccountMigration:<old>:<new>` by the identity that is not the author. */
  signature?: string;
  /** Old identity; required when `author` is the new identity. */
  oldIdentity?: string;
  remotePhotoPath?: string;
}

export interface Comment extends RelayableFields {
  type: 'Comment';
  text: string;
  /** Defaults to the current time. */
  createdAt?: Date;
  editedAt?: Date;
}

export interface Contact {
  type: 'Contact';
  author: string;
  recipient: string;
  /** Defaults to `true`. */
  following?: boolean;
  /** Defaults to `true`. */
  sharing?: boolean;
  /** Defaults to `false`. */
  blocking?: boolean;
}

export interface Conversation {
  type: 'Conversation';
  author: string;
  guid: string;
  subject: string;
  /** Defaults to the current time. */
  createdAt?: Date;
  /** Diaspora IDs separated by `;`. */
  participants: string;
  messages?: Message[];
}

export interface Embed {
  type: 'Embed';
  url?: string;
  title?: string;
  description?: string;
  image?: string;
  nothing?: boolean;
}

export interface Event {
  type: 'Event';
  author: string;
  guid: string;
  editedAt?: Date;
  summary: string;
  description?: string;
  start: Date;
  end?: Date;
  /** Defaults to `false`. */
  allDay?: boolean;
  timezone?: string;
  location?: Location;
}

export interface EventParticipation extends RelayableFields {
  type: 'EventParticipation';
  status: 'accepted' | 'declined' | 'tentative' | (string & {});
  editedAt?: Date;
}

export interface Like extends RelayableFields {
  type: 'Like';
  parentType: 'Post' | 'Comment' | (string & {});
  positive: boolean;
}

export interface Location {
  type: 'Location';
  address: string;
  lat: string;
  lng: string;
}

export interface Message {
  type: 'Message';
  author: string;
  guid: string;
  text: string;
  /** Defaults to the current time. */
  createdAt?: Date;
  editedAt?: Date;
  conversationGuid: string;
}

export interface Participation {
  type: 'Participation';
  author: string;
  guid: string;
  parentGuid: string;
  parentType: string;
}

export interface Photo {
  type: 'Photo';
  guid: string;
  author: string;
  /** Defaults to `false`. */
  public?: boolean;
  /** Defaults to the current time. */
  createdAt?: Date;
  editedAt?: Date;
  remotePhotoPath: string;
  remotePhotoName: string;
  text?: string;
  statusMessageGuid?: string;
  height?: number;
  width?: number;
}

export interface Poll {
  type: 'Poll';
  guid: string;
  question: string;
  pollAnswers: PollAnswer[];
}

export interface PollAnswer {
  type: 'PollAnswer';
  guid: string;
  answer: string;
}

export interface PollParticipation extends RelayableFields {
  type: 'PollParticipation';
  pollAnswerGuid: string;
}

export interface Profile {
  type: 'Profile';
  author: string;
  editedAt?: Date;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  imageUrl?: string;
  imageUrlMedium?: string;
  imageUrlSmall?: string;
  bio?: string;
  /** `YYYY-MM-DD`. */
  birthday?: string;
  gender?: string;
  location?: string;
  /** Defaults to `true`. */
  searchable?: boolean;
  /** Defaults to `false`. */
  public?: boolean;
  /** Defaults to `false`. */
  nsfw?: boolean;
  tagString?: string;
}

export interface Reshare {
  type: 'Reshare';
  author: string;
  guid: string;
  /** Defaults to the current time. */
  createdAt?: Date;
  rootAuthor?: string;
  rootGuid?: string;
}

export interface Retraction {
  type: 'Retraction';
  author: string;
  targetGuid: string;
  /** Entity type name of the target, e.g. `Post`, `Comment`, `Like`, `Photo`, `Contact`. */
  targetType: string;
}

export interface StatusMessage {
  type: 'StatusMessage';
  author: string;
  guid: string;
  /** Defaults to the current time. */
  createdAt?: Date;
  /** Defaults to `false`. */
  public?: boolean;
  providerDisplayName?: string;
  text?: string;
  editedAt?: Date;
  photos?: Photo[];
  location?: Location;
  poll?: Poll;
  event?: Event;
  embed?: Embed;
}

/** Any supported federation entity. */
export type Entity =
  | AccountDeletion
  | AccountMigration
  | Comment
  | Contact
  | Conversation
  | Embed
  | Event
  | EventParticipation
  | Like
  | Location
  | Message
  | Participation
  | Photo
  | Poll
  | PollAnswer
  | PollParticipation
  | Profile
  | Reshare
  | Retraction
  | StatusMessage;

/** Entity type names (CamelCase, as used in `parent_type` / `target_type`). */
export type EntityType = Entity['type'];

/** Relayable entities, whose author signature is verified by every recipient. */
export type Relayable = Comment | Like | PollParticipation | EventParticipation;

/** Narrows an entity union by type name. */
export type EntityOf<T extends EntityType> = Extract<Entity, { type: T }>;
