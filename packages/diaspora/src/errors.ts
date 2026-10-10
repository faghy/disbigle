/** Base class for every error raised by the diaspora* protocol library. */
export class DiasporaError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The Magic Envelope is structurally invalid (missing elements, bad XML, no key_id). */
export class InvalidEnvelopeError extends DiasporaError {}
/** The Magic Envelope data type is missing or not `application/xml`. */
export class InvalidDataTypeError extends DiasporaError {}
/** The Magic Envelope encoding is missing or not `base64url`. */
export class InvalidEncodingError extends DiasporaError {}
/** The Magic Envelope algorithm is missing or not `RSA-SHA256`. */
export class InvalidAlgorithmError extends DiasporaError {}
/** The Magic Envelope signature does not match the sender's public key. */
export class InvalidSignatureError extends DiasporaError {}
/** No public key could be found for the sender of a Magic Envelope. */
export class SenderKeyNotFoundError extends DiasporaError {}
/** An encrypted Magic Envelope could not be decrypted. */
export class DecryptionError extends DiasporaError {}

/** The payload is not well-formed XML. */
export class InvalidXmlError extends DiasporaError {}
/** The XML root element does not name a supported entity. */
export class UnknownEntityError extends DiasporaError {}
/** An entity is missing required properties or fails validation. */
export class ValidationError extends DiasporaError {}

/** No public key could be found to verify an entity signature (relayable or account migration). */
export class PublicKeyNotFoundError extends DiasporaError {}
/** An entity signature (`author_signature`, account migration `signature`) is missing or wrong. */
export class SignatureVerificationError extends DiasporaError {}

/** The envelope sender is not allowed to send this entity. */
export class InvalidSenderError extends DiasporaError {}
/** A non-public entity was received through the public receive route. */
export class NotPublicError extends DiasporaError {}
/** A parent, target or root entity referenced by the payload is unknown. */
export class RelatedEntityNotFoundError extends DiasporaError {}
/** A participation was received for a parent that is not local. */
export class ParentNotLocalError extends DiasporaError {}

/** A diaspora* ID is malformed. */
export class InvalidDiasporaIdError extends DiasporaError {}
/** Generic discovery failure (subject mismatch and the like). */
export class DiscoveryError extends DiasporaError {}
/** A discovery document (JRD, XRD, hCard) cannot be parsed. */
export class InvalidDocumentError extends DiscoveryError {}
/** A discovery document is parseable but lacks mandatory data. */
export class InvalidDataError extends DiscoveryError {}
