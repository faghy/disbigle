// Salmon Magic Envelope as used by diaspora*:
// https://diaspora.github.io/diaspora_federation/federation/magicsig.html
import { createSign, createVerify } from 'node:crypto';
import { decode64, urlsafeEncode64 } from './base64.ts';
import { normalizeDiasporaId } from './diaspora-id.ts';
import {
  InvalidAlgorithmError,
  InvalidDataTypeError,
  InvalidEncodingError,
  InvalidEnvelopeError,
  InvalidSignatureError,
  InvalidXmlError,
  SenderKeyNotFoundError,
} from './errors.ts';
import { type PrivateKeyInput, type PublicKeyInput, toPrivateKey, toPublicKey } from './keys.ts';
import { childByLocalName, localName, parseXml, serializeXml, textContent } from './xml.ts';

export const MAGIC_ENV_XMLNS = 'http://salmon-protocol.org/ns/magic-env';
export const MAGIC_ENV_DATA_TYPE = 'application/xml';
export const MAGIC_ENV_ENCODING = 'base64url';
export const MAGIC_ENV_ALGORITHM = 'RSA-SHA256';
/** Content type for public deliveries to `/receive/public`. */
export const MAGIC_ENV_CONTENT_TYPE = 'application/magic-envelope+xml';

/** Resolves the public key of a diaspora* ID; return `null`/`undefined` when unknown. */
export type FetchPublicKey = (
  diasporaId: string,
) => Promise<PublicKeyInput | null | undefined> | PublicKeyInput | null | undefined;

/** The signature base string: the four base64url-encoded parts joined with `.`. */
export function magicEnvelopeSignatureSubject(payload: string | Buffer): string {
  return [payload, MAGIC_ENV_DATA_TYPE, MAGIC_ENV_ENCODING, MAGIC_ENV_ALGORITHM]
    .map((part) => urlsafeEncode64(part))
    .join('.');
}

/**
 * Builds a signed Magic Envelope document around a payload (usually entity XML).
 * `sender` is the author's diaspora* ID, written as base64url `key_id`.
 */
