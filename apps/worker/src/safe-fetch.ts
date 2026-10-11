import { validatePublicUrl } from '@fedify/fedify';

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Tests only. */
  allowPrivateAddress?: boolean;
}

/**
 * GET a remote URL without letting it reach private networks: every hop is validated (DNS resolved,
 * private/loopback/link-local refused), redirects are followed manually, and the body is capped.
 */
export async function safeFetch(
  url: string,
  options: SafeFetchOptions,
): Promise<{ data: Buffer; type: string }> {
  let current = new URL(url);
  for (let hop = 0; hop <= (options.maxRedirects ?? 3); hop++) {
    if (current.protocol !== 'https:' && current.protocol !== 'http:')
      throw new Error('Unsupported scheme');
    if (!options.allowPrivateAddress) await validatePublicUrl(current.href);
    const response = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      headers: { 'user-agent': 'Disbigle media cache' },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect without location');
      current = new URL(location, current);
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > options.maxBytes) throw new Error('Too large');
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
