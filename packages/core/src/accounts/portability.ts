import { schema } from '@disbigle/db';
import { and, asc, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import { type CoreContext, emit } from '../context.ts';
import { verifyPassword } from '../crypto/passwords.ts';
import { DomainError } from '../errors.ts';
import { mediaUrl } from '../social/statuses.ts';

const {
  users,
  actors,
  posts,
  follows,
  aspects,
  aspectMemberships,
  likes,
  bookmarks,
  blocks,
  mutes,
  sessions,
} = schema;
const { mediaAttachments, postAspects } = schema;

type ActorRow = typeof actors.$inferSelect;

const handleOf = (ctx: CoreContext, actor: ActorRow) =>
  `${actor.username}@${actor.domain ?? ctx.config.LOCAL_DOMAIN}`;

/**
 * Everything a user owns, as JSON, for the "download your data" button (GDPR art. 20).
 * Private keys and password hashes are never included.
 */
export async function exportAccount(ctx: CoreContext, userId: string) {
  const [row] = await ctx.db
    .select({ user: users, actor: actors })
    .from(users)
    .innerJoin(actors, eq(actors.id, users.actorId))
    .where(eq(users.id, userId));
  if (!row) throw new DomainError('not_found', 'User not found');
  const { user, actor } = row;
  const db = ctx.db;

  const actorsById = async (ids: string[]) =>
    ids.length > 0
      ? new Map(
          (await db.select().from(actors).where(inArray(actors.id, ids))).map((a) => [a.id, a]),
        )
      : new Map<string, ActorRow>();
  const handles = async (ids: string[]) => {
    const map = await actorsById(ids);
    return ids
      .map((id) => map.get(id))
      .filter((a): a is ActorRow => !!a)
      .map((a) => ({ handle: handleOf(ctx, a), uri: a.apUri }));
  };

  const [ownPosts, following, followers, ownAspects, liked, bookmarked, blocked, muted] =
    await Promise.all([
      db.select().from(posts).where(eq(posts.actorId, actor.id)).orderBy(asc(posts.id)),
      db.select({ id: follows.targetActorId }).from(follows).where(eq(follows.actorId, actor.id)),
      db.select({ id: follows.actorId }).from(follows).where(eq(follows.targetActorId, actor.id)),
      db
        .select()
        .from(aspects)
        .where(eq(aspects.ownerActorId, actor.id))
        .orderBy(asc(aspects.position)),
      db
        .select({ uri: posts.apUri, guid: posts.diasporaGuid })
        .from(likes)
        .innerJoin(posts, eq(posts.id, likes.postId))
        .where(eq(likes.actorId, actor.id)),
      db
        .select({ uri: posts.apUri })
        .from(bookmarks)
        .innerJoin(posts, eq(posts.id, bookmarks.postId))
        .where(eq(bookmarks.actorId, actor.id)),
      db.select({ id: blocks.targetActorId }).from(blocks).where(eq(blocks.actorId, actor.id)),
      db.select({ id: mutes.targetActorId }).from(mutes).where(eq(mutes.actorId, actor.id)),
    ]);

  const postIds = ownPosts.map((p) => p.id);
  const [media, sharedWith, parents, originals] = await Promise.all([
    postIds.length > 0
      ? db.select().from(mediaAttachments).where(inArray(mediaAttachments.postId, postIds))
      : [],
    postIds.length > 0
      ? db
          .select({ postId: postAspects.postId, name: aspects.name })
          .from(postAspects)
          .innerJoin(aspects, eq(aspects.id, postAspects.aspectId))
          .where(inArray(postAspects.postId, postIds))
      : [],
    (async () => {
      const ids = ownPosts.map((p) => p.inReplyToId).filter((id): id is string => !!id);
      return ids.length > 0
        ? db.select({ id: posts.id, uri: posts.apUri }).from(posts).where(inArray(posts.id, ids))
        : [];
    })(),
    (async () => {
      const ids = ownPosts.map((p) => p.reblogOfId).filter((id): id is string => !!id);
      return ids.length > 0
        ? db.select({ id: posts.id, uri: posts.apUri }).from(posts).where(inArray(posts.id, ids))
        : [];
    })(),
  ]);
  const uriOf = new Map([...parents, ...originals].map((p) => [p.id, p.uri]));

  const aspectList = await Promise.all(
    ownAspects.map(async (aspect) => {
      const members = await db
        .select({ id: aspectMemberships.actorId })
        .from(aspectMemberships)
        .where(eq(aspectMemberships.aspectId, aspect.id));
      return { name: aspect.name, members: await handles(members.map((m) => m.id)) };
    }),
  );

  return {
    format: 'disbigle-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    account: {
      handle: handleOf(ctx, actor),
      uri: actor.apUri,
      diasporaGuid: actor.diasporaGuid,
      email: user.email,
      displayName: actor.displayName,
      bio: actor.summary,
      fields: actor.fields,
      avatarUrl: actor.avatarUrl,
      headerUrl: actor.headerUrl,
      locked: actor.locked,
      discoverable: actor.discoverable,
      bot: actor.bot,
      locale: user.locale,
      createdAt: actor.createdAt.toISOString(),
      publicKeyPem: actor.publicKeyPem,
    },
    posts: ownPosts.map((p) => ({
      id: p.id,
      uri: p.apUri,
      url: p.apUrl,
      diasporaGuid: p.diasporaGuid,
      createdAt: p.createdAt.toISOString(),
      visibility: p.visibility,
      sharedWithAspects: sharedWith.filter((s) => s.postId === p.id).map((s) => s.name),
      contentWarning: p.summary,
      markdown: p.source,
      html: p.contentHtml,
      inReplyTo: p.inReplyToId ? (uriOf.get(p.inReplyToId) ?? p.inReplyToUri) : p.inReplyToUri,
      reshareOf: p.reblogOfId ? (uriOf.get(p.reblogOfId) ?? null) : null,
      media: media
        .filter((m) => m.postId === p.id)
        .map((m) => ({
          url: m.filePath ? mediaUrl(ctx, m.filePath) : m.remoteUrl,
          type: m.mimeType,
          description: m.description,
        })),
    })),
    following: await handles(following.map((f) => f.id)),
    followers: await handles(followers.map((f) => f.id)),
    aspects: aspectList,
    likes: liked,
    bookmarks: bookmarked.map((b) => b.uri),
    blocks: await handles(blocked.map((b) => b.id)),
    mutes: await handles(muted.map((m) => m.id)),
  };
}

