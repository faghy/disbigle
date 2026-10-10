// XML (de)serialisation of entities, following the reference implementation's
// Entity#to_xml, XmlParser and RelayableXmlParser behaviour.
import type { Element } from '@xmldom/xmldom';
import { UnknownEntityError, ValidationError } from '../errors.ts';
import {
  elementChildren,
  hasChildNodes,
  localName,
  parseXml,
  replaceInvalidXmlChars,
  serializeXml,
  textContent,
  type XmlNode,
} from '../xml.ts';
import {
  type EntitySchema,
  type PropSpec,
  type ScalarProp,
  type ScalarType,
  schemaFor,
  schemaForXmlName,
} from './schema.ts';
import type {
  AccountMigration,
  Entity,
  EntityOf,
  EntityType,
  Relayable,
  RelayableFields,
} from './types.ts';

type Data = Record<string, unknown>;

const SIGNATURE_NAME = /signature/;

// ---------------------------------------------------------------------------
// Scalar value conversion

/** Formats a date as an ISO 8601 UTC timestamp with second precision (`2016-07-11T22:38:19Z`). */
export function formatTimestamp(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new ValidationError('invalid date');
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Parses a timestamp leniently (ISO 8601, `YYYY-MM-DD HH:MM:SS UTC`, …); `undefined` if invalid. */
export function parseTimestamp(text: string): Date | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const match =
    /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?))?\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2})?$/i.exec(
      trimmed,
    );
  let date: Date;
  if (match) {
    const [, day, clock = '00:00:00', zone = 'Z'] = match;
    const offset = /^(Z|UTC|GMT)$/i.test(zone)
      ? 'Z'
      : zone.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
    date = new Date(`${day}T${clock}${offset}`);
  } else {
    date = new Date(trimmed);
  }
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseScalar(type: ScalarType, text: string): unknown {
  switch (type) {
    case 'timestamp':
      return parseTimestamp(text);
    case 'integer':
      return /^\d+$/.test(text) ? Number(text) : undefined;
    case 'boolean':
      if (/^(true|t|yes|y|1)$/i.test(text)) return true;
      if (/^(false|f|no|n|0)$/i.test(text)) return false;
      return undefined;
    default:
      return text === '' ? undefined : text;
  }
}

/** String form of a scalar value as used in XML and signatures (`undefined` → empty string). */
function scalarString(type: ScalarType, value: unknown): string {
  if (value === undefined || value === null) return '';
  switch (type) {
    case 'timestamp':
      return formatTimestamp(value instanceof Date ? value : new Date(String(value)));
    case 'string':
      return replaceInvalidXmlChars(String(value));
    default:
      return String(value);
  }
}

// ---------------------------------------------------------------------------
// Defaults, computed values and validation

/** Value of a property, honouring computed properties (account migration `old_identity`). */
function propValue(schema: EntitySchema, data: Data, prop: PropSpec): unknown {
  if (schema.type === 'AccountMigration' && prop.key === 'oldIdentity') {
    return accountMigrationOldIdentity(data as unknown as AccountMigration);
  }
  return data[prop.key];
}

/** The old identity of an account migration (the author, unless the author is the new identity). */
export function accountMigrationOldIdentity(entity: AccountMigration): string | undefined {
  return entity.author === entity.profile?.author ? entity.oldIdentity : entity.author;
}

/** Returns a copy of the entity with default values applied to absent properties (recursively). */
export function applyDefaults<T extends Entity>(entity: T): T {
  const schema = schemaFor(entity.type);
  const data: Data = { ...(entity as unknown as Data) };
  for (const prop of schema.props) {
    if (data[prop.key] === undefined && prop.default) data[prop.key] = prop.default();
    const value = data[prop.key];
    if (prop.kind === 'nested' && value !== undefined && value !== null) {
      data[prop.key] = prop.multi
        ? (value as Entity[]).map((child) =>
            applyDefaults({ ...child, type: prop.entity } as Entity),
          )
        : applyDefaults({ ...(value as Entity), type: prop.entity } as Entity);
    }
  }
  for (const key of Object.keys(data)) if (data[key] === undefined) delete data[key];
  return data as unknown as T;
}

function describe(schema: EntitySchema, data: Data): string {
  const guid = typeof data.guid === 'string' ? `:${data.guid}` : '';
  const author = typeof data.author === 'string' ? ` from ${data.author}` : '';
  return `${schema.type}${guid}${author}`;
}

