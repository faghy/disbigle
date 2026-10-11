// The diaspora* side of a Disbigle instance: discovery, receiving and delivery plumbing.
import { isLocalDomain } from '@disbigle/config';
import {
  type CoreContext,
  DomainError,
  domainBlockSeverity,
  findActorByHandle,
  findPostByGuid,
  upsertRemoteActor,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import {
  DiasporaError,
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
  RelatedEntityNotFoundError,
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
import { type DeliverFn, DeliveryHttpError, httpDeliver } from './delivery.ts';
import { applyEntity } from './incoming.ts';
import {
  checkUrl,
  guardedFetch,
  type NetOptions,
  podFetch,
  readLimited,
  UnsafeUrlError,
} from './net.ts';
import { localActorByGuid } from './outgoing.ts';
import { pollByGuid } from './polls.ts';
import {
  type DiasporaJob,
  type FailureListener,
  type JobQueue,
  type ListenOptions,
  MemoryJobQueue,
  PermanentJobError,
} from './queue.ts';
import { MemoryRelayableStore, type RelayableStore } from './relayables.ts';

export interface DiasporaBridgeOptions {
  ctx: CoreContext;
  /** Outgoing POST; defaults to `fetch` with timeout and retries. Tests can intercept it. */
  deliver?: DeliverFn;
  /** HTTP GET used for discovery and fetching; defaults to `podFetch` (HTTP/2 allowed). */
  fetch?: typeof globalThis.fetch;
  /** Discovery over plain HTTP (tests and development only). */
  allowHttp?: boolean;
  /** Contact private, loopback and link-local addresses (tests and development only). */
  allowPrivateAddress?: boolean;
  /** Replaces the public-address check (tests). */
  validateUrl?: (url: string) => Promise<void>;
  /**
   * Background job queue. Defaults to an in-memory queue consumed in this process; pass a
   * `RedisJobQueue` for persistence and consume it with `startDiasporaQueue` (server or worker).
   */
  queue?: JobQueue;
  /** Consume the queue in this process. Defaults to true for the in-memory queue only. */
  consume?: boolean;
  /** Parallel jobs when consuming here. */
  concurrency?: number;
  /** Received relayables, for late relaying and `/fetch`. In memory by default. */
  relayables?: RelayableStore;
  /** Re-discover remote people older than this (default 24 hours). */
  refreshAfterMs?: number;
  /** Called when a job of the default in-memory queue fails for good. */
  onError?: (error: unknown) => void;
}

/** Something that handles domain events in jobs (the `DiasporaPublisher`). */
export interface EventJobHandler {
  handle(event: Extract<DiasporaJob, { type: 'event' }>['event']): Promise<void>;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Connects the core to the diaspora* network. One instance per process; share it between the
 * Fastify routes (`diasporaRoutes`) and the event publisher (`DiasporaPublisher`).
 */
export class DiasporaBridge {
  readonly ctx: CoreContext;
  readonly queue: JobQueue;
  readonly relayables: RelayableStore;
  private publisher: EventJobHandler | undefined;
  private readonly deliverFn: DeliverFn;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly allowHttp: boolean;
  private readonly net: NetOptions;
  private readonly refreshAfterMs: number;

  constructor(options: DiasporaBridgeOptions) {
    this.ctx = options.ctx;
    this.net = {
      ...(options.allowPrivateAddress ? { allowPrivateAddress: true } : {}),
      ...(options.validateUrl ? { validateUrl: options.validateUrl } : {}),
    };
    this.deliverFn = options.deliver ?? httpDeliver(this.net);
    this.fetchFn = options.fetch ?? podFetch;
    this.allowHttp = options.allowHttp ?? false;
    this.refreshAfterMs = options.refreshAfterMs ?? DAY;
    const onFailure: FailureListener | undefined = options.onError
      ? (error) => options.onError?.(error)
      : undefined;
    this.queue = options.queue ?? new MemoryJobQueue(onFailure ? { onFailure } : {});
    this.relayables = options.relayables ?? new MemoryRelayableStore();
    if (options.consume ?? !options.queue) {
      void this.startQueue({ concurrency: options.concurrency ?? 4 });
    }
  }

  /** Lets the publisher handle `event` jobs (called by `DiasporaPublisher`). */
  attachPublisher(publisher: EventJobHandler): void {
    this.publisher = publisher;
  }

  /** Consumes the job queue in this process until `signal` aborts. */
  startQueue(options: ListenOptions = {}): Promise<void> {
    return this.queue.listen((job) => this.runJob(job), options);
  }

  /** Queues one delivery. */
  async deliverLater(url: string, body: string, contentType: string): Promise<void> {
    await this.queue.enqueue({ type: 'deliver', url, body, contentType });
  }

  /** Resolves when all queued work is done. */
  idle(): Promise<void> {
    return this.queue.idle();
  }

  /** Runs one job. Errors that retrying cannot fix become `PermanentJobError`. */
  async runJob(job: DiasporaJob): Promise<void> {
    try {
      switch (job.type) {
        case 'deliver':
          // Receive URLs come from remote documents: never POST to a private address.
          await checkUrl(job.url, this.net);
          await this.deliverFn(job.url, job.body, job.contentType);
          return;
        case 'receive-public':
          await this.process(job.body, { isPublic: true });
          return;
        case 'receive-private': {
          const recipient = await localActorByGuid(this.ctx, job.recipientGuid);
          if (recipient) await this.receivePrivate(recipient, job.body);
          return;
        }
        case 'event':
          await this.publisher?.handle(job.event);
          return;
      }
    } catch (error) {
      if (isPermanent(error)) {
        throw new PermanentJobError(error instanceof Error ? error.message : String(error), {
          cause: error,
        });
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Discovery

  /** Guarded GET of a remote document (URL check on every hop, 1 MB cap). */
  private async get(url: string, accept: string): Promise<string> {
    const response = await guardedFetch(
      this.fetchFn,
      url,
      { headers: { accept }, signal: AbortSignal.timeout(15_000) },
      this.net,
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`GET ${url} answered ${response.status}`);
    }
    return readLimited(response);
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
    if (isLocalDomain(ctx.config, id.host)) {
      return findActorByHandle(ctx, id.username, null);
    }
    const known = await findActorByHandle(ctx, id.username, id.host);
    const fresh =
      known?.lastFetchedAt && Date.now() - known.lastFetchedAt.getTime() < this.refreshAfterMs;
    if (known?.protocols.includes('diaspora') && known.diasporaGuid && fresh && !options.refresh) {
      return known;
    }
    if ((await domainBlockSeverity(ctx, id.host)) === 'suspend') return null;

    try {
      return await this.discover(id.id, id.username, id.host, known);
    } catch (error) {
      // Keep using what we know when the remote server is temporarily unreachable.
      if (known?.protocols.includes('diaspora') && known.diasporaGuid && !options.refresh)
        return known;
      throw error;
    }
  }

  private async discover(
    diasporaId: string,
    username: string,
    host: string,
    known: ActorRow | null,
  ): Promise<ActorRow> {
    const ctx = this.ctx;
    const id = { id: diasporaId, username, host };
    const scheme = this.allowHttp ? 'http' : 'https';
    const finger = await this.get(
      `${scheme}://${id.host}/.well-known/webfinger?resource=acct:${id.id}`,
      'application/jrd+json, application/json',
    );
    const info = parseWebFinger(finger, {
      expectedDiasporaId: id.id,
      requireDiaspora: true,
    });
    const hcardUrl = info.hcardUrl ?? '';
    const seedUrl = info.seedUrl ?? '';
    const hcard = parseHCard(await this.get(hcardUrl, 'text/html'));
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
    if (type === 'Poll') {
      // A poll belongs to its post: same author and locality.
      const poll = await pollByGuid(ctx, guid);
      const post = poll ? await postById(ctx, poll.postId) : null;
      return post ? this.relatedOfPost(post) : null;
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
    await this.process(response, { isPublic: true, depth: depth + 1 });
  }

  // ---------------------------------------------------------------------------
  // Receiving

  /** Queues a `/receive/public` body for processing. */
  async enqueuePublic(body: string): Promise<void> {
    await this.queue.enqueue({ type: 'receive-public', body });
  }

  /** Queues a `/receive/users/:guid` body; false when the recipient is unknown. */
  async enqueuePrivate(recipientGuid: string, body: string): Promise<boolean> {
    const recipient = await localActorByGuid(this.ctx, recipientGuid);
    if (!recipient) return false;
    await this.queue.enqueue({ type: 'receive-private', recipientGuid, body });
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

/** Errors that will not go away by retrying the job. */
function isPermanent(error: unknown): boolean {
  if (error instanceof PermanentJobError || error instanceof UnsafeUrlError) return true;
  if (error instanceof DeliveryHttpError) return error.permanent;
  // A parent or target may still arrive (or be fetched) later.
  if (error instanceof RelatedEntityNotFoundError) return false;
  // Bad signatures, invalid XML, unknown entities, refused by the core...
  return error instanceof DiasporaError || error instanceof DomainError;
}

/** Consumes the bridge job queue (server or worker process) until `signal` aborts. */
export function startDiasporaQueue(bridge: DiasporaBridge, options: ListenOptions = {}) {
  return bridge.startQueue(options);
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