export function createMagicEnvelope(
  payloadXml: string,
  sender: string,
  privateKey: PrivateKeyInput,
): string {
  const payload = Buffer.from(payloadXml.trim(), 'utf8');
  const signer = createSign('RSA-SHA256');
  signer.update(magicEnvelopeSignatureSubject(payload), 'utf8');
  const sig = signer.sign(toPrivateKey(privateKey));
  const body = serializeXml({
    name: 'me:env',
    attributes: [['xmlns:me', MAGIC_ENV_XMLNS]],
    children: [
      {
        name: 'me:data',
        attributes: [['type', MAGIC_ENV_DATA_TYPE]],
        text: urlsafeEncode64(payload),
      },
      { name: 'me:encoding', text: MAGIC_ENV_ENCODING },
      { name: 'me:alg', text: MAGIC_ENV_ALGORITHM },
      {
        name: 'me:sig',
        attributes: [['key_id', urlsafeEncode64(sender)]],
        text: urlsafeEncode64(sig),
      },
    ],
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`;
}

/** Structure of a Magic Envelope, before signature verification. */
export interface ParsedMagicEnvelope {
  /** The `me:data` text as transmitted (base64url). */
  data: string;
  dataType: string;
  encoding: string;
  alg: string;
  /** The `me:sig` text (base64url). */
  sig: string;
  /** Sender decoded from `key_id`, if present. */
  keyId: string | undefined;
  /** The decoded payload bytes. */
  payload: Buffer;
}

function requireElement(env: Parameters<typeof childByLocalName>[0], name: string) {
  const element = childByLocalName(env, name);
  if (!element) throw new InvalidEnvelopeError(`missing me:${name}`);
  if (textContent(element) === '') throw new InvalidEnvelopeError(`empty me:${name}`);
  return element;
}

function decodeKeyId(keyId: string): string {
  const decoded = decode64(keyId).toString('utf8');
  // tolerate implementations that put the plain diaspora* ID into key_id
  if (!decoded.includes('@') && keyId.includes('@')) return normalizeDiasporaId(keyId);
  return decoded;
}

/** Parses and structurally validates a Magic Envelope XML document (no signature check). */
export function parseMagicEnvelope(xml: string): ParsedMagicEnvelope {
  let env: ReturnType<typeof parseXml>;
  try {
    env = parseXml(xml);
  } catch (error) {
    if (error instanceof InvalidXmlError) {
      throw new InvalidEnvelopeError(`not an XML document: ${error.message}`, { cause: error });
    }
    throw error;
  }
  if (localName(env) !== 'env') throw new InvalidEnvelopeError('root element is not me:env');
  const dataEl = requireElement(env, 'data');
  const sigEl = requireElement(env, 'sig');

  const dataType = dataEl.getAttribute('type');
  if (!dataType) throw new InvalidDataTypeError('missing data type');
  if (dataType !== MAGIC_ENV_DATA_TYPE)
    throw new InvalidDataTypeError(`invalid data type: ${dataType}`);

  const encodingEl = childByLocalName(env, 'encoding');
  if (!encodingEl) throw new InvalidEncodingError('missing encoding');
  const encoding = textContent(encodingEl).trim();
  if (encoding !== MAGIC_ENV_ENCODING)
    throw new InvalidEncodingError(`invalid encoding: ${encoding}`);

  const algEl = childByLocalName(env, 'alg');
  if (!algEl) throw new InvalidAlgorithmError('missing algorithm');
  const alg = textContent(algEl).trim();
  if (alg !== MAGIC_ENV_ALGORITHM) throw new InvalidAlgorithmError(`invalid algorithm: ${alg}`);

  const data = textContent(dataEl).replace(/\s+/g, '');
  const keyIdAttr = sigEl.getAttribute('key_id');
  return {
    data,
    dataType,
    encoding,
    alg,
    sig: textContent(sigEl).replace(/\s+/g, ''),
    keyId: keyIdAttr ? decodeKeyId(keyIdAttr) : undefined,
    payload: decode64(data),
  };
}

/** A verified Magic Envelope. */
export interface OpenedMagicEnvelope {
  /** diaspora* ID of the signer. */
  sender: string;
  /** The payload XML (UTF-8). */
  payloadXml: string;
}

export interface UnenvelopOptions {
  /** Resolves the sender's public key. */
  fetchPublicKey: FetchPublicKey;
  /** Expected sender; defaults to the envelope `key_id`. */
  sender?: string;
}

function verifySubject(subject: string, signature: Buffer, key: ReturnType<typeof toPublicKey>) {
  const verifier = createVerify('RSA-SHA256');
  verifier.update(subject, 'utf8');
  return verifier.verify(key, signature);
}

/**
 * Parses a Magic Envelope, resolves the sender key with `fetchPublicKey` and verifies the
 * signature. Returns the sender and the payload XML.
 * Throws `InvalidEnvelopeError` (and the more specific structure errors),
 * `SenderKeyNotFoundError` or `InvalidSignatureError`.
 */
export async function unenvelop(
  xml: string,
  options: UnenvelopOptions,
): Promise<OpenedMagicEnvelope> {
  const env = parseMagicEnvelope(xml);
  const sender = options.sender ?? env.keyId;
  if (!sender) throw new InvalidEnvelopeError('no key_id');
  const keyInput = await options.fetchPublicKey(sender);
  if (!keyInput) throw new SenderKeyNotFoundError(`no public key for ${sender}`);
  const key = toPublicKey(keyInput);
  const signature = decode64(env.sig);
  // The reference implementation re-encodes the decoded data (with padding); some
  // implementations sign the data string exactly as transmitted, so accept both.
  const params = [env.dataType, env.encoding, env.alg];
  const subjects = new Set([
    magicEnvelopeSignatureSubject(env.payload),
    [env.data, ...params.map((p) => urlsafeEncode64(p))].join('.'),
    [env.data, ...params.map((p) => urlsafeEncode64(p).replace(/=+$/, ''))].join('.'),
  ]);
  const valid = [...subjects].some((subject) => {
    try {
      return verifySubject(subject, signature, key);
    } catch {
      return false;
    }
  });
  if (!valid) throw new InvalidSignatureError(`invalid magic envelope signature from ${sender}`);
  return { sender, payloadXml: env.payload.toString('utf8') };
}
