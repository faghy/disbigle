// The diaspora* side of a Disbigle instance: discovery, receiving and delivery plumbing.
import {
  type CoreContext,
  domainBlockSeverity,
  findActorByHandle,
  findPostByGuid,
  upsertRemoteActor,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import {
  decryptMagicEnvelope,
  InvalidSignatureError,
  NotPublicError,
  parseDiasporaId,
  parseEntity,
  parseHCard,
  parseMagicEnvelope,
  parseWebFinger,
  type ReceivedMessage,
  type ReceiveOptions,
  type RelatedEntity,
  SignatureVerificationError,
  unenvelop,
  verifyReceivedEntity,
} from '@disbigle/diaspora';
import { eq } from 'drizzle-orm';
import {
  type ActorRow,
  actorById,
  diasporaIdOf,
  isPublicVisibility,
  type PostRow,
  podBaseUrl,
  postById,
} from './actors.ts';
import { type DeliverFn, httpDeliver, TaskQueue } from './delivery.ts';
import { applyEntity } from './incoming.ts';
import { localActorByGuid } from './outgoing.ts';

export interface DiasporaBridgeOptions {
  ctx: CoreContext;
  /** Outgoing POST; defaults to `fetch` with timeout and retries. Tests can intercept it. */
  deliver?: DeliverFn;
  /** HTTP GET used for discovery and fetching; defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
  /** Discovery over plain HTTP (tests and development only). */
  allowHttp?: boolean;
  /** Parallel background jobs. */
  concurrency?: number;
  /** Re-discover remote people older than this (default 24 hours). */
  refreshAfterMs?: number;
  /** Called with errors of background jobs (receiving and delivery). */
  onError?: (error: unknown) => void;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Connects the core to the diaspora* network. One instance per process; share it between the
 * Fastify routes (`diasporaRoutes`) and the event publisher (`DiasporaPublisher`).
 */
export class DiasporaBridge {
  readonly ctx: CoreContext;
  readonly queue: TaskQueue;
  private readonly deliverFn: DeliverFn;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly allowHttp: boolean;
  private readonly refreshAfterMs: number;

  constructor(options: DiasporaBridgeOptions) {
    this.ctx = options.ctx;
    this.deliverFn = options.deliver ?? httpDeliver();
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.allowHttp = options.allowHttp ?? false;
    this.refreshAfterMs = options.refreshAfterMs ?? DAY;
    this.queue = new TaskQueue(options.concurrency ?? 4, options.onError);
  }

  /** Queues a delivery; the body is built lazily (encryption happens in the background). */
  deliverLater(url: string, body: () => string, contentType: string): void {
    this.queue.push(() => this.deliverFn(url, body(), contentType));
  }

  /** Resolves when all queued work is done. */
  idle(): Promise<void> {
    return this.queue.idle();
  }

  // ---------------------------------------------------------------------------
  // Discovery

  private async get(url: string, accept: string): Promise<Response> {
    const response = await this.fetchFn(url, {
      headers: { accept },
      signal: AbortSignal.timeout(15_000),
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`GET ${url} answered ${response.status}`);
    return response;
  }

  /**
   * Finds a person by diaspora* ID: local people directly, remote people from the database or,
   * when unknown, stale or `refresh` is set, through WebFinger and hCard.
   */
  async resolvePerson(
    diasporaId: string,
    options: { refresh?: boolean } = {},
  ): Promise<ActorRow | null> {
    const id = parseDiasporaId(diasporaId);
    const ctx = this.ctx;
    if (id.host === ctx.config.LOCAL_DOMAIN.toLowerCase()) {
      return findActorByHandle(ctx, id.username, null);
    }
    const known = await findActorByHandle(ctx, id.username, id.host);
    const fresh =
      known?.lastFetchedAt && Date.now() - known.lastFetchedAt.getTime() < this.refreshAfterMs;
    if (known?.protocols.includes('diaspora') && known.diasporaGuid && fresh && !options.refresh) {
      return known;
    }
    if ((await domainBlockSeverity(ctx, id.host)) === 'suspend') return null;

    const scheme = this.allowHttp ? 'http' : 'https';
    const finger = await this.get(
      `${scheme}://${id.host}/.well-known/webfinger?resource=acct:${id.id}`,
      'application/jrd+json, application/json',
    );
    const info = parseWebFinger(await finger.text(), {
      expectedDiasporaId: id.id,
      requireDiaspora: true,
    });
    const hcardUrl = info.hcardUrl ?? '';
    const seedUrl = info.seedUrl ?? '';
    const hcard = parseHCard(await (await this.get(hcardUrl, 'text/html')).text());
    const seed = seedUrl.endsWith('/') ? seedUrl : `${seedUrl}/`;
    const name =
      hcard.fullName ?? [hcard.firstName, hcard.lastName].filter(Boolean).join(' ').trim();
    return upsertRemoteActor(ctx, {
      username: id.username,
      domain: id.host,
      protocol: 'diaspora',
      displayName: name || id.username,
      avatarUrl: hcard.photoLargeUrl,
      discoverable: hcard.searchable,
      publicKeyPem: hcard.publicKey,
      diasporaGuid: hcard.guid,
      diasporaReceiveUrl: new URL(`receive/users/${hcard.guid}`, seed).href,
      ...(!known?.apUrl && info.profileUrl ? { apUrl: info.profileUrl } : {}),
    });
  }

  /** `CoreContext.resolveAccount` implementation for diaspora* people (`username`, `domain`). */
  resolveAccount = async (username: string, domain: string): Promise<string | null> => {
    try {
      return (await this.resolvePerson(`${username}@${domain}`))?.id ?? null;
    } catch {
      return null;
    }
  };

  // ---------------------------------------------------------------------------
  // Related entities

  /** Describes a stored post for the protocol checks (author, locality, parents). */
  async relatedOfPost(post: PostRow, depth = 0): Promise<RelatedEntity | null> {
    const actor = await actorById(this.ctx, post.actorId);
    if (!actor) return null;
    const parentPost =
      post.inReplyToId && depth < 50 ? await postById(this.ctx, post.inReplyToId) : null;
    const parent = parentPost ? await this.relatedOfPost(parentPost, depth + 1) : null;
    return {
      author: diasporaIdOf(this.ctx, actor),
      local: post.local,
      public: isPublicVisibility(post.visibility),
      ...(parent ? { parent } : {}),
    };
  }

  private async relatedEntity(
    type: string,
    guid: string,
    senderId: string | undefined,
    depth: number,
  ): Promise<RelatedEntity | null> {
    const ctx = this.ctx;
    if (type === 'Like') {
      const [row] = await ctx.db
        .select()
        .from(schema.likes)
        .where(eq(schema.likes.diasporaGuid, guid));
      if (!row) return null;
      const [actor, post] = await Promise.all([
        actorById(ctx, row.actorId),
        postById(ctx, row.postId),
      ]);
      if (!actor || !post) return null;
      const parent = await this.relatedOfPost(post);
      return {
        author: diasporaIdOf(ctx, actor),
        local: actor.domain === null,
        ...(parent ? { parent } : {}),
      };
    }
    if (!['Post', 'StatusMessage', 'Reshare', 'Comment'].includes(type)) return null;
    let post = await findPostByGuid(ctx, guid);
    if (!post && senderId && depth < 1 && type !== 'Comment') {
      await this.fetchRemote('post', guid, senderId, depth).catch(() => undefined);
      post = await findPostByGuid(ctx, guid);
    }
    return post ? this.relatedOfPost(post) : null;
  }

  /** Fetches a public entity from the server of `fromId` (`/fetch/:type/:guid`) and receives it. */
  private async fetchRemote(type: string, guid: string, fromId: string, depth: number) {
    const from = await this.resolvePerson(fromId);
    const base = from ? podBaseUrl(from) : null;
    if (!base) return;
    const response = await this.get(
      `${base}fetch/${type}/${guid}`,
      'application/magic-envelope+xml',
    );
    await this.process(await response.text(), { isPublic: true, depth: depth + 1 });
  }

  // ---------------------------------------------------------------------------
  // Receiving

  /** Queues a `/receive/public` body for processing. */
  enqueuePublic(body: string): void {
    this.queue.push(async () => {
      await this.process(body, { isPublic: true });
    });
  }

  /** Queues a `/receive/users/:guid` body; false when the recipient is unknown. */
  async enqueuePrivate(recipientGuid: string, body: string): Promise<boolean> {
    const recipient = await localActorByGuid(this.ctx, recipientGuid);
    if (!recipient) return false;
    this.queue.push(async () => {
      await this.receivePrivate(recipient, body);
    });
    return true;
  }

  /** Processes a public delivery now. Returns the verified message, or null if it was dropped. */
  receivePublic(body: string): Promise<ReceivedMessage | null> {
    return this.process(body, { isPublic: true });
  }

  /** Processes a private delivery for a local recipient now. */
  async receivePrivate(recipient: ActorRow, body: string): Promise<ReceivedMessage | null> {
    const [user] = await this.ctx.db
      .select({ key: schema.users.privateKeyPem })
      .from(schema.users)
      .where(eq(schema.users.actorId, recipient.id));
    if (!user) return null;
    const envelope = decryptMagicEnvelope(body, user.key);
    return this.process(envelope, { isPublic: false, recipient });
  }

  private async process(
    envelopeXml: string,
    options: { isPublic: boolean; recipient?: ActorRow; depth?: number },
  ): Promise<ReceivedMessage | null> {
    const ctx = this.ctx;
    const depth = options.depth ?? 0;
    const structure = parseMagicEnvelope(envelopeXml);
    const senderHint = structure.keyId;
    if (senderHint) {
      const host = parseDiasporaId(senderHint).host;
      if ((await domainBlockSeverity(ctx, host)) === 'suspend') return null;
    }

    const refresh = new Set<string>();
    const fetchPublicKey = async (id: string) => {
      const actor = await this.resolvePerson(id, { refresh: refresh.has(id) });
      return actor?.publicKeyPem ?? null;
    };
    const receiveOptions: ReceiveOptions = {
      fetchPublicKey,
      fetchRelatedEntity: (type, guid) => this.relatedEntity(type, guid, senderHint, depth),
    };
    const attempt = async (): Promise<ReceivedMessage> => {
      const { sender, payloadXml } = await unenvelop(envelopeXml, { fetchPublicKey });
      const entity = parseEntity(payloadXml);
      const related = await verifyReceivedEntity(entity, sender, receiveOptions);
      return { sender, entity, payloadXml, ...(related ? { related } : {}) };
    };

    let message: ReceivedMessage;
    try {
      message = await attempt();
    } catch (error) {
      if (
        !(error instanceof InvalidSignatureError || error instanceof SignatureVerificationError)
      ) {
        throw error;
      }
      // Keys may have changed (account migration, reinstall): re-discover once and retry.
      if (senderHint) refresh.add(senderHint);
      try {
        const author = (parseEntity(structure.payload.toString('utf8')) as { author?: string })
          .author;
        if (author) refresh.add(author);
      } catch {
        // the retry reports the real problem
      }
      message = await attempt();
    }

    if (options.isPublic) assertPublic(message);
    await applyEntity(this, message, options.recipient);
    return message;
  }
}

function assertPublic({ entity }: ReceivedMessage): void {
  if (entity.type !== 'StatusMessage' && entity.type !== 'Photo' && entity.type !== 'Profile') {
    return;
  }
  if (entity.public) return;
  if (
    entity.type === 'Profile' &&
    [entity.bio, entity.birthday, entity.gender, entity.location].every((v) => v === undefined)
  ) {
    return;
  }
  throw new NotPublicError(`received entity ${entity.type} should be public`);
}

/** A `CoreContext.resolveAccount`-style resolver. */
export type AccountResolver = (username: string, domain: string) => Promise<string | null>;

/**
 * Chains resolvers: the first non-null answer wins. Typical use:
 * `ctx.resolveAccount = chainResolvers(activityPubResolver, bridge.resolveAccount)`.
 */
export function chainResolvers(...resolvers: Array<AccountResolver | undefined>): AccountResolver {
  return async (username, domain) => {
    for (const resolve of resolvers) {
      if (!resolve) continue;
      const id = await resolve(username, domain).catch(() => null);
      if (id) return id;
    }
    return null;
  };
}
