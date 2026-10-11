// Replies written on diaspora* by people without ActivityPub, shown to the ActivityPub side of a
// local thread through their bridge identity (see `bridge_identities`).
import { bridgedAccountByUsername, type CoreContext, inAudienceOf } from '@disbigle/core';
import { schema } from '@disbigle/db';
import type { Context } from '@fedify/fedify';
import { Note, PUBLIC_COLLECTION } from '@fedify/vocab';
import { eq } from 'drizzle-orm';
import { bridgedNote } from './convert.ts';

type ActorRow = typeof schema.actors.$inferSelect;
type PostRow = typeof schema.posts.$inferSelect;

const isPublic = (v: PostRow['visibility']) => v === 'public' || v === 'unlisted';

async function postById(core: CoreContext, id: string): Promise<PostRow | null> {
  const [row] = await core.db.select().from(schema.posts).where(eq(schema.posts.id, id));
  return row ?? null;
}

async function actorById(core: CoreContext, id: string): Promise<ActorRow | null> {
  const [row] = await core.db.select().from(schema.actors).where(eq(schema.actors.id, id));
  return row ?? null;
}

/** Remote accounts that ActivityPub servers can't reach directly. */
export const needsActivityPubBridge = (actor: ActorRow) =>
  actor.domain !== null && !actor.protocols.includes('activitypub');

/** A public thread started here, and a remote account ActivityPub can't reach acting in it. */
export interface BridgedThread {
  author: ActorRow;
  root: PostRow;
  rootAuthor: ActorRow;
}

export interface BridgedReply extends BridgedThread {
  post: PostRow;
  parent: PostRow | null;
}

/**
 * The thread `rootId` when `authorId` needs a bridge to ActivityPub and the thread is a public
 * one started here, so its local author relays what happens in it (as diaspora* does).
 */
export async function bridgedThreadOf(
  core: CoreContext,
  authorId: string,
  rootId: string,
): Promise<BridgedThread | null> {
  const [author, root] = await Promise.all([actorById(core, authorId), postById(core, rootId)]);
  if (!author || !needsActivityPubBridge(author)) return null;
  if (!root?.local || !root.apUri) return null;
  // On a private thread, only people it was shared with take part.
  if (!(await inAudienceOf(core, author.id, root))) return null;
  const rootAuthor = await actorById(core, root.actorId);
  if (!rootAuthor || rootAuthor.domain !== null) return null;
  return { author, root, rootAuthor };
}

export async function bridgedReplyOf(
  core: CoreContext,
  post: PostRow,
): Promise<BridgedReply | null> {
  if (post.local || !post.inReplyToId || !post.threadRootId) return null;
  const thread = await bridgedThreadOf(core, post.actorId, post.threadRootId);
  if (!thread) return null;
  // A private answer never goes to a public thread's audience.
  if (isPublic(thread.root.visibility) && !isPublic(post.visibility)) return null;
  return { ...thread, post, parent: await postById(core, post.inReplyToId) };
}

/**
 * Who sees a thread started here: for public threads its author's followers and its
 * participants; for followers-only threads the followers; otherwise the people it was shared with.
 */
export async function threadAudience(core: CoreContext, thread: BridgedThread) {
  const { visibility } = thread.root;
  const followers =
    visibility === 'limited' || visibility === 'direct'
      ? []
      : await core.db
          .select({ actor: schema.actors })
          .from(schema.follows)
          .innerJoin(schema.actors, eq(schema.actors.id, schema.follows.actorId))
          .where(eq(schema.follows.targetActorId, thread.rootAuthor.id));
  const others = isPublic(visibility)
    ? await core.db
        .selectDistinct({ actor: schema.actors })
        .from(schema.posts)
        .innerJoin(schema.actors, eq(schema.actors.id, schema.posts.actorId))
        .where(eq(schema.posts.threadRootId, thread.root.id))
    : visibility === 'followers'
      ? []
      : await core.db
          .select({ actor: schema.actors })
          .from(schema.postAudiences)
          .innerJoin(schema.actors, eq(schema.actors.id, schema.postAudiences.actorId))
          .where(eq(schema.postAudiences.postId, thread.root.id));
  const audience = new Map<string, ActorRow>();
  for (const { actor } of [...followers, ...others]) audience.set(actor.id, actor);
  return [...audience.values()];
}

/** `to`/`cc` for something bridged into a thread, matching the thread's own audience. */
export function threadAddressing(
  ctx: Context<CoreContext>,
  thread: BridgedThread,
  audience: ActorRow[],
): { to: URL[]; cc: URL[] } {
  const followers = ctx.getFollowersUri(thread.rootAuthor.username);
  const people = audience
    .map((a) => a.apUri)
    .filter((u): u is string => !!u)
    .map((u) => new URL(u));
  switch (thread.root.visibility) {
    case 'public':
      return { to: [PUBLIC_COLLECTION], cc: [followers] };
    case 'unlisted':
      return { to: [followers], cc: [PUBLIC_COLLECTION] };
    case 'followers':
      return { to: [followers], cc: [] };
    default:
      return { to: people, cc: [] };
  }
}

/** The bridged Note served at `/users/<bridge>/statuses/<id>`. */
export async function bridgedNoteById(
  ctx: Context<CoreContext>,
  identifier: string,
  id: string,
): Promise<Note | null> {
  const bridged = await bridgedAccountByUsername(ctx.data, identifier);
  const post = bridged ? await postById(ctx.data, id) : null;
  if (!bridged || !post || post.actorId !== bridged.actor.id) return null;
  if (post.apUri !== ctx.getObjectUri(Note, { identifier, id }).href) return null;
  const reply = await bridgedReplyOf(ctx.data, post);
  // Served to anyone who asks, so only from public threads.
  if (!reply || !isPublic(reply.root.visibility)) return null;
  return bridgedNote(
    ctx,
    post,
    bridged.bridge,
    reply.parent?.apUri ?? null,
    threadAddressing(ctx, reply, []),
  );
}
