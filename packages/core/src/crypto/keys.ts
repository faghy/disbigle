import { generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';

const generateKeyPairAsync = promisify(generateKeyPair);

/** Generates the RSA key pair shared by the ActivityPub and diaspora identities of an actor. */
export async function generateActorKeyPair(
  bits = 4096,
): Promise<{ publicKeyPem: string; privateKeyPem: string }> {
  const { publicKey, privateKey } = await generateKeyPairAsync('rsa', {
    modulusLength: bits,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

/** Ed25519 key pair for Object Integrity Proofs (FEP-8b32). */
export async function generateEd25519KeyPair(): Promise<{
  publicKeyPem: string;
  privateKeyPem: string;
}> {
  const { publicKey, privateKey } = await generateKeyPairAsync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}
