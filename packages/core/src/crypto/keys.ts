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
