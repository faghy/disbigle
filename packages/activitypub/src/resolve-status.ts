import {
  type CoreContext,
  findPostByUri,
  ingestRemotePost,
  upsertRemoteActor,
} from '@disbigle/core';
import type { Federation } from '@fedify/fedify';
import { isActor, Note, Question } from '@fedify/vocab';
import { noteToPostData, remoteActorData } from './convert.ts';
import { INSTANCE_ACTOR } from './keys.ts';

/**
 * Fetches a remote post by its URL (as shared in a browser or by another server), stores it if it
 * is public, and returns its local id. Returns null when it cannot be resolved.
 */
export async function resolveRemoteStatus(
  federation: Federation<CoreContext>,
  core: CoreContext,
  url: string,
): Promise<string | null> {
  if (!/^https?:\/\//.test(url)) return null;
  const known = await findPostByUri(core, url);
  if (known) return known.id;
  const ctx = federation.createContext(new URL(core.config.PUBLIC_URL), core);
  const documentLoader = await ctx.getDocumentLoader({ identifier: INSTANCE_ACTOR });
  const object = await ctx.lookupObject(url, { documentLoader }).catch(() => null);
  if (!(object instanceof Note) && !(object instanceof Question)) return null;
  if (!object.id || !object.attributionId) return null;
  const again = await findPostByUri(core, object.id.href);
  if (again) return again.id;
  const author = await ctx.lookupObject(object.attributionId, { documentLoader }).catch(() => null);
  if (!isActor(author)) return null;
  const data = await remoteActorData(ctx, author);
  if (!data || data.apUri !== object.attributionId.href) return null;
  const actor = await upsertRemoteActor(core, data);
  const post = await noteToPostData(ctx, object, actor);
  // Only public posts: the fetch is made as the instance, not as a user.
  if (!post || (post.visibility !== 'public' && post.visibility !== 'unlisted')) return null;
  return ingestRemotePost(core, post);
}
