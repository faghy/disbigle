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

export interface BridgedReply {
  post: PostRow;
  author: ActorRow;
  parent: PostRow | null;
  root: PostRow;
  rootAuthor: ActorRow;
}

/**
 * The thread of a remote reply, when its author needs a bridge to ActivityPub and the thread is
 * a public one started here (so the local author relays it, as diaspora* does).
 */
export async function bridgedReplyOf(
  core: CoreContext,
  post: PostRow,
): Promise<BridgedReply | null> {
  if (post.local || !post.inReplyToId || !post.threadRootId || !isPublic(post.visibility))
    return null;
  const [author, root, parent] = await Promise.all([
    actorById(core, post.actorId),
    postById(core, post.threadRootId),
    postById(core, post.inReplyToId),
  ]);
  if (!author || !needsActivityPubBridge(author)) return null;
  if (!root?.local || !root.apUri || !isPublic(root.visibility)) return null;
  const rootAuthor = await actorById(core, root.actorId);
  if (!rootAuthor || rootAuthor.domain !== null) return null;
  return { post, author, parent, root, rootAuthor };
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
