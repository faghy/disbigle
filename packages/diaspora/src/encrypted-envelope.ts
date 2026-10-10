// Encrypted Magic Envelope for private delivery:
// https://diaspora.github.io/diaspora_federation/federation/encryption.html
import {
  constants,
  createCipheriv,
  createDecipheriv,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
} from 'node:crypto';
import { decode64, strictEncode64 } from './base64.ts';
import { DecryptionError } from './errors.ts';
import { type PrivateKeyInput, type PublicKeyInput, toPrivateKey, toPublicKey } from './keys.ts';

const CIPHER = 'aes-256-cbc';
/** Content type for private deliveries to `/receive/users/:guid`. */
export const ENCRYPTED_ENVELOPE_CONTENT_TYPE = 'application/json';

/** The JSON body of a private delivery. */
export interface EncryptedMagicEnvelope {
  /** RSA-encrypted (PKCS#1 v1.5) AES key JSON, base64. */
  aes_key: string;
  /** AES-256-CBC encrypted Magic Envelope XML, base64. */
  encrypted_magic_envelope: string;
}

/** AES-256-CBC encryption returning base64, like the reference `Salmon::AES.encrypt`. */
export function aesEncrypt(data: string | Buffer, key: Buffer, iv: Buffer): string {
  const cipher = createCipheriv(CIPHER, key, iv);
  return strictEncode64(Buffer.concat([cipher.update(data), cipher.final()]));
}

/** AES-256-CBC decryption of base64 ciphertext. */
export function aesDecrypt(ciphertext: string, key: Buffer, iv: Buffer): Buffer {
  const decipher = createDecipheriv(CIPHER, key, iv);
  return Buffer.concat([decipher.update(decode64(ciphertext)), decipher.final()]);
}

/**
 * Encrypts a Magic Envelope XML document for one recipient and returns the JSON body
 * (`{"aes_key":…,"encrypted_magic_envelope":…}`) to POST to the recipient's private receive URL.
 */
export function encryptMagicEnvelope(
  envelopeXml: string,
  recipientPublicKey: PublicKeyInput,
): string {
  const key = randomBytes(32);
  const iv = randomBytes(16);
  const encryptedEnvelope = aesEncrypt(Buffer.from(envelopeXml, 'utf8'), key, iv);
  const keyJson = JSON.stringify({ key: strictEncode64(key), iv: strictEncode64(iv) });
  const encryptedKey = publicEncrypt(
    { key: toPublicKey(recipientPublicKey), padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(keyJson, 'utf8'),
  );
  const body: EncryptedMagicEnvelope = {
    aes_key: strictEncode64(encryptedKey),
    encrypted_magic_envelope: encryptedEnvelope,
  };
  return JSON.stringify(body);
}

/**
 * Decrypts the JSON body of a private delivery with the recipient's private key and returns
 * the Magic Envelope XML. Throws `DecryptionError` on any failure.
 */
export function decryptMagicEnvelope(
  body: string | EncryptedMagicEnvelope,
  recipientPrivateKey: PrivateKeyInput,
): string {
  let json: Partial<EncryptedMagicEnvelope>;
  try {
    json = typeof body === 'string' ? (JSON.parse(body) as Partial<EncryptedMagicEnvelope>) : body;
  } catch (error) {
    throw new DecryptionError('body is not JSON', { cause: error });
  }
  if (typeof json?.aes_key !== 'string' || typeof json.encrypted_magic_envelope !== 'string') {
    throw new DecryptionError('missing aes_key or encrypted_magic_envelope');
  }
  try {
    const keyJson = privateDecrypt(
      { key: toPrivateKey(recipientPrivateKey), padding: constants.RSA_PKCS1_PADDING },
      decode64(json.aes_key),
    ).toString('utf8');
    const parsed = JSON.parse(keyJson) as { key?: unknown; iv?: unknown };
    if (typeof parsed.key !== 'string' || typeof parsed.iv !== 'string') {
      throw new Error('invalid AES key JSON');
    }
    return aesDecrypt(
      json.encrypted_magic_envelope,
      decode64(parsed.key),
      decode64(parsed.iv),
    ).toString('utf8');
  } catch (error) {
    throw new DecryptionError(
      `cannot decrypt magic envelope: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
