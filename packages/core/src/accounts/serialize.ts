import type { schema } from '@disbigle/db';
import type { Account } from '@disbigle/shared';

type ActorRow = typeof schema.actors.$inferSelect;

export function serializeAccount(actor: ActorRow): Account {
  return {
    id: actor.id,
    username: actor.username,
    acct: actor.domain ? `${actor.username}@${actor.domain}` : actor.username,
    displayName: actor.displayName,
    note: actor.summary,
    avatarUrl: actor.avatarUrl,
    headerUrl: actor.headerUrl,
    fields: actor.fields,
    locked: actor.locked,
    bot: actor.bot,
    discoverable: actor.discoverable,
    local: actor.domain === null,
    url: actor.apUrl,
    createdAt: actor.createdAt.toISOString(),
  };
}
