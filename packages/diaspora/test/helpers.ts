import { generateKeyPairSync, type KeyObject } from 'node:crypto';

export interface TestKeyPair {
  publicKey: KeyObject;
  privateKey: KeyObject;
  publicPem: string;
  privatePem: string;
}

/** Generates a small RSA key pair (fast; the protocol does not care about the size). */
export function generateTestKeys(bits = 1024): TestKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: bits });
  return {
    publicKey,
    privateKey,
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privatePem: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
  };
}

/** A key directory usable as `fetchPublicKey`. */
export function keyDirectory(entries: Record<string, KeyObject | string>) {
  return async (id: string) => entries[id] ?? null;
}

export const ALICE = 'alice@example.org';
export const BOB = 'bob@example.com';
export const CAROL = 'carol@example.net';

export const guid = (n: number) => `${n.toString(16).padStart(8, '0')}29e6013487743131731751e9`;
