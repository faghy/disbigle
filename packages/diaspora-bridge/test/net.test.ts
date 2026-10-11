import { isIP } from 'node:net';
import { validatePublicUrl } from '@fedify/vocab-runtime';
import { describe, expect, it } from 'vitest';
import { httpDeliver } from '../src/delivery.ts';
import { checkUrl, guardedFetch, readLimited, UnsafeUrlError } from '../src/net.ts';

/** Real address check for IP literals; names are accepted without DNS (offline tests). */
const validateUrl = async (url: string) => {
  if (isIP(new URL(url).hostname.replace(/^\[|\]$/g, ''))) await validatePublicUrl(url);
};

const redirectTo = (location: string) => new Response(null, { status: 302, headers: { location } });

describe('checkUrl', () => {
  it('accepts public http(s) URLs', async () => {
    await expect(
      checkUrl('https://pod.example.org/receive/public', { validateUrl }),
    ).resolves.toBeUndefined();
    await expect(checkUrl('https://8.8.8.8/', { validateUrl })).resolves.toBeUndefined();
  });

  it('refuses private, loopback and link-local addresses, other schemes and credentials', async () => {
    for (const url of [
      'http://127.0.0.1/x',
      'http://localhost/x',
      'http://10.0.0.5/x',
      'http://192.168.1.1/x',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/x',
      'ftp://pod.example.org/x',
      'file:///etc/passwd',
      'https://user:pw@pod.example.org/',
      'not a url',
    ]) {
      await expect(checkUrl(url, { validateUrl }), url).rejects.toThrow(UnsafeUrlError);
    }
  });

  it('allows private addresses only when asked to (tests)', async () => {
    await expect(
      checkUrl('http://127.0.0.1/x', { allowPrivateAddress: true }),
    ).resolves.toBeUndefined();
    await expect(checkUrl('ftp://127.0.0.1/x', { allowPrivateAddress: true })).rejects.toThrow(
      UnsafeUrlError,
    );
  });
});

describe('guardedFetch', () => {
  it('checks every redirect hop', async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(url);
      return redirectTo('http://169.254.169.254/latest/meta-data');
    }) as unknown as typeof fetch;
    await expect(
      guardedFetch(fetchFn, 'https://pod.example.org/hcard', {}, { validateUrl }),
    ).rejects.toThrow(UnsafeUrlError);
    expect(calls).toEqual(['https://pod.example.org/hcard']);
  });

  it('follows at most three redirects', async () => {
    let n = 0;
    const fetchFn = (async () =>
      redirectTo(`https://pod.example.org/${++n}`)) as unknown as typeof fetch;
    await expect(
      guardedFetch(fetchFn, 'https://pod.example.org/0', {}, { validateUrl }),
    ).rejects.toThrow(/too many redirects/);
    expect(n).toBe(4);
  });

  it('caps response bodies', async () => {
    const big = new Response('x'.repeat(2048));
    await expect(readLimited(big, 1024)).rejects.toThrow(UnsafeUrlError);
    expect(await readLimited(new Response('ok'), 1024)).toBe('ok');
  });
});

describe('httpDeliver', () => {
  it('never POSTs to a private address', async () => {
    let called = false;
    const deliver = httpDeliver({
      validateUrl,
      fetch: (async () => {
        called = true;
        return new Response('');
      }) as unknown as typeof fetch,
    });
    await expect(deliver('http://192.168.1.10/receive/public', 'x', 'text/plain')).rejects.toThrow(
      UnsafeUrlError,
    );
    expect(called).toBe(false);
  });
});
