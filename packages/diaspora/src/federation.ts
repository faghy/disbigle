// High-level receive and send helpers, mirroring the reference Receiver/Sender flow.

import { decryptMagicEnvelope, encryptMagicEnvelope } from './encrypted-envelope.ts';
import {
  isRelayable,
  parseEntity,
  relayableParentType,
  serializeEntity,
} from './entities/codec.ts';
import type { Entity, Relayable } from './entities/types.ts';
import {
  InvalidSenderError,
  NotPublicError,
  ParentNotLocalError,
  PublicKeyNotFoundError,
  RelatedEntityNotFoundError,
  SignatureVerificationError,
  ValidationError,
} from './errors.ts';
import type { PrivateKeyInput, PublicKeyInput } from './keys.ts';
import { createMagicEnvelope, type FetchPublicKey, unenvelop } from './magic-envelope.ts';
import {
  accountMigrationSigner,
  verifyAccountMigrationSignature,
  verifyRelayableSignature,
} from './signatures.ts';

/**
 * What the receiver knows about an entity referenced by a payload (parent of a relayable,
 * target of a retraction, root of a reshare). Same shape as the reference `RelatedEntity`.
 */
export interface RelatedEntity {
  /** diaspora* ID of the author. */
  author: string;
  /** True if the entity was created on this server. */
  local: boolean;
  public?: boolean;
  /** For relayables (e.g. a like on a comment): the parent of this entity. */
  parent?: RelatedEntity;
}

/** Resolves a referenced entity by type (`Post`, `Comment`, `Poll`, …) and GUID. */
export type FetchRelatedEntity = (
  type: string,
  guid: string,
) => Promise<RelatedEntity | null | undefined> | RelatedEntity | null | undefined;

export interface ReceiveOptions {
  /** Resolves public keys for the envelope sender and for signature checks. */
  fetchPublicKey: FetchPublicKey;
  /**
   * Resolves referenced entities. The server may fetch missing ones from the remote pod
   * (`/fetch/:type/:guid`) before answering; return `null` if it stays unknown.
   */
  fetchRelatedEntity: FetchRelatedEntity;
}

/** A verified incoming message. */
export interface ReceivedMessage {
  /** diaspora* ID that signed the Magic Envelope. */
  sender: string;
  /** The parsed, validated and signature-checked entity. */
  entity: Entity;
  /** The payload XML as received. */
  payloadXml: string;
  /** Parent of a relayable or participation, target of a retraction, root of a reshare. */
  related?: RelatedEntity;
}

/** The top-most ancestor of a related entity. */
export function rootOf(entity: RelatedEntity): RelatedEntity {
  let root = entity;
  while (root.parent) root = root.parent;
  return root;
}

async function requireRelated(
  fetch: FetchRelatedEntity,
  type: string,
  guid: string,
): Promise<RelatedEntity> {
  const related = await fetch(type, guid);
  if (!related) throw new RelatedEntityNotFoundError(`not found: ${type}:${guid}`);
  return related;
}

async function requireKey(fetchPublicKey: FetchPublicKey, id: string, what: string) {
  const key = await fetchPublicKey(id);
  if (!key) throw new PublicKeyNotFoundError(`${what}: no public key for ${id}`);
  return key;
}

async function checkRelayable(
  entity: Relayable,
  sender: string,
  options: ReceiveOptions,
): Promise<RelatedEntity> {
  const parent = await requireRelated(
    options.fetchRelatedEntity,
    relayableParentType(entity),
    entity.parentGuid,
  );
  const root = rootOf(parent);
  if (entity.author !== root.author) {
    const key = await requireKey(options.fetchPublicKey, entity.author, 'author_signature');
    if (!entity.authorSignature) {
      throw new SignatureVerificationError(`no author_signature for ${entity.type}:${entity.guid}`);
    }
    if (!verifyRelayableSignature(entity, key)) {
      throw new SignatureVerificationError(
        `wrong author_signature for ${entity.type}:${entity.guid}`,
      );
    }
  }
  if (!((sender === entity.author && root.local) || sender === root.author)) {
    throw new InvalidSenderError(`invalid sender ${sender} for ${entity.type}:${entity.guid}`);
  }
  return parent;
}

/**
 * Entity-level checks performed by the reference implementation after unenveloping:
 * relayable author signatures, account migration signature, related entities and the
 * sender authorisation. Returns the related entity, if any.
 */
