import {
  acceptFollowRequest,
  block,
  type CoreContext,
  deleteRemoteActor,
  deleteRemotePost,
  domainBlockSeverity,
  findActorByApUri,
  findLocalActorByUsername,
  findPostByUri,
  follow,
  ingestRemoteAnnounce,
  ingestRemotePost,
  like,
  rejectFollowRequest,
  undoRemoteActivity,
  unfollow,
  updateRemotePost,
  upsertRemoteActor,
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
  Block,
  Create,
  Delete,
  Follow,
  isActor,
  Like,
  Note,
  Reject,
  Tombstone,
  Undo,
  Update,
} from '@fedify/vocab';
import { and, count, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { localActorToPerson, noteToPostData, postToNote, remoteActorData } from './convert.ts';
import { getLocalKeyPairs } from './keys.ts';

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

async function localActorByIdentifier(ctx: CoreContext, identifier: string) {
  const actor = await findLocalActorByUsername(ctx, identifier);
  return actor && !actor.suspendedAt ? actor : null;
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
      const actor = await localActorByIdentifier(ctx.data, identifier);
      if (!actor) return null;
      return localActorToPerson(ctx, actor, await ctx.getActorKeyPairs(identifier));
    })
    .mapHandle(
      async (ctx, username) => (await localActorByIdentifier(ctx.data, username))?.username ?? null,
    )
    .setKeyPairsDispatcher(async (ctx, identifier) => {
      const actor = await localActorByIdentifier(ctx.data, identifier);
      return actor ? getLocalKeyPairs(ctx.data, actor.id) : [];
    });

  federation
    .setFollowersDispatcher('/users/{identifier}/followers', async (ctx, identifier, cursor) => {
      const actor = await localActorByIdentifier(ctx.data, identifier);
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
    .setFollowingDispatcher('/users/{identifier}/following', async (ctx, identifier) => {
      const actor = await localActorByIdentifier(ctx.data, identifier);
      if (!actor) return null;
      const rows = await ctx.data.db
        .select({ uri: schema.actors.apUri })
        .from(schema.follows)
        .innerJoin(schema.actors, eq(schema.actors.id, schema.follows.targetActorId))
        .where(eq(schema.follows.actorId, actor.id));
      return { items: rows.filter((r) => r.uri).map((r) => new URL(r.uri ?? '')) };
    })
    .setCounter(async (ctx, identifier) => {
      const actor = await localActorByIdentifier(ctx.data, identifier);
      if (!actor) return null;
      const [row] = await ctx.data.db
        .select({ n: count() })
        .from(schema.follows)
        .where(eq(schema.follows.actorId, actor.id));
      return row?.n ?? 0;
    });

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

  federation.setObjectDispatcher(Note, '/users/{identifier}/statuses/{id}', async (ctx, values) => {
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
      openRegistrations: ctx.data.config.REGISTRATION_MODE === 'open',
      metadata: {
        nodeName: ctx.data.config.INSTANCE_TITLE,
        nodeDescription: ctx.data.config.INSTANCE_DESCRIPTION,
      },
    };
  });

  // diaspora* discovers people through the same WebFinger document.
  federation.setWebFingerLinksDispatcher(async (ctx, resource) => {
    const username = resource.protocol === 'acct:' ? resource.pathname.split('@')[0] : null;
    if (!username) return [];
    const actor = await localActorByIdentifier(ctx.data, username);
    if (!actor?.diasporaGuid) return [];
    const base = ctx.data.config.PUBLIC_URL;
    return [
      {
        rel: 'http://microformats.org/profile/hcard',
        type: 'text/html',
        href: `${base}/hcard/users/${actor.diasporaGuid}`,
      },
      { rel: 'http://joindiaspora.com/seed_location', type: 'text/html', href: `${base}/` },
    ];
  });

  federation
    .setInboxListeners('/users/{identifier}/inbox', '/inbox')
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
      if (!(object instanceof Note)) return;
      const author = await storeActor(ctx, await activity.getActor(ctx));
      if (!author || object.attributionId?.href !== author.apUri) return;
      const data = await noteToPostData(ctx, object, author);
      if (data) await ingestRemotePost(ctx.data, data);
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
