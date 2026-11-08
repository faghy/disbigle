import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  if (family === 6 && address.toLowerCase().startsWith('::ffff:')) {
    const v4 = address.slice(7);
    if (isIP(v4) === 4) return blocked.check(v4, 'ipv4');
  }
  return blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Refuses URLs whose host resolves to a private, loopback or link-local address, before we send
 * anything to a URL chosen by someone else (push endpoints).
 */
export async function assertPublicUrl(url: string): Promise<void> {
  const { hostname, protocol } = new URL(url);
  if (protocol !== 'https:') throw new Error('Only https URLs are allowed');
  const host = hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error(`Refusing to connect to ${hostname}: not a public address`);
  }
}

/**
 * GET a URL chosen by someone else (link previews) without reaching private networks: every
 * hop is checked (DNS resolved, private and local addresses refused), redirects are followed
 * by hand and the body is capped.
 */
export async function safeGet(
  url: string,
  options: {
    maxBytes: number;
    accept?: string;
    timeoutMs?: number;
    userAgent?: string;
    /** Tests only. */
    allowPrivateAddress?: boolean;
  },
): Promise<{ data: Buffer; type: string }> {
  let current = new URL(url);
  for (let hop = 0; hop <= 3; hop++) {
    if (current.protocol !== 'https:' && current.protocol !== 'http:')
      throw new Error('Unsupported scheme');
    if (!options.allowPrivateAddress) {
      const host = current.hostname.replace(/^\[|\]$/g, '');
      const addresses = isIP(host)
        ? [host]
        : (await lookup(host, { all: true })).map((a) => a.address);
      if (addresses.length === 0 || addresses.some(isPrivateAddress))
        throw new Error('Not a public address');
    }
    const response = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
      headers: {
        'user-agent':
          options.userAgent ??
          'Mozilla/5.0 (compatible; Disbigle link preview; +https://disbigle.com)',
        ...(options.accept ? { accept: options.accept } : {}),
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect without location');
      current = new URL(location, current);
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    if (Number(response.headers.get('content-length') ?? 0) > options.maxBytes)
      throw new Error('Too large');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > options.maxBytes) throw new Error('Too large');
      chunks.push(Buffer.from(chunk));
    }
    return { data: Buffer.concat(chunks), type: response.headers.get('content-type') ?? '' };
  }
  throw new Error('Too many redirects');
}
