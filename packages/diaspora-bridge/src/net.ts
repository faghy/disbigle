// Outgoing HTTP guarded against SSRF: every URL that comes from a remote document is checked
// (http/https only, no private, loopback or link-local addresses), redirects are followed by
// hand with the same check on each hop, and response bodies are size-capped.
import { UrlError, validatePublicUrl } from '@fedify/vocab-runtime';
import { Agent, fetch as undiciFetch } from 'undici';

export interface NetOptions {
  /** Skip the private-address check (tests and local development only). */
  allowPrivateAddress?: boolean;
  /** Address check; defaults to Fedify's `validatePublicUrl` (resolves DNS). */
  validateUrl?: (url: string) => Promise<void>;
}

/** A URL we refuse to contact. Retrying cannot help. */
export class UnsafeUrlError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UnsafeUrlError';
  }
}

/** Throws `UnsafeUrlError` unless `url` is an http(s) URL on a public address. */
export async function checkUrl(url: string, options: NetOptions = {}): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new UnsafeUrlError(`invalid URL: ${url}`, { cause: error });
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new UnsafeUrlError(`unsupported scheme: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) throw new UnsafeUrlError('credentials in URL');
  if (options.allowPrivateAddress) return;
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new UnsafeUrlError(`refusing to contact ${parsed.host}`);
  }
  try {
    await (options.validateUrl ?? validatePublicUrl)(parsed.href);
  } catch (error) {
    // A failed DNS lookup may be temporary: let the caller retry later.
    if (error instanceof UrlError && (error as UrlError & { reason?: string }).reason === 'dns') {
      throw error;
    }
    throw new UnsafeUrlError(`refusing to contact ${parsed.host}`, { cause: error });
  }
}

/**
 * Default `fetch` for talking to pods: undici with HTTP/2 allowed. Some pods only answer HTTP/2
 * (diaspora-fr.org closes HTTP/1.1 connections), and Node's global `fetch` speaks HTTP/1.1 only.
 */
const agent = new Agent({ allowH2: true, connect: { timeout: 15_000 } });
export const podFetch = ((input: string | URL, init?: RequestInit) =>
  undiciFetch(input, { ...(init as object), dispatcher: agent })) as unknown as typeof fetch;

export const MAX_REDIRECTS = 3;
/** Size cap for documents we download (WebFinger, hCard, fetched entities). */
export const MAX_BODY_BYTES = 1024 * 1024;

/**
 * `fetch` with the URL check on the first request and on every redirect hop
 * (at most `MAX_REDIRECTS`). Request method and body are kept across redirects.
 */
export async function guardedFetch(
  fetchFn: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  options: NetOptions = {},
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await checkUrl(current, options);
    const response = await fetchFn(current, { ...init, redirect: 'manual' });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      current = new URL(location, current).href;
      continue;
    }
    return response;
  }
  throw new UnsafeUrlError(`too many redirects from ${url}`);
}

/** Reads a response body as text, failing when it exceeds `maxBytes`. */
export async function readLimited(response: Response, maxBytes = MAX_BODY_BYTES): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    await response.body?.cancel();
    throw new UnsafeUrlError(`response too large (${declared} bytes)`);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new UnsafeUrlError(`response larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
