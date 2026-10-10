import { constants, createSign, publicEncrypt, randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { aesEncrypt } from '../src/encrypted-envelope.ts';
import {
  createMagicEnvelope,
  DecryptionError,
  decryptMagicEnvelope,
  encryptMagicEnvelope,
  InvalidAlgorithmError,
  InvalidDataTypeError,
  InvalidEncodingError,
  InvalidEnvelopeError,
  InvalidSignatureError,
  magicEnvelopeSignatureSubject,
  parseMagicEnvelope,
  SenderKeyNotFoundError,
  unenvelop,
} from '../src/index.ts';
import { ALICE_PRIVATE_KEY, ALICE_PUBLIC_KEY, SPEC_MAGIC_ENVELOPE } from './fixtures/gem.ts';
import { ALICE, BOB, generateTestKeys, keyDirectory, type TestKeyPair } from './helpers.ts';

const PAYLOAD = '<test_entity>\n  <test>asdf</test>\n</test_entity>';

describe('Magic Envelope', () => {
  let alice: TestKeyPair;
  let bob: TestKeyPair;
  beforeAll(() => {
    alice = generateTestKeys();
    bob = generateTestKeys();
  });

  it('uses the base64url constants of the specification', () => {
    expect(magicEnvelopeSignatureSubject('x').split('.').slice(1)).toEqual([
      'YXBwbGljYXRpb24veG1s',
      'YmFzZTY0dXJs',
      'UlNBLVNIQTI1Ng==',
    ]);
  });

  it('builds an envelope with the structure produced by the gem', () => {
    const xml = createMagicEnvelope(PAYLOAD, ALICE, alice.privateKey);
    const data = Buffer.from(PAYLOAD).toString('base64url');
    const lines = xml.split('\n');
    expect(lines[0]).toBe('<?xml version="1.0" encoding="UTF-8"?>');
    expect(lines[1]).toBe('<me:env xmlns:me="http://salmon-protocol.org/ns/magic-env">');
    expect(lines[2]).toMatch(/^ {2}<me:data type="application\/xml">[A-Za-z0-9_=-]+<\/me:data>$/);
    expect(lines[2]).toContain(data);
    expect(lines[3]).toBe('  <me:encoding>base64url</me:encoding>');
    expect(lines[4]).toBe('  <me:alg>RSA-SHA256</me:alg>');
    expect(lines[5]).toMatch(
      /^ {2}<me:sig key_id="YWxpY2VAZXhhbXBsZS5vcmc=">[A-Za-z0-9_=-]+<\/me:sig>$/,
    );
    expect(lines[6]).toBe('</me:env>');
  });

  it('round-trips and verifies', async () => {
    const xml = createMagicEnvelope(PAYLOAD, ALICE, alice.privatePem);
    const opened = await unenvelop(xml, {
      fetchPublicKey: keyDirectory({ [ALICE]: alice.publicPem }),
    });
    expect(opened).toEqual({ sender: ALICE, payloadXml: PAYLOAD });
  });

  it('round-trips non-ASCII payloads', async () => {
    const payload = '<status_message>\n  <text>Caffè ☕ 💩</text>\n</status_message>';
    const xml = createMagicEnvelope(payload, ALICE, alice.privateKey);
    const opened = await unenvelop(xml, {
      fetchPublicKey: keyDirectory({ [ALICE]: alice.publicKey }),
    });
    expect(opened.payloadXml).toBe(payload);
  });

  it('produces the deterministic signature of the gem for the integration key', async () => {
    // RSA PKCS#1 v1.5 is deterministic: compute the reference signature independently.
    const signer = createSign('RSA-SHA256');
    const subject = [PAYLOAD, 'application/xml', 'base64url', 'RSA-SHA256']
      .map((p) => Buffer.from(p).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'))
      .join('.');
    signer.update(subject);
    const expected = signer
      .sign(ALICE_PRIVATE_KEY)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const xml = createMagicEnvelope(PAYLOAD, 'alice@pod-a.org', ALICE_PRIVATE_KEY);
    expect(parseMagicEnvelope(xml).sig).toBe(expected);
    await expect(unenvelop(xml, { fetchPublicKey: () => ALICE_PUBLIC_KEY })).resolves.toMatchObject(
      { sender: 'alice@pod-a.org' },
    );
  });

  it('accepts signatures over unpadded base64url data (other implementations)', async () => {
    const payload = Buffer.from(`${PAYLOAD} `); // length not a multiple of 3 → padding differs
    const data = payload.toString('base64url');
    const subject = [
      data,
      ...['application/xml', 'base64url', 'RSA-SHA256'].map((p) =>
        Buffer.from(p).toString('base64url'),
      ),
    ].join('.');
    const sig = createSign('RSA-SHA256')
      .update(subject)
      .sign(alice.privateKey)
      .toString('base64url');
    const xml = `<me:env xmlns:me="http://salmon-protocol.org/ns/magic-env"><me:data type="application/xml">${data}</me:data><me:encoding>base64url</me:encoding><me:alg>RSA-SHA256</me:alg><me:sig key_id="${Buffer.from(ALICE).toString('base64url')}">${sig}</me:sig></me:env>`;
    const opened = await unenvelop(xml, {
      fetchPublicKey: keyDirectory({ [ALICE]: alice.publicKey }),
    });
    expect(opened.payloadXml).toBe(payload.toString());
  });

  it('parses the example envelope of the protocol documentation', () => {
    const env = parseMagicEnvelope(SPEC_MAGIC_ENVELOPE);
    expect(env.keyId).toBe('alice@example.org');
    expect(env.dataType).toBe('application/xml');
    expect(env.payload.toString()).toContain(
      '<raw_message>i am a very interesting status update</raw_message>',
    );
  });

  it('rejects the documentation example signed by an unknown key', async () => {
    await expect(
      unenvelop(SPEC_MAGIC_ENVELOPE, {
        fetchPublicKey: keyDirectory({ 'alice@example.org': alice.publicKey }),
      }),
    ).rejects.toThrow(InvalidSignatureError);
  });

  describe('negative cases (magic_envelope_spec)', () => {
    let xml: string;
    const fetchPublicKey = (id: string) =>
      id === ALICE ? alice.publicKey : id === BOB ? bob.publicKey : null;
    beforeAll(() => {
      xml = createMagicEnvelope(PAYLOAD, ALICE, alice.privateKey);
    });

    it('verifies the structure', async () => {
      await expect(unenvelop('<asdf/>', { fetchPublicKey })).rejects.toThrow(InvalidEnvelopeError);
      await expect(unenvelop('not xml', { fetchPublicKey })).rejects.toThrow(InvalidEnvelopeError);
    });

    it('raises if signature, data or key_id are missing', async () => {
      await expect(
        unenvelop(xml.replace(/<me:sig[^>]*>[^<]*<\/me:sig>/, ''), { fetchPublicKey }),
      ).rejects.toThrow('missing me:sig');
      await expect(
        unenvelop(xml.replace(/<me:data[^>]*>[^<]*<\/me:data>/, ''), { fetchPublicKey }),
      ).rejects.toThrow('missing me:data');
      await expect(
        unenvelop(xml.replace(/ key_id="[^"]*"/, ''), { fetchPublicKey }),
      ).rejects.toThrow('no key_id');
    });

    it('verifies encoding, algorithm and data type', async () => {
      await expect(
        unenvelop(xml.replace(/<me:encoding>.*<\/me:encoding>/, ''), { fetchPublicKey }),
      ).rejects.toThrow(new InvalidEncodingError('missing encoding'));
      await expect(
        unenvelop(xml.replace('>base64url<', '>invalid_enc<'), { fetchPublicKey }),
      ).rejects.toThrow('invalid encoding: invalid_enc');
      await expect(
        unenvelop(xml.replace(/<me:alg>.*<\/me:alg>/, ''), { fetchPublicKey }),
      ).rejects.toThrow(InvalidAlgorithmError);
      await expect(
        unenvelop(xml.replace('>RSA-SHA256<', '>invalid_alg<'), { fetchPublicKey }),
      ).rejects.toThrow('invalid algorithm: invalid_alg');
      await expect(
        unenvelop(xml.replace(' type="application/xml"', ''), { fetchPublicKey }),
      ).rejects.toThrow(new InvalidDataTypeError('missing data type'));
      await expect(
        unenvelop(xml.replace('application/xml', 'invalid_type'), { fetchPublicKey }),
      ).rejects.toThrow('invalid data type: invalid_type');
    });

    it('raises if the sender key is not found', async () => {
      await expect(unenvelop(xml, { fetchPublicKey: () => null })).rejects.toThrow(
        SenderKeyNotFoundError,
      );
    });

    it('rejects a different sender or wrong key', async () => {
      await expect(unenvelop(xml, { fetchPublicKey, sender: BOB })).rejects.toThrow(
        InvalidSignatureError,
      );
      const forged = xml.replace(
        /key_id="[^"]*"/,
        `key_id="${Buffer.from(BOB).toString('base64url')}"`,
      );
      await expect(unenvelop(forged, { fetchPublicKey })).rejects.toThrow(InvalidSignatureError);
    });

    it('rejects tampered data', async () => {
      const tampered = createMagicEnvelope(PAYLOAD.replace('asdf', 'qwer'), ALICE, bob.privateKey);
      const data = /<me:data[^>]*>([^<]*)</.exec(tampered)?.[1] ?? '';
      const mixed = xml.replace(/(<me:data[^>]*>)[^<]*</, `$1${data}<`);
      await expect(unenvelop(mixed, { fetchPublicKey })).rejects.toThrow(InvalidSignatureError);
    });
  });
});

describe('Encrypted Magic Envelope', () => {
  let alice: TestKeyPair;
  let bob: TestKeyPair;
  beforeAll(() => {
    alice = generateTestKeys();
    bob = generateTestKeys(2048);
  });

  it('creates the JSON structure of the specification', () => {
    const env = createMagicEnvelope(PAYLOAD, ALICE, alice.privateKey);
    const json = JSON.parse(encryptMagicEnvelope(env, bob.publicKey));
    expect(Object.keys(json)).toEqual(['aes_key', 'encrypted_magic_envelope']);
    expect(json.aes_key).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(json.encrypted_magic_envelope).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('round-trips', async () => {
    const env = createMagicEnvelope(PAYLOAD, ALICE, alice.privateKey);
    const body = encryptMagicEnvelope(env, bob.publicPem);
    const decrypted = decryptMagicEnvelope(body, bob.privatePem);
    expect(decrypted).toBe(env);
    const opened = await unenvelop(decrypted, {
      fetchPublicKey: keyDirectory({ [ALICE]: alice.publicKey }),
    });
    expect(opened.payloadXml).toBe(PAYLOAD);
  });

  it('decrypts a payload built exactly like the gem (Ruby OpenSSL/JSON/Base64 layout)', () => {
    const env = createMagicEnvelope(PAYLOAD, ALICE, alice.privateKey);
    const key = randomBytes(32);
    const iv = randomBytes(16);
    // Ruby: JSON.generate(key: strict_encode64(key), iv: strict_encode64(iv)), RSA PKCS#1 v1.5
    const keyJson = `{"key":"${key.toString('base64')}","iv":"${iv.toString('base64')}"}`;
    const aesKey = publicEncrypt(
      { key: bob.publicKey, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(keyJson),
    );
    const body = `{"aes_key":"${aesKey.toString('base64')}","encrypted_magic_envelope":"${aesEncrypt(env, key, iv)}"}`;
    expect(decryptMagicEnvelope(body, bob.privateKey)).toBe(env);
  });

  it('fails with the wrong private key', () => {
    const body = encryptMagicEnvelope(
      createMagicEnvelope(PAYLOAD, ALICE, alice.privateKey),
      bob.publicKey,
    );
    expect(() => decryptMagicEnvelope(body, alice.privateKey)).toThrow(DecryptionError);
  });

  it('fails on tampered or malformed bodies', () => {
    const body = JSON.parse(
      encryptMagicEnvelope(createMagicEnvelope(PAYLOAD, ALICE, alice.privateKey), bob.publicKey),
    );
    const broken = Buffer.from(body.encrypted_magic_envelope, 'base64');
    broken[broken.length - 1] = (broken[broken.length - 1] ?? 0) ^ 0xff;
    expect(() =>
      decryptMagicEnvelope(
        { ...body, encrypted_magic_envelope: broken.toString('base64') },
        bob.privateKey,
      ),
    ).toThrow(DecryptionError);
    expect(() => decryptMagicEnvelope('not json', bob.privateKey)).toThrow(DecryptionError);
    expect(() => decryptMagicEnvelope('{"aes_key":"x"}', bob.privateKey)).toThrow(DecryptionError);
  });

  it('works with the 1024-bit key of the gem fixtures', () => {
    const env = createMagicEnvelope(PAYLOAD, 'alice@pod-a.org', ALICE_PRIVATE_KEY);
    expect(
      decryptMagicEnvelope(encryptMagicEnvelope(env, ALICE_PUBLIC_KEY), ALICE_PRIVATE_KEY),
    ).toBe(env);
  });
});
