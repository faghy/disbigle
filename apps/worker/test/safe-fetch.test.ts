import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { safeFetch } from '../src/safe-fetch.ts';

let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/image' });
      res.end();
    } else if (req.url === '/big') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(Buffer.alloc(2048));
    } else {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(Buffer.from('fake image'));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('safeFetch', () => {
  it('refuses private and loopback addresses', async () => {
    await expect(safeFetch(`${base}/image`, { maxBytes: 1024 })).rejects.toThrow();
    await expect(safeFetch('http://10.0.0.1/x', { maxBytes: 1024 })).rejects.toThrow();
    await expect(safeFetch('file:///etc/passwd', { maxBytes: 1024 })).rejects.toThrow();
  });

  it('follows redirects and caps the body size (private addresses allowed in tests)', async () => {
    const result = await safeFetch(`${base}/redirect`, {
      maxBytes: 1024,
      allowPrivateAddress: true,
    });
    expect(result.data.toString()).toBe('fake image');
    expect(result.type).toBe('image/png');
    await expect(
      safeFetch(`${base}/big`, { maxBytes: 1024, allowPrivateAddress: true }),
    ).rejects.toThrow('Too large');
  });
});
