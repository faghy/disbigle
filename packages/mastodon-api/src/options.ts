import type { ActorRow, CoreContext, MediaStorage } from '@disbigle/core';
import type { Flavour } from './dispatch.ts';
import type { OAuthStore } from './oauth/store.ts';
import type { MastodonPushStore } from './push/store.ts';

/** A socket as the streaming hub sees it. */
export interface HubSocket {
  send(data: string): void;
  readonly readyState: number;
}

/**
 * What the Mastodon streaming endpoint needs from the server's StreamingHub
 * (`apps/server/src/streaming.ts`), which satisfies it as is: we register a proxy socket that
 * re-encodes the hub's native messages for each Mastodon client.
 */
export interface StreamingHubLike {
  add(socket: HubSocket, actorId: string | null): { streams: Set<string> };
  remove(connection: { streams: Set<string> }): void;
}

export interface MastodonApiOptions {
  ctx: CoreContext;
  /** OAuth persistence: `DrizzleOAuthStore` in production, `MemoryOAuthStore` in tests. */
  store: OAuthStore;
  /**
   * Mastodon Web Push subscriptions (`DrizzleMastodonPushStore` once the columns exist). Without
   * it, `/api/v1/push/subscription` answers that push is not available.
   */
  pushStore?: MastodonPushStore;
  /** Where uploads go; local `MEDIA_DIR` by default (same default as the server). */
  storage?: MediaStorage;
  /** Streaming hub; without it `/api/v1/streaming` is not served by this plugin. */
  hub?: StreamingHubLike;
  /** Finds or fetches a remote account (`user@domain` or URL), for `resolve=true` searches. */
  resolveAccount?: (query: string) => Promise<ActorRow | null>;
  /** Fetches a remote post by URL, returning its local id, for `resolve=true` searches. */
  resolveStatus?: (url: string) => Promise<string | null>;
  /** Loads recent posts of a remote account the first time its profile is opened. */
  backfillAccount?: (actor: ActorRow) => Promise<unknown>;
  /**
   * `shared` (default): Mastodon routes live on the same `/api/v1` paths as the native API and are
   * selected per request (see `deriveFlavour`). `exclusive`: the native API lives elsewhere and
   * every `/api/v1`, `/api/v2` request is a Mastodon request.
   */
  dispatch?: 'shared' | 'exclusive';
  /** In `shared` mode, flavour of requests without credentials or hints. Default `mastodon`. */
  anonymous?: Flavour;
  /** Web session cookie name. Default `disbigle_session`. */
  sessionCookie?: string;
  /** Web sign-in page; `?redirect=` carries the authorize URL. Default `/login`. */
  loginPath?: string;
  /** Disbigle version, reported inside the Mastodon-compatible version string. */
  softwareVersion?: string;
}

export interface Deps {
  ctx: CoreContext;
  mediaCtx: CoreContext & { storage: MediaStorage };
  store: OAuthStore;
  options: MastodonApiOptions & {
    sessionCookie: string;
    loginPath: string;
    softwareVersion: string;
  };
  baseUrl: string;
}

/** Mastodon version we claim (features up to 4.2: no grouped notifications, no v2 notification policy). */
export const MASTODON_COMPAT_VERSION = '4.2.0';