/** Validates an entity (with defaults already applied) against its schema rules. */
function validateData(schema: EntitySchema, data: Data): void {
  const errors: string[] = [];
  for (const prop of schema.props) {
    const value = propValue(schema, data, prop);
    for (const rule of prop.rules) {
      if (value === undefined && prop.optional && !rule.checksNil) continue;
      if (!rule.test(value)) {
        errors.push(`property: ${prop.name}, value: ${JSON.stringify(value)}, rule: ${rule.name}`);
      }
    }
  }
  if (errors.length > 0) {
    throw new ValidationError(
      `Failed validation for ${describe(schema, data)} for properties: ${errors.join(' | ')}`,
    );
  }
  schema.validate?.(data);
}

/** Validates an entity, throwing `ValidationError` when it is not valid. */
export function validateEntity(entity: Entity): void {
  const withDefaults = applyDefaults(entity);
  const schema = schemaFor(entity.type);
  validateData(schema, withDefaults as unknown as Data);
  for (const prop of schema.props) {
    if (prop.kind !== 'nested') continue;
    const value = (withDefaults as unknown as Data)[prop.key];
    if (value === undefined) continue;
    for (const child of prop.multi ? (value as Entity[]) : [value as Entity]) validateEntity(child);
  }
}

// ---------------------------------------------------------------------------
// Relayable helpers

function scalarProp(schema: EntitySchema, name: string): ScalarProp | undefined {
  const prop = schema.props.find((p) => p.name === name);
  return prop?.kind === 'scalar' ? prop : undefined;
}

function relayableSchema(entity: Relayable): EntitySchema {
  const schema = schemaFor(entity.type);
  if (!schema.relayable) throw new TypeError(`${entity.type} is not a relayable`);
  return schema;
}

/**
 * Order of the properties covered by the author signature: `propertyOrder` when present
 * (signature names removed), otherwise the schema order without absent optional properties.
 */
export function signatureOrder(entity: Relayable): string[] {
  const schema = relayableSchema(entity);
  if (entity.propertyOrder) return entity.propertyOrder.filter((n) => !SIGNATURE_NAME.test(n));
  const data = entity as unknown as Data;
  return schema.props
    .filter((p) => p.kind === 'scalar' && p.name !== 'author_signature')
    .filter((p) => !(p.optional && data[p.key] === undefined))
    .map((p) => p.name);
}

function relayableValue(schema: EntitySchema, entity: RelayableFields, name: string): string {
  const prop = scalarProp(schema, name);
  if (prop) return scalarString(prop.type, (entity as unknown as Data)[prop.key]);
  return entity.additionalData?.[name] ?? '';
}

/** The string covered by a relayable author signature: ordered values joined with `;`. */
export function relayableSignatureData(entity: Relayable): string {
  const schema = relayableSchema(entity);
  const withDefaults = applyDefaults(entity);
  return signatureOrder(withDefaults)
    .map((name) => relayableValue(schema, withDefaults, name))
    .join(';');
}

// ---------------------------------------------------------------------------
// Serialisation

function toXmlNode(entity: Entity): XmlNode {
  const schema = schemaFor(entity.type);
  const data = entity as unknown as Data;

  if (schema.relayable) {
    const relayable = entity as Relayable;
    const children: XmlNode[] = signatureOrder(relayable).map((name) => ({
      name,
      text: relayableValue(schema, relayable, name),
    }));
    if (relayable.authorSignature !== undefined) {
      children.push({ name: 'author_signature', text: relayable.authorSignature });
    }
    return { name: schema.xmlName, children };
  }

  const children: XmlNode[] = [];
  for (const prop of schema.props) {
    const value = propValue(schema, data, prop);
    if (prop.kind === 'nested') {
      if (value === undefined || value === null) continue;
      const items = prop.multi ? (value as Entity[]) : [value as Entity];
      for (const item of items) children.push(toXmlNode({ ...item, type: prop.entity } as Entity));
      continue;
    }
    if (value === undefined && prop.optional) continue;
    if (value === undefined && (prop.type === 'boolean' || prop.type === 'integer')) continue;
    children.push({ name: prop.name, text: scalarString(prop.type, value) });
  }
  return { name: schema.xmlName, children };
}

/**
 * Serialises an entity to XML (pretty printed, no XML declaration), exactly like the
 * reference implementation. Defaults are applied and the entity is validated first.
 * Relayables are serialised in `propertyOrder` with their `additionalData`; the
 * `author_signature` element is written when `authorSignature` is set.
 */