/** How long a deleted account's identity is kept so the deletion can federate. */
export const DELETION_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes the user's account. It is closed immediately (hidden, signed out) and other servers are
 * told; the data itself is purged later by the worker, once delivery had time to happen.
 */
export async function requestAccountDeletion(
  ctx: CoreContext,
  userId: string,
  password: string,
): Promise<void> {
  const [user] = await ctx.db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new DomainError('not_found', 'User not found');
  if (!(await verifyPassword(user.passwordHash, password)))
    throw new DomainError('wrong_password', 'Wrong password');
  if (user.role === 'admin') {
    const admins = await ctx.db.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
    if (admins.length <= 1)
      throw new DomainError('forbidden', 'The last administrator cannot delete their account');
  }
  const now = new Date();
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ deletionRequestedAt: now, disabledAt: now })
      .where(eq(users.id, userId));
    await tx.update(actors).set({ suspendedAt: now }).where(eq(actors.id, user.actorId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
  });
  await emit(ctx, { type: 'account.deleted', actorId: user.actorId });
}

/** Purges accounts whose deletion was requested before `olderThan`. Returns how many. */
export async function purgeDeletedAccounts(ctx: CoreContext, olderThan: Date): Promise<number> {
  const due = await ctx.db
    .select({ actorId: users.actorId })
    .from(users)
    .where(and(isNotNull(users.deletionRequestedAt), lt(users.deletionRequestedAt, olderThan)));
  if (due.length === 0) return 0;
  await ctx.db.delete(actors).where(
    inArray(
      actors.id,
      due.map((d) => d.actorId),
    ),
  );
  return due.length;
}
