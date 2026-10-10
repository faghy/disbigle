// Entity-level signatures: relayable `author_signature` and account migration `signature`.
import { createSign, createVerify } from 'node:crypto';
import { decode64, strictEncode64 } from './base64.ts';
import {
  accountMigrationOldIdentity,
  applyDefaults,
  relayableSignatureData,
  signatureOrder,
} from './entities/codec.ts';
import type { AccountMigration, Relayable } from './entities/types.ts';
import { SignatureVerificationError } from './errors.ts';
import {
  type PrivateKeyInput,
  type PublicKeyInput,
  toPrivateKey,
  toPublicKey,
} from './keys.ts';

/** Signs `data` with RSA-SHA256 and returns the strict base64 signature. */
export function signString(data: string, privateKey: PrivateKeyInput): string {
  const signer = createSign('RSA-SHA256');
  signer.update(data, 'utf8');
  return strictEncode64(signer.sign(toPrivateKey(privateKey)));
}

/** Verifies a base64 RSA-SHA256 signature over `data`. Never throws on malformed input. */
export function verifyString(data: string, signature: string, publicKey: PublicKeyInput): boolean {
  try {
    const verifier = createVerify('RSA-SHA256');
    verifier.update(data, 'utf8');
    return verifier.verify(toPublicKey(publicKey), decode64(signature));
  } catch {
    return false;
  }
}

/**
 * Signs a relayable with its author's private key and returns a copy with `authorSignature`
 * set. Defaults are applied and `propertyOrder` is fixed, so the result serialises exactly
 * to what was signed. Do not sign when the author is also the root author of the parent.
 */
export function signRelayable<T extends Relayable>(entity: T, authorPrivateKey: PrivateKeyInput): T {
  const withDefaults = applyDefaults(entity);
  const fixed = { ...withDefaults, propertyOrder: signatureOrder(withDefaults) };
  return { ...fixed, authorSignature: signString(relayableSignatureData(fixed), authorPrivateKey) };
}

/** True if the relayable's `author_signature` is valid for the author's public key. */
export function verifyRelayableSignature(entity: Relayable, authorPublicKey: PublicKeyInput): boolean {
  if (!entity.authorSignature) return false;
  return verifyString(relayableSignatureData(entity), entity.authorSignature, authorPublicKey);
}

/** Like `verifyRelayableSignature` but throws `SignatureVerificationError`. */
export function assertRelayableSignature(entity: Relayable, authorPublicKey: PublicKeyInput): void {
  if (!entity.authorSignature) {
    throw new SignatureVerificationError(`no author_signature for ${entity.type}:${entity.guid}`);
  }
  if (!verifyRelayableSignature(entity, authorPublicKey)) {
    throw new SignatureVerificationError(`wrong author_signature for ${entity.type}:${entity.guid}`);
  }
}

/** The new identity of an account migration (the author of its profile). */
export function accountMigrationNewIdentity(entity: AccountMigration): string {
  return entity.profile.author;
}


/** The diaspora* ID whose key signs the migration: the identity that is not the author. */
export function accountMigrationSigner(entity: AccountMigration): string | undefined {
  return entity.author === entity.profile.author ? entity.oldIdentity : entity.profile.author;
}

/** The string signed in an account migration: `AccountMigration:<old>:<new>`. */
export function accountMigrationSignatureData(entity: AccountMigration): string {
  return `AccountMigration:${accountMigrationOldIdentity(entity) ?? ''}:${entity.profile.author}`;
}

/** Signs an account migration with the signer's key (see `accountMigrationSigner`). */
export function signAccountMigration(
  entity: AccountMigration,
  signerPrivateKey: PrivateKeyInput,
): AccountMigration {
  return { ...entity, signature: signString(accountMigrationSignatureData(entity), signerPrivateKey) };
}

/** True if the account migration signature is valid for the signer's public key. */
export function verifyAccountMigrationSignature(
  entity: AccountMigration,
  signerPublicKey: PublicKeyInput,
): boolean {
  if (!entity.signature) return false;
  return verifyString(accountMigrationSignatureData(entity), entity.signature, signerPublicKey);
}
