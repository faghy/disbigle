import { type CoreContext, ingestRemotePost } from '@disbigle/core';
import type { schema } from '@disbigle/db';
import type { Federation } from '@fedify/fedify';
import { Create, Note, OrderedCollection, OrderedCollectionPage } from '@fedify/vocab';
import { noteToPostData } from './convert.ts';
import { INSTANCE_ACTOR } from './keys.ts';

type ActorRow = typeof schema.actors.$inferSelect;

const BACKFILL_TTL_SECONDS = 24 * 60 * 60;

/**
 * Imports the most recent public posts of a remote account from its outbox, at most once a day,
 * so a profile opened for the first time is not empty. Returns how many posts were stored.
 */
export async function backfillRemoteOutbox(
  federation: Federation<CoreContext>,
  core: CoreContext,
  actor: ActorRow,
  limit = 20,
): Promise<number> {
  if (actor.domain === null || !actor.apOutbox || actor.suspendedAt) return 0;
  const key = `ap-backfill:${actor.id}`;
  if (await core.kv.get(key)) return 0;
  await core.kv.set(key, '1', BACKFILL_TTL_SECONDS);

  const ctx = federation.createContext(new URL(core.config.PUBLIC_URL), core);
  const documentLoader = await ctx.getDocumentLoader({ identifier: INSTANCE_ACTOR });
  const outbox = await ctx.lookupObject(actor.apOutbox, { documentLoader }).catch(() => null);
  let page: OrderedCollection | OrderedCollectionPage | null = null;
  if (outbox instanceof OrderedCollectionPage) page = outbox;
  else if (outbox instanceof OrderedCollection) {
    page = (await outbox
      .getFirst({ documentLoader })
      .catch(() => null)) as OrderedCollectionPage | null;
    if (!page) page = outbox;
  }
  if (!page) return 0;

  let stored = 0;
  let seen = 0;
  for await (const item of page.getItems({ documentLoader })) {
    if (++seen > limit) break;
    if (!(item instanceof Create)) continue;
    const note = await item.getObject({ documentLoader }).catch(() => null);
    if (!(note instanceof Note) || note.attributionId?.href !== actor.apUri) continue;
    const data = await noteToPostData(ctx, note, actor);
    // Only public posts: the outbox is fetched as the instance, never on behalf of a user.
    if (!data || (data.visibility !== 'public' && data.visibility !== 'unlisted')) continue;
    if (await ingestRemotePost(core, data)) stored += 1;
  }
  return stored;
}
