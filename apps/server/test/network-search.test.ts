import { type ActorRow, upsertRemoteActor } from '@disbigle/core';
import { schema, uuidv7 } from '@disbigle/db';
import { describe, expect, it } from 'vitest';
import { searchNetwork } from '../src/network-search.ts';
import { useTestApp } from './helpers.ts';

const app = useTestApp();

const remote = (username: string, domain: string) =>
  upsertRemoteActor(app.ctx(), {
    username,
    domain,
    publicKeyPem: 'k',
    apUri: `https://${domain}/users/${username}`,
    apInbox: `https://${domain}/inbox`,
    protocol: 'activitypub',
  });

describe('network search', () => {
  it('tries a bare nickname on the servers already known', async () => {
    // Known servers: three accounts on busy.example, one on quiet.example and one on blocked.example.
    for (const name of ['a', 'b', 'carla']) await remote(name, 'busy.example');
    await remote('zed', 'quiet.example');
    await remote('eve', 'blocked.example');
    await app
      .ctx()
      .db.insert(schema.domainBlocks)
      .values({
        id: uuidv7(),
        domain: 'blocked.example',
        severity: 'suspend',
      } as never);

    const asked: string[] = [];
    let dora: ActorRow | null = null;
    const resolve = async (handle: string) => {
      asked.push(handle);
      if (handle === 'carla@quiet.example') {
        dora = await remote('carla', 'quiet.example');
        return dora;
      }
      return null;
    };

    const first = await searchNetwork(app.ctx(), 'Carla', resolve);
    // carla@busy.example was already known; quiet.example was asked; the blocked server never was.
    expect(first.accounts.map((a) => `${a.username}@${a.domain}`).sort()).toEqual([
      'carla@busy.example',
      'carla@quiet.example',
    ]);
    expect(asked).toEqual(['carla@quiet.example']);
    expect(first.servers).toBe(2);

    // A nickname nobody has: each server is asked once, then the miss is remembered.
    asked.length = 0;
    await searchNetwork(app.ctx(), 'nobody', resolve);
    const firstRound = [...asked].sort();
    expect(firstRound).toEqual(['nobody@busy.example', 'nobody@quiet.example']);
    asked.length = 0;
    await searchNetwork(app.ctx(), 'nobody', resolve);
    expect(asked).toEqual([]);
  });

  it('refuses things that are not a nickname', async () => {
    const result = await searchNetwork(app.ctx(), 'a b/c', async () => {
      throw new Error('should not be called');
    });
    expect(result).toEqual({ accounts: [], servers: 0 });
  });
});