export function serializeEntity(entity: Entity): string {
  const withDefaults = applyDefaults(entity);
  validateEntity(withDefaults);
  return serializeXml(toXmlNode(withDefaults));
}

// ---------------------------------------------------------------------------
// Parsing

function findProp(schema: EntitySchema, name: string): PropSpec | undefined {
  return schema.props.find((p) => p.name === name);
}

function parseWithSchema(root: Element, schema: EntitySchema): Data {
  const children = elementChildren(root);
  const order: string[] = [];
  const values: Data = {};
  const present = new Set<string>();
  const additional: Record<string, string> = {};

  for (const child of children) {
    const name = localName(child);
    if (order.includes(name)) continue;
    order.push(name);
    const prop = findProp(schema, name);
    if (!prop) {
      additional[name] = textContent(child);
      continue;
    }
    present.add(prop.key);
    if (prop.kind === 'scalar') {
      values[prop.key] = parseScalar(prop.type, textContent(child));
      continue;
    }
    const nestedSchema = schemaFor(prop.entity);
    const matching = children.filter((c) => localName(c) === name && hasChildNodes(c));
    if (prop.multi) {
      values[prop.key] = matching.map((c) => ({
        type: prop.entity,
        ...parseWithSchema(c, nestedSchema),
      }));
    } else {
      const first = children.find((c) => localName(c) === name);
      values[prop.key] =
        first && hasChildNodes(first)
          ? { type: prop.entity, ...parseWithSchema(first, nestedSchema) }
          : undefined;
    }
  }

  if (schema.relayable) {
    const label = describe(schema, values);
    if (!schema.relayable.parentType && !present.has('parentType')) {
      throw new ValidationError(`Invalid ${label}! Missing 'parent_type'.`);
    }
    if (!present.has('parentGuid')) {
      throw new ValidationError(`Invalid ${label}! Missing 'parent_guid'.`);
    }
  }

  const missing = schema.props
    .filter((p) => !p.optional && !p.default && !present.has(p.key))
    .map((p) => p.name);
  if (missing.length > 0) {
    throw new ValidationError(
      `${describe(schema, values)}: Missing required properties: ${missing.join(', ')}`,
    );
  }

  const data: Data = { type: schema.type };
  for (const prop of schema.props) {
    const value = present.has(prop.key) ? values[prop.key] : prop.default?.();
    if (value !== undefined) data[prop.key] = value;
  }
  if (schema.relayable) {
    data.propertyOrder = order.filter((n) => !SIGNATURE_NAME.test(n));
    const extra = Object.fromEntries(
      Object.entries(additional).filter(([n]) => !SIGNATURE_NAME.test(n)),
    );
    data.additionalData = extra;
  }

  validateData(schema, data);
  return data;
}

/**
 * Parses entity XML (a string or an already parsed element). The root element name selects
 * the entity type. Throws `UnknownEntityError`, `ValidationError` or `InvalidXmlError`.
 * Signatures are not verified here.
 */
export function parseEntity(xml: string | Element): Entity {
  const root = typeof xml === 'string' ? parseXml(xml) : xml;
  const name = localName(root);
  if (!/^[a-z]*(?:_[a-z]*)*$/.test(name)) {
    throw new UnknownEntityError(`'${name}' is invalid`);
  }
  const schema = schemaForXmlName(name);
  if (!schema) throw new UnknownEntityError(`'${name}' not found`);
  return parseWithSchema(root, schema) as unknown as Entity;
}

/** Parses entity XML and checks that it is of the expected type. */
export function parseEntityAs<T extends EntityType>(type: T, xml: string | Element): EntityOf<T> {
  const entity = parseEntity(xml);
  if (entity.type !== type) {
    throw new UnknownEntityError(`'${schemaFor(entity.type).xmlName}' can't be parsed as ${type}`);
  }
  return entity as EntityOf<T>;
}

/** True if the entity is a relayable (Comment, Like, PollParticipation, EventParticipation). */
export function isRelayable(entity: Entity): entity is Relayable {
  return Boolean(schemaFor(entity.type).relayable);
}

/** The parent type of a relayable (`parent_type`, or the implicit type for its entity). */
export function relayableParentType(entity: Relayable): string {
  if (entity.type === 'Like') return entity.parentType;
  return relayableSchema(entity).relayable?.parentType ?? 'Post';
}
