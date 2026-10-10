// diaspora* stores RSA keys as OpenSSL writes them: the private key as PKCS#1
// (`BEGIN RSA PRIVATE KEY`), the public key as SPKI or, on old pods, PKCS#1 (`BEGIN RSA PUBLIC KEY`).
// Disbigle stores SPKI public keys and PKCS#8 private keys.
import { createPrivateKey, createPublicKey } from 'node:crypto';

export function toSpkiPem(pem: string): string {
  return createPublicKey(pem.trim()).export({ type: 'spki', format: 'pem' }).toString();
}

export function toPkcs8Pem(pem: string): string {
  return createPrivateKey(pem.trim()).export({ type: 'pkcs8', format: 'pem' }).toString();
}

/** SPKI PEM of the public half of a private key. */
export function publicPemOf(privatePem: string): string {
  return createPublicKey(createPrivateKey(privatePem.trim()))
    .export({ type: 'spki', format: 'pem' })
    .toString();
}
