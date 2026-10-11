import {
  acceptFollowRequest,
  applyRemoteMove,
  block,
  bridgedAccountByUsername,
  type CoreContext,
  deleteRemoteActor,
  deleteRemotePost,
  domainBlockSeverity,
  findActorByApUri,
  findLocalActorByUsername,
  findPostByUri,
  follow,
  getInstanceSettings,
  ingestRemoteAnnounce,
  ingestRemotePost,
  isBridgeUsername,
  like,
  rejectFollowRequest,
  undoRemoteActivity,
  unfollow,
  updateRemotePollCounts,
  updateRemotePost,
  upsertRemoteActor,
  votePoll,
} from '@disbigle/core';
import { schema } from '@disbigle/db';
import {
  createFederation,
  type Federation,
  type InboxContext,
  type KvStore,
  type MessageQueue,
} from '@fedify/fedify';
import {
  Accept,
  type Actor,
  Announce,
  Application,
  Block,
  Create,
  Delete,
  Endpoints,
  Follow,
  isActor,
  Like,
  Move,
  Note,
  Person,
  Question,
  Reject,
  Tombstone,
  Undo,
  Update,
} from '@fedify/vocab';
import { and, count, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { bridgedNoteById } from './bridge.ts';
import {
  bridgedPerson,
  localActorToPerson,
  noteToPostData,
  postToNote,
  questionPoll,
  remoteActorData,
} from './convert.ts';
import {
  getBridgeKeyPairs,
  getInstanceKeyPairs,
  getLocalKeyPairs,
  INSTANCE_ACTOR,
} from './keys.ts';

const PAGE_SIZE = 40;
export const SOFTWARE_VERSION = '0.1.0';

export interface FederationOptions {
  kv: KvStore;
  queue?: MessageQueue;
  /** Tests only: lets two instances on localhost talk to each other. */
  allowPrivateAddress?: boolean;
  manuallyStartQueue?: boolean;
}

/** Stores (or refreshes) the sender of an activity and returns its row. */
async function storeActor(ctx: InboxContext<CoreContext>, actor: Actor | null) {
  if (!actor) return null;
  const data = await remoteActorData(ctx, actor);
  if (!data) return null;
  if (data.domain.toLowerCase() === ctx.data.config.LOCAL_DOMAIN.toLowerCase()) return null;
  // Servers suspended by the admins are ignored entirely.
  if ((await domainBlockSeverity(ctx.data, data.domain)) === 'suspend') return null;
  return upsertRemoteActor(ctx.data, data);
}

/**
 * A reply to a public thread started here is forwarded, as signed by its author, to the followers
 * of the thread's author (inbox forwarding, as Mastodon does), so they see the whole conversation.
 */
async function forwardToThreadFollowers(ctx: InboxContext<CoreContext>, postId: string) {
  const [post] = await ctx.data.db.select().from(schema.posts).where(eq(schema.posts.id, postId));
  if (!post?.threadRootId || post.threadRootId === post.id) return;
  if (post.visibility !== 'public' && post.visibility !== 'unlisted') return;
  const [root] = await ctx.data.db
    .select({ post: schema.posts, author: schema.actors })
    .from(schema.posts)
    .innerJoin(schema.actors, eq(schema.actors.id, schema.posts.actorId))
    .where(eq(schema.posts.id, post.threadRootId));
  if (!root?.post.local || root.author.domain !== null) return;
  if (root.post.visibility !== 'public' && root.post.visibility !== 'unlisted') return;
  await ctx.forwardActivity({ identifier: root.author.username }, 'followers', {
    skipIfUnsigned: true,
    preferSharedInbox: true,
  });
}

/** A local account whose owner asked for deletion (closed, not yet purged). */
async function deletedLocalActor(ctx: CoreContext, identifier: string) {
  const actor = await findLocalActorByUsername(ctx, identifier);
  if (!actor) return null;
  const [user] = await ctx.db
    .select({ deletionRequestedAt: schema.users.deletionRequestedAt })
    .from(schema.users)
    .where(eq(schema.users.actorId, actor.id));
  if (!user?.deletionRequestedAt) return null;
  return {
    actor,
    deletedAt: Temporal.Instant.fromEpochMilliseconds(user.deletionRequestedAt.getTime()),
  };
}

async function localActorByIdentifier(ctx: CoreContext, identifier: string) {
  const actor = await findLocalActorByUsername(ctx, identifier);
  return actor && !actor.suspendedAt ? actor : null;
}

const MAX_ANCESTOR_FETCH = 5;

/**
 * Fetches and stores the posts a reply answers when we don't have them yet, so threads arriving
 * from other servers are complete. Only public posts can be fetched; others are simply skipped.
 */
async function fetchMissingAncestors(
  ctx: InboxContext<CoreContext>,
  parentUri: URL | null,
): Promise<void> {
  const chain: Note[] = [];
  let next = parentUri;
  while (next && chain.length < MAX_ANCESTOR_FETCH) {
    if (await findPostByUri(ctx.data, next.href)) break;
    let object: unknown;
    try {
      object = await ctx.lookupObject(next);
    } catch {
      break;
    }
    if (!(object instanceof Note) || object.id?.href !== next.href) break;
    chain.push(object);
    next = object.replyTargetId;
  }
  // Store oldest first so each reply finds its parent.
  for (const note of chain.reverse()) {
    if (!note.attributionId) continue;
    const author = await ctx.lookupObject(note.attributionId).catch(() => null);
    if (!isActor(author)) continue;
    const authorRow = await storeActor(ctx, author);
    if (!authorRow || note.attributionId.href !== authorRow.apUri) continue;
    const data = await noteToPostData(ctx, note, authorRow);
    if (data) await ingestRemotePost(ctx.data, data);
  }
}

export function createDisbigleFederation(options: FederationOptions): Federation<CoreContext> {
  const federation = createFederation<CoreContext>({
    kv: options.kv,
    queue: options.queue,
    allowPrivateAddress: options.allowPrivateAddress ?? false,
    manuallyStartQueue: options.manuallyStartQueue ?? false,
    userAgent: { software: `Disbigle/${SOFTWARE_VERSION}` },
  });

  federation
    .setActorDispatcher('/users/{identifier}', async (ctx, identifier) => {
      if (identifier === INSTANCE_ACTOR) {
        const keys = await ctx.getActorKeyPairs(identifier);
        return new Application({
          id: ctx.getActorUri(identifier),
          preferredUsername: ctx.data.config.LOCAL_DOMAIN,
          name: (await getInstanceSettings(ctx.data)).title,
          inbox: ctx.getInboxUri(identifier),
          outbox: ctx.getOutboxUri(identifier),
          endpoints: new Endpoints({ sharedInbox: ctx.getInboxUri() }),
          publicKey: keys[0]?.cryptographicKey ?? null,
          assertionMethods: keys.map((k) => k.multikey),
          manuallyApprovesFollowers: true,
          url: new URL(`${ctx.data.config.PUBLIC_URL}/about`),
        });
      }
      if (isBridgeUsername(identifier)) {
        const bridged = await bridgedAccountByUsername(ctx.data, identifier);
        return bridged ? bridgedPerson(ctx, bridged, await ctx.getActorKeyPairs(identifier)) : null;
      }
      const actor = await localActorByIdentifier(ctx.data, identifier);
      if (actor) {
        const [moved] = actor.movedToActorId
          ? await ctx.data.db
              .select({ uri: schema.actors.apUri })
              .from(schema.actors)
              .where(eq(schema.actors.id, actor.movedToActorId))
          : [];
        return localActorToPerson(
          ctx,
          actor,
          await ctx.getActorKeyPairs(identifier),
          moved?.uri ?? null,
        );
      }
      // Accounts being deleted answer 410 Gone with a Tombstone.
      const deleted = await deletedLocalActor(ctx.data, identifier);
      return deleted
        ? new Tombstone({
            id: ctx.getActorUri(identifier),
            formerType: Person,
            deleted: deleted.deletedAt,
          })
        : null;
    })
    .mapHandle(async (ctx, username) => {
      // Mastodon checks that an actor's preferredUsername resolves back to it through WebFinger
      // before trusting its key: the instance actor is `<domain>@<domain>`, as on Mastodon.
      if (username.toLowerCase() === ctx.data.config.LOCAL_DOMAIN.toLowerCase())
        return INSTANCE_ACTOR;
      if (isBridgeUsername(username))
        return (await bridgedAccountByUsername(ctx.data, username))?.bridge.username ?? null;
      return (await localActorByIdentifier(ctx.data, username))?.username ?? null;
    })
    .setKeyPairsDispatcher(async (ctx, identifier) => {
      if (identifier === INSTANCE_ACTOR) return getInstanceKeyPairs(ctx.data);
      if (isBridgeUsername(identifier)) {
        const bridged = await bridgedAccountByUsername(ctx.data, identifier);
        return bridged ? getBridgeKeyPairs(bridged.bridge) : [];
      }
      // Deleted accounts keep their keys until purged, so their Delete activity can be signed.
      const actor =
        (await localActorByIdentifier(ctx.data, identifier)) ??
        (await deletedLocalActor(ctx.data, identifier))?.actor;
      return actor ? getLocalKeyPairs(ctx.data, actor.id) : [];
    });

  federation
    .setFollowersDispatcher('/users/{identifier}/followers', async (ctx, identifier, cursor) => {
      const actor =
        (await localActorByIdentifier(ctx.data, identifier)) ??
        (await deletedLocalActor(ctx.data, identifier))?.actor;
      if (!actor) return null;
      const { follows, actors } = schema;
      const rows = await ctx.data.db
        .select({ follow: follows, follower: actors })
        .from(follows)
        .innerJoin(actors, eq(actors.id, follows.actorId))
        .where(
          and(
            eq(follows.targetActorId, actor.id),
            sql`${actors.domain} is not null and ${actors.apInbox} is not null`,
            cursor ? lt(follows.id, cursor) : undefined,
          ),
        )
        .orderBy(desc(follows.id))
        .limit(cursor === null ? 10_000 : PAGE_SIZE);
      return {
        items: rows.map(({ follower }) => ({
          id: new URL(follower.apUri ?? ''),
          inboxId: new URL(follower.apInbox ?? ''),
          endpoints: follower.apSharedInbox
            ? { sharedInbox: new URL(follower.apSharedInbox) }
            : null,
        })),
        nextCursor:
          cursor !== null && rows.length === PAGE_SIZE ? (rows.at(-1)?.follow.id ?? null) : null,
      };
    })
    .setCounter(async (ctx, identifier) => {
      const actor = await localActorByIdentifier(ctx.data, identifier);
      if (!actor) return null;
      const [row] = await ctx.data.db
        .select({ n: count() })
        .from(schema.follows)
        .where(eq(schema.follows.targetActorId, actor.id));
      return row?.n ?? 0;
    })
    .setFirstCursor(() => '');

  federation
    .setFollowingDispatcher('/users/{identifier}/following', async (ctx, identifier, cursor) => {
      const actor = await localActorByIdentifier(ctx.data, identifier);
      if (!actor) return null;
      // Paged, newest first, like the followers collection.
      const { follows, actors } = schema;
      const rows = await ctx.data.db
        .select({ id: follows.id, uri: actors.apUri })
        .from(follows)
        .innerJoin(actors, eq(actors.id, follows.targetActorId))
        .where(and(eq(follows.actorId, actor.id), cursor ? lt(follows.id, cursor) : undefined))
        .orderBy(desc(follows.id))
        .limit(PAGE_SIZE);
      return {
        items: rows.filter((r) => r.uri).map((r) => new URL(r.uri ?? '')),
        nextCursor: rows.length === PAGE_SIZE ? (rows.at(-1)?.id ?? null) : null,
      };
    })
    .setCounter(async (ctx, identifier) => {
      const actor = await localActorByIdentifier(ctx.data, identifier);
      if (!actor) return null;
      const [row] = await ctx.data.db
        .select({ n: count() })
        .from(schema.follows)
        .where(eq(schema.follows.actorId, actor.id));
      return row?.n ?? 0;
    })
    .setFirstCursor(() => '');

  federation
    .setOutboxDispatcher('/users/{identifier}/outbox', async (ctx, identifier, cursor) => {
      const actor = await localActorByIdentifier(ctx.data, identifier);
      if (!actor) return null;
      const { posts } = schema;
      const rows = await ctx.data.db
        .select()
        .from(posts)
        .where(
          and(
            eq(posts.actorId, actor.id),
            eq(posts.visibility, 'public'),
            isNull(posts.reblogOfId),
            cursor ? lt(posts.id, cursor) : undefined,
          ),
        )
        .orderBy(desc(posts.id))
        .limit(PAGE_SIZE);
      const items = await Promise.all(
        rows.map(
          async (post) =>
            new Create({
              id: new URL(`${post.apUri}/activity`),
              actor: ctx.getActorUri(actor.username),
              object: await postToNote(ctx, post, actor),
              tos: (await postToNote(ctx, post, actor)).toIds,
              ccs: (await postToNote(ctx, post, actor)).ccIds,
              published: Temporal.Instant.fromEpochMilliseconds(post.createdAt.getTime()),
            }),
        ),
      );
      return { items, nextCursor: rows.length === PAGE_SIZE ? (rows.at(-1)?.id ?? null) : null };
    })
    .setCounter(async (ctx, identifier) => {
      const actor = await localActorByIdentifier(ctx.data, identifier);
      if (!actor) return null;
      const [row] = await ctx.data.db
        .select({ n: count() })
        .from(schema.posts)
        .where(and(eq(schema.posts.actorId, actor.id), eq(schema.posts.visibility, 'public')));
      return row?.n ?? 0;
    })
    .setFirstCursor(() => '');

  federation.setFeaturedDispatcher('/users/{identifier}/featured', async (ctx, identifier) => {
    const actor = await localActorByIdentifier(ctx.data, identifier);
    if (!actor) return null;
    const rows = await ctx.data.db
      .select({ post: schema.posts })
      .from(schema.pins)
      .innerJoin(schema.posts, eq(schema.posts.id, schema.pins.postId))
      .where(and(eq(schema.pins.actorId, actor.id), eq(schema.posts.visibility, 'public')))
      .orderBy(desc(schema.pins.createdAt));
    return { items: await Promise.all(rows.map((r) => postToNote(ctx, r.post, actor))) };
  });

  federation.setObjectDispatcher(Note, '/users/{identifier}/statuses/{id}', async (ctx, values) => {
    if (isBridgeUsername(values.identifier))
      return bridgedNoteById(ctx, values.identifier, values.id);
    const actor = await localActorByIdentifier(ctx.data, values.identifier);
    if (!actor) return null;
    const [post] = await ctx.data.db
      .select()
      .from(schema.posts)
      .where(and(eq(schema.posts.id, values.id), eq(schema.posts.actorId, actor.id)));
    // Only public and unlisted posts are served unauthenticated.
    if (
      !post ||
      post.reblogOfId ||
      (post.visibility !== 'public' && post.visibility !== 'unlisted')
    )
      return null;
    return postToNote(ctx, post, actor);
  });

  federation.setNodeInfoDispatcher('/nodeinfo/2.1', async (ctx) => {
    const settings = await getInstanceSettings(ctx.data);
    const [[users], [localPosts]] = await Promise.all([
      ctx.data.db.select({ n: count() }).from(schema.users),
      ctx.data.db
        .select({ n: count() })
        .from(schema.posts)
        .where(
          and(
            eq(schema.posts.local, true),
            isNull(schema.posts.inReplyToId),
            isNull(schema.posts.reblogOfId),
          ),
        ),
    ]);
    return {
      software: {
        name: 'disbigle',
        version: SOFTWARE_VERSION,
        repository: new URL('https://github.com/faghy/disbigle'),
      },
      protocols: ['activitypub', 'diaspora'],
      usage: {
        users: { total: users?.n ?? 0 },
        localPosts: localPosts?.n ?? 0,
        localComments: 0,
      },
      openRegistrations: settings.registrationMode === 'open',
      metadata: {
        nodeName: settings.title,
        nodeDescription: settings.description,
      },
    };
  });

  // diaspora* discovers people through the same WebFinger document.
  federation.setWebFingerLinksDispatcher(async (ctx, resource) => {
    const username = resource.protocol === 'acct:' ? resource.pathname.split('@')[0] : null;
    if (!username) return [];
    const base = ctx.data.config.PUBLIC_URL;
    if (isBridgeUsername(username)) {
      const bridged = await bridgedAccountByUsername(ctx.data, username);
      if (!bridged) return [];
      const guid = bridged.bridge.diasporaGuid;
      return [
        {
          rel: 'http://microformats.org/profile/hcard',
          type: 'text/html',
          href: `${base}/hcard/users/${guid}`,
        },
        { rel: 'http://joindiaspora.com/seed_location', type: 'text/html', href: `${base}/` },
        { rel: 'salmon', href: `${base}/receive/users/${guid}` },
      ];
    }
    const actor = await localActorByIdentifier(ctx.data, username);
    if (!actor?.diasporaGuid) return [];
    return [
      {
        rel: 'http://microformats.org/profile/hcard',
        type: 'text/html',
        href: `${base}/hcard/users/${actor.diasporaGuid}`,
      },
      { rel: 'http://joindiaspora.com/seed_location', type: 'text/html', href: `${base}/` },
      { rel: 'salmon', href: `${base}/receive/users/${actor.diasporaGuid}` },
    ];
  });

  federation
    .setInboxListeners('/users/{identifier}/inbox', '/inbox')
    // Fetches made while handling the shared inbox are signed as the instance (authorized fetch).
    .setSharedKeyDispatcher(() => ({ identifier: INSTANCE_ACTOR }))
    // A deleted actor's key can no longer be fetched (410 Gone), so its own Delete arrives unverified.
    // The 410 itself proves the deletion: drop the account if we know it.
    .onUnverifiedActivity(async (ctx, activity, reason) => {
      if (
        activity instanceof Delete &&
        activity.actorId &&
        activity.objectId?.href === activity.actorId.href &&
        reason.type === 'keyFetchError' &&
        'status' in reason.result &&
        reason.result.status === 410
      ) {
        const known = await findActorByApUri(ctx.data, activity.actorId.href);
        if (known) await deleteRemoteActor(ctx.data, known.id);
        return new Response(null, { status: 202 });
      }
      return undefined;
    })
    .on(Follow, async (ctx, activity) => {
      if (!activity.id || !activity.objectId) return;
      const parsed = ctx.parseUri(activity.objectId);
      if (parsed?.type !== 'actor') return;
      const target = await localActorByIdentifier(ctx.data, parsed.identifier);
      const follower = await storeActor(ctx, await activity.getActor(ctx));
      if (!target || !follower) return;
      try {
        await follow(ctx.data, follower.id, target.id, { apUri: activity.id.href });
      } catch {
        // Blocked: answer with a Reject.
        const remote = await activity.getActor(ctx);
        if (!remote) return;
        await ctx.sendActivity(
          { identifier: target.username },
          remote,
          new Reject({
            id: new URL(`${ctx.getActorUri(target.username).href}#rejects/${crypto.randomUUID()}`),
            actor: ctx.getActorUri(target.username),
            object: activity,
          }),
        );
      }
    })
    // The Follow inside Accept/Reject has an id on *our* origin, so it is matched by id rather than
    // dereferenced (dereferencing would fetch our own actor document instead).
    .on(Accept, async (ctx, activity) => {
      const followUri = activity.objectId?.href;
      if (!followUri) return;
      const sender = await storeActor(ctx, await activity.getActor(ctx));
      if (!sender) return;
      const [request] = await ctx.data.db
        .select()
        .from(schema.followRequests)
        .where(
          and(
            eq(schema.followRequests.apUri, followUri),
            eq(schema.followRequests.targetActorId, sender.id),
          ),
        );
      if (request) await acceptFollowRequest(ctx.data, sender.id, request.actorId);
    })
    .on(Reject, async (ctx, activity) => {
      const followUri = activity.objectId?.href;
      if (!followUri) return;
      const sender = await storeActor(ctx, await activity.getActor(ctx));
      if (!sender) return;
      const { followRequests, follows } = schema;
      const [request] = await ctx.data.db
        .select({ actorId: followRequests.actorId })
        .from(followRequests)
        .where(
          and(eq(followRequests.apUri, followUri), eq(followRequests.targetActorId, sender.id)),
        );
      const [existing] = await ctx.data.db
        .select({ actorId: follows.actorId })
        .from(follows)
        .where(and(eq(follows.apUri, followUri), eq(follows.targetActorId, sender.id)));
      const localId = request?.actorId ?? existing?.actorId;
      if (localId) await unfollow(ctx.data, localId, sender.id);
    })
    .on(Undo, async (ctx, activity) => {
      const sender = await storeActor(ctx, await activity.getActor(ctx));
      if (!sender) return;
      const object = await activity.getObject(ctx);
      if (object instanceof Follow && object.objectId) {
        const parsed = ctx.parseUri(object.objectId);
        if (parsed?.type !== 'actor') return;
        const target = await localActorByIdentifier(ctx.data, parsed.identifier);
        if (target) await rejectFollowRequest(ctx.data, target.id, sender.id);
      } else if ((object instanceof Like || object instanceof Announce) && object.id) {
        await undoRemoteActivity(ctx.data, sender.id, object.id.href);
      } else if (activity.objectId) {
        await undoRemoteActivity(ctx.data, sender.id, activity.objectId.href);
      }
    })
    .on(Create, async (ctx, activity) => {
      const object = await activity.getObject(ctx);
      if (!(object instanceof Note) && !(object instanceof Question)) return;
      const author = await storeActor(ctx, await activity.getActor(ctx));
      if (!author || object.attributionId?.href !== author.apUri) return;
      // A poll vote: a Note with a name (the option) and no content, answering one of our polls.
      if (
        object instanceof Note &&
        object.name &&
        !object.content &&
        object.replyTargetId &&
        object.id
      ) {
        const target = await findPostByUri(ctx.data, object.replyTargetId.href);
        if (target?.local) {
          const [poll] = await ctx.data.db
            .select()
            .from(schema.polls)
            .where(eq(schema.polls.postId, target.id));
          const choice = poll?.options.findIndex((o) => o.title === object.name?.toString()) ?? -1;
          if (poll && choice >= 0) {
            await votePoll(ctx.data, author.id, poll.id, [choice], {
              apUris: [object.id.href],
            }).catch(() => undefined);
          }
          return;
        }
      }
      await fetchMissingAncestors(ctx, object.replyTargetId);
      const data = await noteToPostData(ctx, object, author);
      const id = data ? await ingestRemotePost(ctx.data, data) : null;
      if (id) await forwardToThreadFollowers(ctx, id);
    })
    .on(Update, async (ctx, activity) => {
      const object = await activity.getObject(ctx);
      const sender = await storeActor(ctx, await activity.getActor(ctx));
      if (!sender) return;
      if (object instanceof Note && object.id && object.attributionId?.href === sender.apUri) {
        await updateRemotePost(ctx.data, sender.id, object.id.href, {
          contentHtml: object.content?.toString() ?? '',
          summary: object.summary?.toString() ?? '',
          sensitive: object.sensitive ?? false,
        });
      }
      if (object instanceof Question && object.id && object.attributionId?.href === sender.apUri) {
        const post = await findPostByUri(ctx.data, object.id.href);
        if (post && !post.local) {
          const poll = await questionPoll(ctx, object);
          await updateRemotePollCounts(ctx.data, post.id, poll);
        }
      }
      // An Update of the actor itself is handled by storeActor above, which refreshes the profile.
    })
    .on(Delete, async (ctx, activity) => {
      const senderUri = activity.actorId;
      const objectUri = activity.objectId;
      if (!senderUri || !objectUri) return;
      const sender = await findActorByApUri(ctx.data, senderUri.href);
      if (!sender) return;
      if (objectUri.href === senderUri.href) {
        await deleteRemoteActor(ctx.data, sender.id);
        return;
      }
      await deleteRemotePost(ctx.data, sender.id, { apUri: objectUri.href });
    })
    .on(Like, async (ctx, activity) => {
      if (!activity.id || !activity.objectId) return;
      const post = await findPostByUri(ctx.data, activity.objectId.href);
      if (!post?.local) return;
      const sender = await storeActor(ctx, await activity.getActor(ctx));
      if (!sender) return;
      await like(ctx.data, sender.id, post.id, { apUri: activity.id.href }).catch(() => undefined);
    })
    .on(Announce, async (ctx, activity) => {
      if (!activity.id || !activity.objectId) return;
      const sender = await storeActor(ctx, await activity.getActor(ctx));
      if (!sender) return;
      let post = await findPostByUri(ctx.data, activity.objectId.href);
      if (!post) {
        // Reshare of a post we don't have yet: fetch and store it first.
        const object = await activity.getObject(ctx);
        if (!(object instanceof Note) || !object.attributionId) return;
        const author = await ctx.lookupObject(object.attributionId);
        if (!isActor(author)) return;
        const authorRow = await storeActor(ctx, author);
        if (!authorRow || object.attributionId.href !== authorRow.apUri) return;
        const data = await noteToPostData(ctx, object, authorRow);
        const id = data ? await ingestRemotePost(ctx.data, data) : null;
        post = id
          ? ((await ctx.data.db.select().from(schema.posts).where(eq(schema.posts.id, id)))[0] ??
            null)
          : null;
      }
      if (post)
        await ingestRemoteAnnounce(ctx.data, sender.id, post.id, { apUri: activity.id.href });
    })
    .on(Move, async (ctx, activity) => {
      // Only an account can announce its own move.
      if (
        !activity.actorId ||
        activity.objectId?.href !== activity.actorId.href ||
        !activity.targetId
      )
        return;
      const origin = await storeActor(ctx, await activity.getActor(ctx));
      if (!origin) return;
      // The target may be one of our accounts; otherwise fetch it fresh (its alsoKnownAs must list the origin).
      const parsed = ctx.parseUri(activity.targetId);
      let targetRow =
        parsed?.type === 'actor' ? await localActorByIdentifier(ctx.data, parsed.identifier) : null;
      if (!targetRow) {
        const target = await ctx.lookupObject(activity.targetId).catch(() => null);
        if (!isActor(target)) return;
        targetRow = await storeActor(ctx, target);
      }
      if (targetRow) await applyRemoteMove(ctx.data, origin.id, targetRow.id);
    })
    .on(Block, async (ctx, activity) => {
      if (!activity.objectId) return;
      const parsed = ctx.parseUri(activity.objectId);
      if (parsed?.type !== 'actor') return;
      const target = await localActorByIdentifier(ctx.data, parsed.identifier);
      const sender = await storeActor(ctx, await activity.getActor(ctx));
      if (target && sender) await block(ctx.data, sender.id, target.id).catch(() => undefined);
    });

  return federation;
}

export { Tombstone };
