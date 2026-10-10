/**
 * @disbigle/diaspora — the diaspora* federation protocol: Magic Envelopes (public and
 * encrypted), entities and their XML format, relayable and account migration signatures,
 * and discovery documents (WebFinger, host-meta, hCard).
 *
 * Pure library: no HTTP and no storage. Keys and related entities are resolved through
 * caller-supplied callbacks.
 */

export {
  DIASPORA_ID_MAX_LENGTH,
  DIASPORA_ID_REGEX,
  type DiasporaId,
  formatDiasporaId,
  isValidDiasporaId,
  normalizeDiasporaId,
  parseDiasporaId,
} from './diaspora-id.ts';
export { buildHCard, type HCard, parseHCard } from './discovery/hcard.ts';
export {
  buildHostMeta,
  buildWebFinger,
  isDiasporaWebFinger,
  JRD_CONTENT_TYPE,
  type ParseWebFingerOptions,
  parseHostMeta,
  parseWebFinger,
  REL_ATOM,
  REL_HCARD,
  REL_LRDD,
  REL_PROFILE,
  REL_SALMON,
  REL_SEED,
  REL_SUBSCRIBE,
  type WebFingerInfo,
  type WebFingerInput,
  webFingerUrl,
} from './discovery/webfinger.ts';
export {
  buildXrd,
  type JrdJson,
  parseJrd,
  parseXrd,
  toJrd,
  type XrdDocument,
  type XrdLink,
} from './discovery/xrd.ts';
export {
  decryptMagicEnvelope,
  ENCRYPTED_ENVELOPE_CONTENT_TYPE,
  type EncryptedMagicEnvelope,
  encryptMagicEnvelope,
} from './encrypted-envelope.ts';
export {
  accountMigrationOldIdentity,
  applyDefaults,
  formatTimestamp,
  isRelayable,
  parseEntity,
  parseEntityAs,
  parseTimestamp,
  relayableParentType,
  relayableSignatureData,
  serializeEntity,
  signatureOrder,
  validateEntity,
} from './entities/codec.ts';
export { isValidGuid } from './entities/rules.ts';
export { type EntitySchema, isRelayableType, schemaFor } from './entities/schema.ts';
export type * from './entities/types.ts';
export * from './errors.ts';
export {
  buildPrivateMessage,
  buildPublicMessage,
  type EnvelopeSigner,
  type FetchRelatedEntity,
  type ReceivedMessage,
  type ReceiveOptions,
  type RelatedEntity,
  receivePrivate,
  receivePublic,
  rootOf,
  verifyReceivedEntity,
} from './federation.ts';
export {
  exportPublicKeyPem,
  type PrivateKeyInput,
  type PublicKeyInput,
  toPrivateKey,
  toPublicKey,
} from './keys.ts';
export {
  createMagicEnvelope,
  type FetchPublicKey,
  MAGIC_ENV_ALGORITHM,
  MAGIC_ENV_CONTENT_TYPE,
  MAGIC_ENV_DATA_TYPE,
  MAGIC_ENV_ENCODING,
  MAGIC_ENV_XMLNS,
  magicEnvelopeSignatureSubject,
  type OpenedMagicEnvelope,
  type ParsedMagicEnvelope,
  parseMagicEnvelope,
  type UnenvelopOptions,
  unenvelop,
} from './magic-envelope.ts';
export {
  accountMigrationNewIdentity,
  accountMigrationSignatureData,
  accountMigrationSigner,
  assertRelayableSignature,
  signAccountMigration,
  signRelayable,
  signString,
  verifyAccountMigrationSignature,
  verifyRelayableSignature,
  verifyString,
} from './signatures.ts';
