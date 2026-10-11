// Replies written on diaspora* by people without ActivityPub, shown to the ActivityPub side of a
// local thread through their bridge identity (see `bridge_identities`).
import { bridgedAccountByUsername, type CoreContext } from '@disbigle/core';
import { schema } from '@disbigle/db';
import type { Context } from '@fedify/fedify';
import { Note } from '@fedify/vocab';
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
  if (!root?.local || !root.apUri || !isPublic(root.visibility)) return null;
  const rootAuthor = await actorById(core, root.actorId);
  if (!rootAuthor || rootAuthor.domain !== null) return null;
  return { author, root, rootAuthor };
}

export async function bridgedReplyOf(
  core: CoreContext,
  post: PostRow,
): Promise<BridgedReply | null> {
  if (post.local || !post.inReplyToId || !post.threadRootId || !isPublic(post.visibility))
    return null;
  const thread = await bridgedThreadOf(core, post.actorId, post.threadRootId);
  if (!thread) return null;
  return { ...thread, post, parent: await postById(core, post.inReplyToId) };
}

/** Who on ActivityPub follows a thread started here: its author's followers and its participants. */
export async function threadAudience(core: CoreContext, thread: BridgedThread) {
  const followers = await core.db
    .select({ actor: schema.actors })
    .from(schema.follows)
    .innerJoin(schema.actors, eq(schema.actors.id, schema.follows.actorId))
    .where(eq(schema.follows.targetActorId, thread.rootAuthor.id));
  const participants = await core.db
    .selectDistinct({ actor: schema.actors })
    .from(schema.posts)
    .innerJoin(schema.actors, eq(schema.actors.id, schema.posts.actorId))
    .where(eq(schema.posts.threadRootId, thread.root.id));
  const audience = new Map<string, ActorRow>();
  for (const { actor } of [...followers, ...participants]) audience.set(actor.id, actor);
  return [...audience.values()];
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
  if (!reply) return null;
  return bridgedNote(ctx, post, bridged.bridge, reply.parent?.apUri ?? null, [
    ctx.getFollowersUri(reply.rootAuthor.username),
  ]);
}
