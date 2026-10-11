import { generateKeyPairSync } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { schema } from '@disbigle/db';
import { buildHCard, buildWebFinger } from '@disbigle/diaspora';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freePort, type Instance, signUp, startInstance } from './helpers.ts';

let a: Instance;
let b: Instance;
let m: Server;
let mPort = 0;
const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
let victimGuid = '';

beforeAll(async () => {
  [a, b] = await Promise.all([startInstance(), startInstance()]);
  mPort = await freePort();
  m = createServer((req, res) => {
    const host = `127.0.0.1:${mPort}`;
    const url = new URL(req.url ?? '/', `http://${host}`);
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        void body;
        res.statusCode = 202;
        res.end();
      });
      return;
    }
    if (url.pathname === '/.well-known/webfinger') {
      res.setHeader('content-type', 'application/jrd+json');
      res.end(
        JSON.stringify(
          buildWebFinger({
            diasporaId: `mallory@${host}`,
            hcardUrl: `http://${host}/hcard/users/x`,
            seedUrl: `http://${host}/`,
          }),
        ),
      );
      return;
    }
    if (url.pathname.startsWith('/hcard/')) {
      res.setHeader('content-type', 'text/html');
      res.end(
        buildHCard({
          guid: victimGuid,
          nickname: 'mallory',
          fullName: 'Mallory',
          firstName: 'Mallory',
          lastName: '',
          publicKey: keys.publicKey,
          photoLargeUrl: `http://${host}/a.png`,
          photoMediumUrl: `http://${host}/a.png`,
          photoSmallUrl: `http://${host}/a.png`,
          searchable: true,
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => m.listen(mPort, '127.0.0.1', () => r()));
}, 90_000);

afterAll(async () => {
  m?.close();
  await Promise.all([a?.close(), b?.close()]);
});

describe('diaspora: guid takeover', () => {
  it('an hcard reusing another account guid is refused', async () => {
    const alice = await signUp(a);
    const bob = await signUp(b);
    const bobOnA = await a.bridge.resolvePerson(bob.diasporaId);
    if (!bobOnA?.diasporaGuid) throw new Error('no bob');
    victimGuid = bobOnA.diasporaGuid;
    const originalKey = bobOnA.publicKeyPem;

    const mallory = await a.bridge.resolvePerson(`mallory@127.0.0.1:${mPort}`).catch(() => null);
    expect(mallory?.id).not.toBe(bobOnA.id);
    const [row] = await a.ctx.db
      .select()
      .from(schema.actors)
      .where(eq(schema.actors.id, bobOnA.id));
    expect(row?.publicKeyPem).toBe(originalKey);
    expect(row?.username).toBe(bobOnA.username);
    expect(row?.domain).toBe(bobOnA.domain);
    void alice;
  }, 60_000);
});
