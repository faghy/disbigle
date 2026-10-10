// Entity schemas: property order, types, defaults and validation rules, mirroring
// the property definitions of the reference implementation (diaspora_federation gem).
import { ValidationError } from '../errors.ts';
import * as r from './rules.ts';
import type { Rule } from './rules.ts';
import type { EntityType } from './types.ts';

export type ScalarType = 'string' | 'integer' | 'boolean' | 'timestamp';

interface BaseProp {
  /** XML element name (snake_case). */
  name: string;
  /** TypeScript property name (camelCase). */
  key: string;
  optional: boolean;
  /** Default applied when the property is absent. */
  default?: () => unknown;
  rules: Rule[];
}

export interface ScalarProp extends BaseProp {
  kind: 'scalar';
  type: ScalarType;
}

export interface NestedProp extends BaseProp {
  kind: 'nested';
  entity: EntityType;
  multi: boolean;
}

export type PropSpec = ScalarProp | NestedProp;

export interface EntitySchema {
  type: EntityType;
  /** Root element name (snake_case of the type). */
  xmlName: string;
  props: PropSpec[];
  /** Set for relayables; `parentType` is the implicit parent type when there is no `parent_type`. */
  relayable?: { parentType?: string };
  /** Cross-property validation, run after the property rules. */
  validate?: (entity: Record<string, unknown>) => void;
}

interface PropOptions {
  optional?: boolean;
  default?: () => unknown;
  rules?: Rule[];
}

