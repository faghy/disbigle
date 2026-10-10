import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';

/** A public key as a `KeyObject` or PEM string (`BEGIN PUBLIC KEY` or `BEGIN RSA PUBLIC KEY`). */
export type PublicKeyInput = KeyObject | string;
/** A private key as a `KeyObject` or PEM string (PKCS#1 or PKCS#8). */
export type PrivateKeyInput = KeyObject | string;

/** Normalises a public key input; a private key is accepted and its public half is used. */
export function toPublicKey(key: PublicKeyInput | PrivateKeyInput): KeyObject {
  if (typeof key === 'string') return createPublicKey(key.trim());
  if (key.type === 'private') return createPublicKey(key);
  return key;
}

/** Normalises a private key input. */
export function toPrivateKey(key: PrivateKeyInput): KeyObject {
  if (typeof key === 'string') return createPrivateKey(key.trim());
  if (key.type !== 'private') throw new TypeError('expected a private key');
  return key;
}

/** Exports a public key as SPKI PEM (`-----BEGIN PUBLIC KEY-----`), the format diaspora* publishes. */
export function exportPublicKeyPem(key: PublicKeyInput | PrivateKeyInput): string {
  return toPublicKey(key).export({ type: 'spki', format: 'pem' }).toString();
}
