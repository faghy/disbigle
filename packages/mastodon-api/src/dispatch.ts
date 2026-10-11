import type { FastifyInstance } from 'fastify';

/**
 * Routing constraint that lets the Mastodon API and our native API share `/api/v1/...` paths.
 * Mastodon routes are registered with `{ constraints: { [FLAVOUR_CONSTRAINT]: 'mastodon' } }`;
 * native routes have no constraint. find-my-way picks the constrained route when the derived
 * value matches and falls back to the unconstrained (native) one otherwise.
 */
export const FLAVOUR_CONSTRAINT = 'disbigleApiFlavour';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Serve this Mastodon route for every request, not only Mastodon-flavoured ones. */
    anyFlavour?: boolean;
  }
}

export type Flavour = 'mastodon' | 'native';

/** The explicit override header: `X-Disbigle-Api: native` or `mastodon`. */
export const FLAVOUR_HEADER = 'x-disbigle-api';

interface RawRequestLike {
  url?: string | undefined;
  headers: Record<string, string | string[] | undefined>;
}

export interface FlavourOptions {
  /** Flavour for requests with no credentials and no hint (default `mastodon`). */
  anonymous: Flavour;
  /** Name of the web session cookie (requests carrying it are native). */
  sessionCookie: string;
}

/**
 * Decides which API a request is meant for, in this order:
 * 1. `X-Disbigle-Api` header, when present;
 * 2. an OAuth token (`Authorization: Bearer`, `access_token=` query, or a WebSocket subprotocol) → mastodon;
 * 3. the web session cookie → native;
 * 4. `Sec-Fetch-Site: same-origin` (a browser page of this site, i.e. our web client) → native;
 * 5. otherwise `options.anonymous`.
 * Paths outside `/api/` are not affected.
 */
export function deriveFlavour(req: RawRequestLike, options: FlavourOptions): Flavour | undefined {
  const url = req.url ?? '';
  if (!url.startsWith('/api/')) return undefined;
  const header = (name: string) => {
    const value = req.headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const explicit = header(FLAVOUR_HEADER);
  if (explicit === 'native' || explicit === 'mastodon') return explicit;
  if (/^bearer\s/i.test(header('authorization') ?? '')) return 'mastodon';
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  if (/(^|&)access_token=/.test(query)) return 'mastodon';
  if (header('upgrade')?.toLowerCase() === 'websocket' && header('sec-websocket-protocol')) {
    return 'mastodon';
  }
  const cookie = header('cookie') ?? '';
  if (cookie.split(/;\s*/).some((c) => c.startsWith(`${options.sessionCookie}=`))) return 'native';
  if (header('sec-fetch-site') === 'same-origin') return 'native';
  return options.anonymous;
}

type ConstraintStrategy = Parameters<FastifyInstance['addConstraintStrategy']>[0];

export function flavourStrategy(options: FlavourOptions): ConstraintStrategy {
  return {
    name: FLAVOUR_CONSTRAINT,
    storage() {
      const handlers = new Map<string, unknown>();
      return {
        get: (value: string) => (handlers.get(value) ?? null) as never,
        set: (value: string, store: unknown) => {
          handlers.set(value, store);
        },
      };
    },
    deriveConstraint: (req: RawRequestLike) => deriveFlavour(req, options) as string,
    mustMatchWhenDerived: false,
    validate(value: unknown) {
      if (value !== 'mastodon' && value !== 'native') throw new Error(`Invalid flavour ${value}`);
    },
  } as ConstraintStrategy;
}
