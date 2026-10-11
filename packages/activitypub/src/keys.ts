import type { webcrypto } from 'node:crypto';
import type { CoreContext } from '@disbigle/core';
import { generateEd25519KeyPair } from '@disbigle/core';
import { schema } from '@disbigle/db';
import { eq } from 'drizzle-orm';

type CryptoKeyPair = webcrypto.CryptoKeyPair;
const subtle = globalThis.crypto.subtle;

function pemToDer(pem: string): ArrayBuffer {
  const base64 = pem.replace(/-----(BEGIN|END) [A-Z ]+-----/g, '').replace(/\s+/g, '');
  const bytes = Buffer.from(base64, 'base64');
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

const rsa = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

export async function importRsaKeyPair(
  privatePem: string,
  publicPem: string,
): Promise<CryptoKeyPair> {
  const [privateKey, publicKey] = await Promise.all([
    subtle.importKey('pkcs8', pemToDer(privatePem), rsa, true, ['sign']),
    subtle.importKey('spki', pemToDer(publicPem), rsa, true, ['verify']),
  ]);
  return { privateKey, publicKey };
}

export async function importEd25519KeyPair(
  privatePem: string,
  publicPem: string,
): Promise<CryptoKeyPair> {
  const [privateKey, publicKey] = await Promise.all([
    subtle.importKey('pkcs8', pemToDer(privatePem), { name: 'Ed25519' }, true, ['sign']),
    subtle.importKey('spki', pemToDer(publicPem), { name: 'Ed25519' }, true, ['verify']),
  ]);
  return { privateKey, publicKey };
}

const cache = new Map<string, Promise<CryptoKeyPair[]>>();

/**
 * Key pairs of a local actor: RSA (HTTP Signatures, shared with diaspora) first, then Ed25519
 * (Object Integrity Proofs). Accounts created before Ed25519 support get a key on first use.
 */
export function getLocalKeyPairs(ctx: CoreContext, actorId: string): Promise<CryptoKeyPair[]> {
  let pairs = cache.get(actorId);
  if (!pairs) {
    pairs = loadKeyPairs(ctx, actorId);
    cache.set(actorId, pairs);
    pairs.catch(() => cache.delete(actorId));
  }
  return pairs;
}

async function loadKeyPairs(ctx: CoreContext, actorId: string): Promise<CryptoKeyPair[]> {
  const [row] = await ctx.db
    .select({ user: schema.users, publicKeyPem: schema.actors.publicKeyPem })
    .from(schema.users)
    .innerJoin(schema.actors, eq(schema.actors.id, schema.users.actorId))
    .where(eq(schema.users.actorId, actorId));
  if (!row) return [];
  let { ed25519PrivateKeyPem, ed25519PublicKeyPem } = row.user;
  if (!ed25519PrivateKeyPem || !ed25519PublicKeyPem) {
    const generated = await generateEd25519KeyPair();
    ed25519PrivateKeyPem = generated.privateKeyPem;
    ed25519PublicKeyPem = generated.publicKeyPem;
    await ctx.db
      .update(schema.users)
      .set({ ed25519PrivateKeyPem, ed25519PublicKeyPem })
      .where(eq(schema.users.id, row.user.id));
  }
  return [
    await importRsaKeyPair(row.user.privateKeyPem, row.publicKeyPem),
    await importEd25519KeyPair(ed25519PrivateKeyPem, ed25519PublicKeyPem),
  ];
}

/** Identifier of the instance actor; the tilde keeps it apart from every username. */
export const INSTANCE_ACTOR = '~actor';

let instancePairs: Promise<{ pairs: CryptoKeyPair[] }> | undefined;

/** Key pairs of the instance actor, created on first use. */
export function getInstanceKeyPairs(ctx: CoreContext): Promise<CryptoKeyPair[]> {
  instancePairs ??= loadInstanceKeys(ctx);
  instancePairs.catch(() => {
    instancePairs = undefined;
  });
  return instancePairs.then((r) => r.pairs);
}

async function loadInstanceKeys(ctx: CoreContext): Promise<{ pairs: CryptoKeyPair[] }> {
  let [row] = await ctx.db
    .select()
    .from(schema.instanceKeys)
    .where(eq(schema.instanceKeys.id, 'instance'));
  if (!row) {
    const { generateActorKeyPair } = await import('@disbigle/core');
    const [rsaKeys, edKeys] = await Promise.all([
      generateActorKeyPair(4096),
      generateEd25519KeyPair(),
    ]);
    await ctx.db
      .insert(schema.instanceKeys)
      .values({
        id: 'instance',
        rsaPrivateKeyPem: rsaKeys.privateKeyPem,
        rsaPublicKeyPem: rsaKeys.publicKeyPem,
        ed25519PrivateKeyPem: edKeys.privateKeyPem,
        ed25519PublicKeyPem: edKeys.publicKeyPem,
      })
      .onConflictDoNothing();
    [row] = await ctx.db
      .select()
      .from(schema.instanceKeys)
      .where(eq(schema.instanceKeys.id, 'instance'));
    if (!row) throw new Error('Could not create instance keys');
  }
  return {
    pairs: [
      await importRsaKeyPair(row.rsaPrivateKeyPem, row.rsaPublicKeyPem),
      await importEd25519KeyPair(row.ed25519PrivateKeyPem, row.ed25519PublicKeyPem),
    ],
  };
}

const bridgeCache = new Map<string, Promise<CryptoKeyPair[]>>();

/** Key pair of a bridge identity (RSA only: enough for HTTP Signatures). */
export function getBridgeKeyPairs(bridge: {
  id: string;
  privateKeyPem: string;
  publicKeyPem: string;
}): Promise<CryptoKeyPair[]> {
  let pairs = bridgeCache.get(bridge.id);
  if (!pairs) {
    pairs = importRsaKeyPair(bridge.privateKeyPem, bridge.publicKeyPem).then((pair) => [pair]);
    bridgeCache.set(bridge.id, pairs);
    pairs.catch(() => bridgeCache.delete(bridge.id));
  }
  return pairs;
}
