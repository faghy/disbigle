import { isLocalDomain } from '@disbigle/config';
import { type CoreContext, findActorByHandle, upsertRemoteActor } from '@disbigle/core';
import type { Federation } from '@fedify/fedify';
import { isActor } from '@fedify/vocab';
import { remoteActorData } from './convert.ts';
import { INSTANCE_ACTOR } from './keys.ts';

/** Parses `user@domain`, `@user@domain` or `acct:user@domain`. */
export function parseHandle(input: string): { username: string; domain: string } | null {
  const match = /^(?:acct:)?@?([a-zA-Z0-9_.-]+)@([a-zA-Z0-9.-]+(?::\d+)?)$/.exec(input.trim());
  return match ? { username: match[1] ?? '', domain: (match[2] ?? '').toLowerCase() } : null;
}

/**
 * Finds a remote account by handle or actor URL, fetching it over ActivityPub when unknown
 * (or when `refresh` is set). Returns null when it cannot be resolved.
 */
export async function resolveRemoteAccount(
  federation: Federation<CoreContext>,
  core: CoreContext,
  query: string,
  options: { refresh?: boolean } = {},
) {
  const handle = parseHandle(query);
  if (handle && !options.refresh) {
    const known = await findActorByHandle(core, handle.username, handle.domain);
    if (known) return known;
  }
  const ctx = federation.createContext(new URL(core.config.PUBLIC_URL), core);
  const target = handle ? `acct:${handle.username}@${handle.domain}` : query.trim();
  if (!handle && !/^https?:\/\//.test(target)) return null;
  let object: unknown;
  try {
    // Signed as the instance actor, for servers that require authorized fetch.
    const documentLoader = await ctx.getDocumentLoader({ identifier: INSTANCE_ACTOR });
    object = await ctx.lookupObject(target, { documentLoader });
  } catch {
    return null;
  }
  if (!isActor(object)) return null;
  const data = await remoteActorData(ctx, object);
  if (!data || isLocalDomain(core.config, data.domain)) return null;
  return upsertRemoteActor(core, data);
}