export function camelCase(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function snakeCase(type: string): string {
  return type.replace(/(.)([A-Z])/g, '$1_$2').toLowerCase();
}

function scalar(name: string, type: ScalarType, opts: PropOptions = {}): ScalarProp {
  return {
    kind: 'scalar',
    name,
    key: camelCase(name),
    type,
    optional: opts.optional ?? false,
    ...(opts.default ? { default: opts.default } : {}),
    rules: opts.rules ?? [],
  };
}

function nested(
  key: string,
  entity: EntityType,
  multi: boolean,
  opts: PropOptions = {},
): NestedProp {
  return {
    kind: 'nested',
    name: snakeCase(entity),
    key,
    entity,
    multi,
    optional: opts.optional ?? false,
    ...(opts.default ? { default: opts.default } : {}),
    rules: opts.rules ?? [],
  };
}

const now = () => new Date(Math.floor(Date.now() / 1000) * 1000);
const str = (name: string, opts?: PropOptions) => scalar(name, 'string', opts);
const bool = (name: string, opts?: PropOptions) => scalar(name, 'boolean', opts);
const int = (name: string, opts?: PropOptions) => scalar(name, 'integer', opts);
const time = (name: string, opts?: PropOptions) => scalar(name, 'timestamp', opts);

const MAX_TEXT = 65_535;

function relayableProps(): PropSpec[] {
  return [
    str('author', { rules: [r.diasporaId] }),
    str('guid', { rules: [r.guid] }),
    str('parent_guid', { rules: [r.guid] }),
    str('author_signature', { default: () => undefined }),
  ];
}

function sameAuthor(childKey: string, label: string) {
  return (entity: Record<string, unknown>) => {
    const children = (entity[childKey] as Array<{ author?: string }> | undefined) ?? [];
    for (const child of children) {
      if (child.author !== entity.author) {
        throw new ValidationError(
          `nested ${label} has different author: author=${String(entity.author)}`,
        );
      }
    }
  };
}

function define(type: EntityType, props: PropSpec[], extra: Partial<EntitySchema> = {}) {
  return { type, xmlName: snakeCase(type), props, ...extra } satisfies EntitySchema;
}

/** All entity schemas, keyed by type name. */
export const SCHEMAS: Record<EntityType, EntitySchema> = {
  AccountDeletion: define('AccountDeletion', [str('author', { rules: [r.diasporaId] })]),

  AccountMigration: define('AccountMigration', [
    str('author', { rules: [r.diasporaId] }),
    nested('profile', 'Profile', false, { rules: [r.notNil] }),
    str('signature', { default: () => undefined }),
    str('old_identity', { default: () => undefined }),
    str('remote_photo_path', { optional: true, rules: [r.uri('path')] }),
  ]),

  Comment: define(
    'Comment',
    [
      ...relayableProps(),
      str('text', { rules: [r.notEmpty, r.maxLength(MAX_TEXT)] }),
      time('created_at', { default: now }),
      time('edited_at', { optional: true }),
    ],
    { relayable: { parentType: 'Post' } },
  ),

  Contact: define(
    'Contact',
    [
      str('author', { rules: [r.diasporaId] }),
      str('recipient', { rules: [r.diasporaId] }),
      bool('following', { default: () => true, rules: [r.boolean] }),
      bool('sharing', { default: () => true, rules: [r.boolean] }),
      bool('blocking', { optional: true, default: () => false, rules: [r.boolean] }),
    ],
    {
      validate: (e) => {
        if ((e.following || e.sharing) && e.blocking) {
          throw new ValidationError(
            `flags invalid: following:${String(e.following)}/sharing:${String(e.sharing)} and blocking:${String(e.blocking)} can't both be true`,
          );
        }
      },
    },
  ),

  Conversation: define(
    'Conversation',
    [
      str('author', { rules: [r.diasporaId] }),
      str('guid', { rules: [r.guid] }),
      str('subject', { rules: [r.notEmpty, r.maxLength(255)] }),
      time('created_at', { default: now }),
      str('participants', { rules: [r.notEmpty, r.diasporaIdList(2)] }),
      nested('messages', 'Message', true, { default: () => [], rules: [r.notNil] }),
    ],
    { validate: sameAuthor('messages', 'Message') },
  ),

  Embed: define(
    'Embed',
    [
      str('url', { optional: true, rules: [r.uri()] }),
      str('title', { optional: true, rules: [r.maxLength(255)] }),
      str('description', { optional: true, rules: [r.maxLength(MAX_TEXT)] }),
      str('image', { optional: true, rules: [r.uri('host', 'path')] }),
      bool('nothing', { optional: true }),
    ],
    {
      validate: (e) => {
        if (Boolean(e.nothing) === (e.url !== undefined)) {
          throw new ValidationError("Either 'url' must be set or 'nothing' must be 'true'");
        }
      },
    },
  ),

  Event: define('Event', [
    str('author', { rules: [r.diasporaId] }),
    str('guid', { rules: [r.guid] }),
    time('edited_at', { optional: true }),
    str('summary', { rules: [r.notEmpty, r.maxLength(255)] }),
    str('description', { optional: true, rules: [r.maxLength(MAX_TEXT)] }),
    time('start', { rules: [r.notNil] }),
    time('end', { optional: true }),
    bool('all_day', { optional: true, default: () => false, rules: [r.boolean] }),
    str('timezone', {
      optional: true,
      rules: [r.regex(/^[A-Za-z_-]{0,14}(\/[A-Za-z_-]{0,14}){1,2}$/)],
    }),
    nested('location', 'Location', false, { optional: true }),
  ]),

  EventParticipation: define(
    'EventParticipation',
    [
      ...relayableProps(),
      str('status', { rules: [r.notEmpty, r.oneOf('accepted', 'declined', 'tentative')] }),
      time('edited_at', { optional: true }),
    ],
    { relayable: { parentType: 'Event' } },
  ),

  Like: define(
    'Like',
    [
      ...relayableProps(),
      str('parent_type', { rules: [r.notEmpty, r.oneOf('Post', 'Comment')] }),
      bool('positive', { rules: [r.boolean] }),
    ],
    { relayable: {} },
  ),

  Location: define('Location', [
    str('address'),
    str('lat', { rules: [r.notEmpty] }),
    str('lng', { rules: [r.notEmpty] }),
  ]),

  Message: define('Message', [
    str('author', { rules: [r.diasporaId] }),
    str('guid', { rules: [r.guid] }),
    str('text', { rules: [r.notEmpty, r.maxLength(MAX_TEXT)] }),
    time('created_at', { default: now }),
    time('edited_at', { optional: true }),
    str('conversation_guid', { rules: [r.guid] }),
  ]),

  Participation: define('Participation', [
    str('author', { rules: [r.diasporaId] }),
    str('guid', { rules: [r.guid] }),
    str('parent_guid', { rules: [r.guid] }),
    str('parent_type', { rules: [r.notEmpty, r.oneOf('Post')] }),
  ]),

  Photo: define('Photo', [
    str('guid', { rules: [r.guid] }),
    str('author', { rules: [r.diasporaId] }),
    bool('public', { default: () => false, rules: [r.boolean] }),
    time('created_at', { default: now }),
    time('edited_at', { optional: true }),
    str('remote_photo_path', { rules: [r.notEmpty, r.uri('path')] }),
    str('remote_photo_name', { rules: [r.notEmpty] }),
    str('text', { optional: true, rules: [r.maxLength(MAX_TEXT)] }),
    str('status_message_guid', { optional: true, rules: [r.guid] }),
    int('height', { optional: true, rules: [r.numeric] }),
    int('width', { optional: true, rules: [r.numeric] }),
  ]),

  Poll: define('Poll', [
    str('guid', { rules: [r.guid] }),
    str('question', { rules: [r.notEmpty, r.maxLength(255)] }),
    nested('pollAnswers', 'PollAnswer', true, { rules: [r.minItems(2)] }),
  ]),

  PollAnswer: define('PollAnswer', [
    str('guid', { rules: [r.guid] }),
    str('answer', { rules: [r.notEmpty, r.maxLength(255)] }),
  ]),

  PollParticipation: define(
    'PollParticipation',
    [...relayableProps(), str('poll_answer_guid', { rules: [r.guid] })],
    { relayable: { parentType: 'Poll' } },
  ),

  Profile: define('Profile', [
    str('author', { rules: [r.diasporaId] }),
    time('edited_at', { optional: true }),
    str('full_name', { optional: true, rules: [r.name(70)] }),
    str('first_name', { optional: true, rules: [r.name(32)] }),
    str('last_name', { optional: true, rules: [r.name(32)] }),
    str('image_url', { optional: true, rules: [r.uri('path')] }),
    str('image_url_medium', { optional: true, rules: [r.uri('path')] }),
    str('image_url_small', { optional: true, rules: [r.uri('path')] }),
    str('bio', { optional: true, rules: [r.maxLength(MAX_TEXT)] }),
    str('birthday', { optional: true, rules: [r.birthday] }),
    str('gender', { optional: true, rules: [r.maxLength(255)] }),
    str('location', { optional: true, rules: [r.maxLength(255)] }),
    bool('searchable', { optional: true, default: () => true, rules: [r.boolean] }),
    bool('public', { optional: true, default: () => false, rules: [r.boolean] }),
    bool('nsfw', { optional: true, default: () => false, rules: [r.boolean] }),
    str('tag_string', { optional: true, rules: [r.tagCount(5)] }),
  ]),

  Reshare: define('Reshare', [
    str('author', { rules: [r.diasporaId] }),
    str('guid', { rules: [r.guid] }),
    time('created_at', { default: now }),
    str('root_author', { optional: true, rules: [r.diasporaId] }),
    str('root_guid', { optional: true, rules: [r.guid] }),
  ]),

  Retraction: define('Retraction', [
    str('author', { rules: [r.diasporaId] }),
    str('target_guid', { rules: [r.guid] }),
    str('target_type', { rules: [r.notEmpty] }),
  ]),

  StatusMessage: define(
    'StatusMessage',
    [
      str('author', { rules: [r.diasporaId] }),
      str('guid', { rules: [r.guid] }),
      time('created_at', { default: now }),
      bool('public', { default: () => false, rules: [r.boolean] }),
      str('provider_display_name', { optional: true }),
      str('text', { rules: [r.maxLength(MAX_TEXT)] }),
      time('edited_at', { optional: true }),
      nested('photos', 'Photo', true, { optional: true, default: () => [], rules: [r.notNil] }),
      nested('location', 'Location', false, { optional: true }),
      nested('poll', 'Poll', false, { optional: true }),
      nested('event', 'Event', false, { optional: true }),
      nested('embed', 'Embed', false, { optional: true }),
    ],
    { validate: sameAuthor('photos', 'Photo') },
  ),
};

const BY_XML_NAME = new Map<string, EntitySchema>(
  Object.values(SCHEMAS).map((schema) => [schema.xmlName, schema]),
);

/** Looks up a schema by root element name (`status_message`). */
export function schemaForXmlName(name: string): EntitySchema | undefined {
  return BY_XML_NAME.get(name);
}

/** Looks up a schema by entity type (`StatusMessage`). */
export function schemaFor(type: EntityType): EntitySchema {
  return SCHEMAS[type];
}

/** True if entities of this type are relayables. */
export function isRelayableType(type: string): boolean {
  return Boolean(SCHEMAS[type as EntityType]?.relayable);
}
