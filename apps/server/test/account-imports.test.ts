import { parseImportList, processAccountImports } from '@disbigle/core';
import { describe, expect, it } from 'vitest';
import { Client, newUser, useTestApp } from './helpers.ts';

const app = useTestApp();

async function signedIn() {
  const client = new Client(app);
  const response = await client.post('/api/v1/auth/register', newUser());
  if (response.statusCode !== 201) throw new Error(`register failed: ${response.body}`);
  return { client, account: response.json().user.account as { id: string; username: string } };
}

describe('lists brought from another server', () => {
  it('reads Mastodon exports, with or without header', () => {
    expect(
      parseImportList(
        'Account address,Show boosts,Notify on new posts,Languages\nanna@mastodon.example,true,false,\n@Bob@Pod.example\n\nnot an address\nanna@mastodon.example,true,false,',
      ),
    ).toEqual(['anna@mastodon.example', 'bob@pod.example']);
  });

  it('follows, blocks and mutes in the background, telling what failed', async () => {
    const alice = await signedIn();
    const bruno = await signedIn();
    const carla = await signedIn();
    const csv = `Account address,Show boosts\n${bruno.account.username}@disbigle.test,true\nnobody@nowhere.example,true\n`;
    const created = await alice.client.post('/api/v1/me/migration/imports', {
      kind: 'following',
      text: csv,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ kind: 'following', total: 2, done: 0 });
    await alice.client.post('/api/v1/me/migration/imports', {
      kind: 'mutes',
      text: `${carla.account.username}@disbigle.test`,
    });
    expect(
      (await alice.client.post('/api/v1/me/migration/imports', { kind: 'blocks', text: 'nothing' }))
        .statusCode,
    ).toBe(422);

    // Remote addresses are looked up through the federation; here nobody is found.
    const handled = await processAccountImports(app.ctx(), async () => null, 50);
    expect(handled).toBe(3);
    const list = (await alice.client.get('/api/v1/me/migration/imports')).json();
    expect(list).toMatchObject([
      { kind: 'mutes', total: 1, done: 1, failedCount: 0 },
      { kind: 'following', total: 2, done: 1, failedCount: 1, failed: ['nobody@nowhere.example'] },
    ]);
    expect(list.every((i: { finishedAt: string | null }) => i.finishedAt)).toBe(true);

    const relationships = (
      await alice.client.get(
        `/api/v1/accounts/relationships?id[]=${bruno.account.id}&id[]=${carla.account.id}`,
      )
    ).json();
    expect(relationships).toMatchObject([
      { id: bruno.account.id, following: true },
      { id: carla.account.id, muting: true },
    ]);
  });

  it('brings aspects, hashtags and contacts from a diaspora* export', async () => {
    const alice = await signedIn();
    const bruno = await signedIn();
    const sent = await alice.client.post('/api/v1/me/migration/diaspora', {
      displayName: 'Alice da diaspora',
      bio: 'Ciao a tutti',
      aspects: ['Ciclismo'],
      contacts: [
        { address: `${bruno.account.username}@disbigle.test`, aspects: ['Ciclismo'] },
        { address: 'not an address', aspects: [] },
      ],
      tags: ['fotografia'],
      blocks: [],
    });
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({
      aspects: 1,
      tags: 1,
      imports: [{ kind: 'following', total: 1 }],
    });
    await processAccountImports(app.ctx(), async () => null, 50);

    const me = (await alice.client.get('/api/v1/me')).json();
    expect(me.account.displayName).toBe('Alice da diaspora');
    const aspects = (await alice.client.get('/api/v1/aspects')).json();
    const cycling = aspects.find((a: { name: string }) => a.name === 'Ciclismo');
    expect(cycling).toBeDefined();
    const members = (await alice.client.get(`/api/v1/aspects/${cycling.id}/members`)).json();
    expect(members.map((m: { id: string }) => m.id)).toEqual([bruno.account.id]);
    const tags = (await alice.client.get('/api/v1/tags/followed')).json();
    expect(JSON.stringify(tags)).toContain('fotografia');
  });
});