export async function verifyReceivedEntity(
  entity: Entity,
  sender: string,
  options: ReceiveOptions,
): Promise<RelatedEntity | undefined> {
  if (isRelayable(entity)) return checkRelayable(entity, sender, options);

  switch (entity.type) {
    case 'Retraction': {
      const target = await requireRelated(
        options.fetchRelatedEntity,
        entity.targetType,
        entity.targetGuid,
      );
      const allowed = ['Comment', 'Like', 'PollParticipation'].includes(entity.targetType)
        ? [rootOf(target).author, target.author]
        : [target.author];
      if (!allowed.includes(sender)) {
        throw new InvalidSenderError(
          `invalid sender ${sender} for retraction of ${entity.targetGuid}`,
        );
      }
      return target;
    }
    case 'AccountMigration': {
      const signer = accountMigrationSigner(entity);
      if (!signer) throw new ValidationError('account migration without old identity');
      const key = await requireKey(options.fetchPublicKey, signer, 'account migration signature');
      if (!verifyAccountMigrationSignature(entity, key)) {
        throw new SignatureVerificationError(`wrong signature for account migration by ${signer}`);
      }
      break;
    }
    case 'Reshare': {
      let root: RelatedEntity | undefined;
      if (entity.rootAuthor !== undefined || entity.rootGuid !== undefined) {
        if (entity.rootGuid === undefined) {
          throw new ValidationError("root_guid can't be nil if root_author is present");
        }
        if (entity.rootAuthor === undefined) {
          throw new ValidationError("root_author can't be nil if root_guid is present");
        }
        root = await requireRelated(options.fetchRelatedEntity, 'Post', entity.rootGuid);
        if (root.author !== entity.rootAuthor) {
          throw new ValidationError(
            `root_author mismatch: root_author=${entity.rootAuthor} known_root_author=${root.author}`,
          );
        }
      }
      if (sender !== entity.author) throw new InvalidSenderError(`invalid sender: ${sender}`);
      return root;
    }
    case 'Participation': {
      const parent = await requireRelated(
        options.fetchRelatedEntity,
        entity.parentType,
        entity.parentGuid,
      );
      if (!parent.local) throw new ParentNotLocalError(`parent ${entity.parentGuid} is not local`);
      if (sender !== entity.author) throw new InvalidSenderError(`invalid sender: ${sender}`);
      return parent;
    }
    default:
      break;
  }
  if (!('author' in entity) || sender !== entity.author) {
    throw new InvalidSenderError(`invalid sender: ${sender}`);
  }
  return undefined;
}

function assertPublic(entity: Entity): void {
  if (entity.type !== 'Profile' && entity.type !== 'StatusMessage' && entity.type !== 'Photo') {
    return;
  }
  if (entity.public) return;
  if (
    entity.type === 'Profile' &&
    [entity.bio, entity.birthday, entity.gender, entity.location].every((v) => v === undefined)
  ) {
    return;
  }
  throw new NotPublicError(`received entity ${entity.type} should be public`);
}

async function receive(
  envelopeXml: string,
  options: ReceiveOptions,
  isPublic: boolean,
): Promise<ReceivedMessage> {
  const { sender, payloadXml } = await unenvelop(envelopeXml, {
    fetchPublicKey: options.fetchPublicKey,
  });
  const entity = parseEntity(payloadXml);
  const related = await verifyReceivedEntity(entity, sender, options);
  if (isPublic) assertPublic(entity);
  return { sender, entity, payloadXml, ...(related ? { related } : {}) };
}

/**
 * Handles the body of a `POST /receive/public`: verifies the Magic Envelope, parses the entity,
 * verifies entity signatures and the sender, and checks the entity is public.
 */
export function receivePublic(body: string, options: ReceiveOptions): Promise<ReceivedMessage> {
  return receive(body, options, true);
}

/**
 * Handles the body of a `POST /receive/users/:guid`: decrypts it with the recipient's private
 * key, then performs the same checks as `receivePublic` (except the public flag).
 */
export async function receivePrivate(
  body: string,
  recipientPrivateKey: PrivateKeyInput,
  options: ReceiveOptions,
): Promise<ReceivedMessage> {
  const envelopeXml = decryptMagicEnvelope(body, recipientPrivateKey);
  return receive(envelopeXml, options, false);
}

/** Sender identity and key used to sign outgoing envelopes. */
export interface EnvelopeSigner {
  /** diaspora* ID of the sender. */
  diasporaId: string;
  privateKey: PrivateKeyInput;
}

/**
 * Serialises an entity and wraps it in a signed Magic Envelope, ready to POST to
 * `/receive/public` (Content-Type `application/magic-envelope+xml`). Relayables must already
 * carry their `authorSignature` (see `signRelayable`) unless the sender is the root author.
 */
export function buildPublicMessage(entity: Entity, signer: EnvelopeSigner): string {
  return createMagicEnvelope(serializeEntity(entity), signer.diasporaId, signer.privateKey);
}

/**
 * Builds the encrypted JSON body of a private delivery for one recipient, ready to POST to
 * `/receive/users/:guid` (Content-Type `application/json`).
 */
export function buildPrivateMessage(
  entity: Entity,
  signer: EnvelopeSigner,
  recipientPublicKey: PublicKeyInput,
): string {
  return encryptMagicEnvelope(buildPublicMessage(entity, signer), recipientPublicKey);
}
