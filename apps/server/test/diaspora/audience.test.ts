import { schema } from '@disbigle/db';
import {
  createMagicEnvelope,
  encryptMagicEnvelope,
  serializeEntity,
  signRelayable,
} from '@disbigle/diaspora';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Instance, signUp, startInstance } from './helpers.ts';

let a: Instance;
let b: Instance;
beforeAll(async () => {
  [a, b] = await Promise.all([startInstance(), startInstance()]);
}, 90_000);
afterAll(async () => {
  await Promise.all([a?.close(), b?.close()]);
});

describe('diaspora: a reused guid never widens an audience', () => {
  it('a recipient re-sends a private StatusMessage with the guid of a limited post to a stranger', async () => {
    const alice = await signUp(a);
    const carol = await signUp(a); // local stranger, not in the aspect
    const bob = await signUp(b);
    const bobOnA = await a.bridge.resolvePerson(bob.diasporaId);
    if (!bobOnA) throw new Error('no bob');
    const aspects = (await alice.client.get('/api/v1/aspects')).json();
    await alice.client.put(`/api/v1/accounts/${bobOnA.id}/aspects`, { aspectIds: [aspects[0].id] });
    const post = (
      await alice.client.post('/api/v1/statuses', {
        content: 'only for bob',
        visibility: 'limited',
        aspectIds: [aspects[0].id],
      })
    ).json();
    expect((await carol.client.get(`/api/v1/statuses/${post.id}`)).statusCode).toBe(404);
    const [row] = await a.ctx.db.select().from(schema.posts).where(eq(schema.posts.id, post.id));
    const guid = row?.diasporaGuid ?? '';

    const [bobUser] = await b.ctx.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.actorId, bob.account.id));
    const [carolActor] = await a.ctx.db
      .select()
      .from(schema.actors)
      .where(eq(schema.actors.id, carol.account.id));
    const xml = serializeEntity({
      type: 'StatusMessage',
      author: bob.diasporaId,
      guid,
      createdAt: new Date(),
      public: false,
      text: 'whatever',
    } as never);
    const envelope = createMagicEnvelope(xml, bob.diasporaId, bobUser?.privateKeyPem ?? '');
    const body = encryptMagicEnvelope(envelope, carolActor?.publicKeyPem ?? '');
    const res = await fetch(`${a.url}/receive/users/${carolActor?.diasporaGuid}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 1500));
    expect((await carol.client.get(`/api/v1/statuses/${post.id}`)).statusCode).toBe(404);
    const [after] = await a.ctx.db.select().from(schema.posts).where(eq(schema.posts.id, post.id));
    expect(after?.visibility).toBe('limited');
  }, 60_000);

  it('refuses a comment on a limited post sent by someone outside it', async () => {
    const alice = await signUp(a);
    const bob = await signUp(b); // in the aspect
    const dave = await signUp(b); // knows the guid, not in the aspect
    const bobOnA = await a.bridge.resolvePerson(bob.diasporaId);
    const daveOnA = await a.bridge.resolvePerson(dave.diasporaId);
    if (!bobOnA || !daveOnA) throw new Error('discovery failed');
    const aspects = (await alice.client.get('/api/v1/aspects')).json();
    await alice.client.put(`/api/v1/accounts/${bobOnA.id}/aspects`, { aspectIds: [aspects[0].id] });
    const post = (
      await alice.client.post('/api/v1/statuses', {
        content: 'only for bob',
        visibility: 'limited',
        aspectIds: [aspects[0].id],
      })
    ).json();
    const [row] = await a.ctx.db.select().from(schema.posts).where(eq(schema.posts.id, post.id));
    const [daveUser] = await b.ctx.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.actorId, dave.account.id));
    const [aliceActor] = await a.ctx.db
      .select()
      .from(schema.actors)
      .where(eq(schema.actors.id, alice.account.id));
    const comment = signRelayable(
      {
        type: 'Comment',
        author: dave.diasporaId,
        guid: '0123456789abcdef0123456789abcdef',
        parentGuid: row?.diasporaGuid ?? '',
        text: 'I should not be here',
        createdAt: new Date(),
      },
      daveUser?.privateKeyPem ?? '',
    );
    const envelope = createMagicEnvelope(
      serializeEntity(comment),
      dave.diasporaId,
      daveUser?.privateKeyPem ?? '',
    );
    const res = await fetch(`${a.url}/receive/users/${aliceActor?.diasporaGuid}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: encryptMagicEnvelope(envelope, aliceActor?.publicKeyPem ?? ''),
    });
    expect(res.status).toBe(202);
    await a.bridge.idle();
    await new Promise((r) => setTimeout(r, 500));
    const context = (await alice.client.get(`/api/v1/statuses/${post.id}/context`)).json();
    expect(context.descendants).toEqual([]);
  }, 60_000);
});
