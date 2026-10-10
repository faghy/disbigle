import { beforeAll, describe, expect, it } from 'vitest';
import {
  type AccountMigration,
  applyDefaults,
  buildPrivateMessage,
  buildPublicMessage,
  type Comment,
  type Conversation,
  createMagicEnvelope,
  DecryptionError,
  InvalidSenderError,
  InvalidSignatureError,
  NotPublicError,
  ParentNotLocalError,
  PublicKeyNotFoundError,
  type ReceiveOptions,
  type RelatedEntity,
  RelatedEntityNotFoundError,
  receivePrivate,
  receivePublic,
  SignatureVerificationError,
  type StatusMessage,
  serializeEntity,
  signAccountMigration,
  signRelayable,
  ValidationError,
} from '../src/index.ts';
import {
  ALICE_PUBLIC_KEY,
  COMMENT_AUTHOR,
  COMMENT_PARENT_GUID,
  COMMENT_XML_ALICE,
} from './fixtures/gem.ts';
import { ALICE, BOB, CAROL, generateTestKeys, guid, type TestKeyPair } from './helpers.ts';

let alice: TestKeyPair;
let bob: TestKeyPair;
let carol: TestKeyPair;
beforeAll(() => {
  alice = generateTestKeys();
  bob = generateTestKeys();
  carol = generateTestKeys();
});

const POST_GUID = guid(100);

function options(related: Record<string, RelatedEntity> = {}): ReceiveOptions {
  const keys: Record<string, TestKeyPair> = { [ALICE]: alice, [BOB]: bob, [CAROL]: carol };
  return {
    fetchPublicKey: (id) => keys[id]?.publicKey ?? null,
    fetchRelatedEntity: (type, g) => related[`${type}:${g}`] ?? null,
  };
}

const post: StatusMessage = {
  type: 'StatusMessage',
  author: ALICE,
  guid: POST_GUID,
  createdAt: new Date('2016-07-11T22:38:19Z'),
  public: true,
  text: 'hello world',
};

describe('public delivery', () => {
  it('receives a status message', async () => {
    const body = buildPublicMessage(post, { diasporaId: ALICE, privateKey: alice.privateKey });
    const received = await receivePublic(body, options());
    expect(received.sender).toBe(ALICE);
    expect(received.entity).toEqual(applyDefaults(post));
    expect(received.payloadXml).toBe(serializeEntity(post));
  });

  it('rejects non-public posts on the public route', async () => {
    const body = buildPublicMessage(
      { ...post, public: false },
      { diasporaId: ALICE, privateKey: alice.privateKey },
    );
    await expect(receivePublic(body, options())).rejects.toThrow(NotPublicError);
  });

  it('accepts a private profile without private fields on the public route', async () => {
    const signer = { diasporaId: ALICE, privateKey: alice.privateKey };
    const profile = { type: 'Profile', author: ALICE, firstName: 'Alice' } as const;
    await expect(
      receivePublic(buildPublicMessage(profile, signer), options()),
    ).resolves.toBeDefined();
    await expect(
      receivePublic(buildPublicMessage({ ...profile, bio: 'secret' }, signer), options()),
    ).rejects.toThrow(NotPublicError);
  });

  it('rejects an entity whose author is not the sender', async () => {
    const body = buildPublicMessage(post, { diasporaId: BOB, privateKey: bob.privateKey });
    await expect(receivePublic(body, options())).rejects.toThrow(InvalidSenderError);
  });

  it('rejects an envelope signed with another key', async () => {
    const body = createMagicEnvelope(serializeEntity(post), ALICE, bob.privateKey);
    await expect(receivePublic(body, options())).rejects.toThrow(InvalidSignatureError);
  });
});

describe('relayables', () => {
  const comment: Comment = {
    type: 'Comment',
    author: BOB,
    guid: guid(1),
    parentGuid: POST_GUID,
    text: 'nice',
    createdAt: new Date('2016-07-12T00:00:00Z'),
  };
  const localPost = { [`Post:${POST_GUID}`]: { author: ALICE, local: true, public: true } };
  const remotePost = { [`Post:${POST_GUID}`]: { author: ALICE, local: false, public: true } };

  it('accepts a comment sent by its author to the local root author', async () => {
    const signed = signRelayable(comment, bob.privateKey);
    const body = buildPublicMessage(signed, { diasporaId: BOB, privateKey: bob.privateKey });
    const received = await receivePublic(body, options(localPost));
    expect(received.entity).toMatchObject({
      type: 'Comment',
      text: 'nice',
      authorSignature: signed.authorSignature,
    });
    expect(received.related).toEqual(localPost[`Post:${POST_GUID}`]);
  });

  it('accepts the comment relayed by the root author, keeping the author signature', async () => {
    const signed = signRelayable(comment, bob.privateKey);
    const first = await receivePublic(
      buildPublicMessage(signed, { diasporaId: BOB, privateKey: bob.privateKey }),
      options(localPost),
    );
    // alice (root author) relays what she received
    const relayed = buildPublicMessage(first.entity, {
      diasporaId: ALICE,
      privateKey: alice.privateKey,
    });
    const onCarolsPod = await receivePublic(relayed, options(remotePost));
    expect(onCarolsPod.sender).toBe(ALICE);
    expect(onCarolsPod.entity).toMatchObject({ author: BOB, text: 'nice' });
  });

  it('rejects the author sending directly when the parent is not local', async () => {
    const signed = signRelayable(comment, bob.privateKey);
    const body = buildPublicMessage(signed, { diasporaId: BOB, privateKey: bob.privateKey });
    await expect(receivePublic(body, options(remotePost))).rejects.toThrow(InvalidSenderError);
  });

  it('rejects a third party relaying', async () => {
    const signed = signRelayable(comment, bob.privateKey);
    const body = buildPublicMessage(signed, { diasporaId: CAROL, privateKey: carol.privateKey });
    await expect(receivePublic(body, options(localPost))).rejects.toThrow(InvalidSenderError);
  });

  it('rejects a missing, wrong or tampered author signature', async () => {
    const send = (c: Comment) =>
      receivePublic(
        buildPublicMessage(c, { diasporaId: ALICE, privateKey: alice.privateKey }),
        options(remotePost),
      );
    await expect(send(comment)).rejects.toThrow(SignatureVerificationError);
    await expect(send(signRelayable(comment, carol.privateKey))).rejects.toThrow(
      SignatureVerificationError,
    );
    const signed = signRelayable(comment, bob.privateKey);
    await expect(send({ ...signed, text: 'forged' })).rejects.toThrow(SignatureVerificationError);
    await expect(
      send({ ...signed, propertyOrder: ['guid', 'author', 'parent_guid', 'text', 'created_at'] }),
    ).rejects.toThrow(SignatureVerificationError);
  });

  it('accepts an unsigned relayable when the author is the root author', async () => {
    const own: Comment = { ...comment, author: ALICE };
    const body = buildPublicMessage(own, { diasporaId: ALICE, privateKey: alice.privateKey });
    await expect(receivePublic(body, options(remotePost))).resolves.toMatchObject({
      sender: ALICE,
    });
  });

  it('uses the root of nested parents (like on a comment)', async () => {
    const like = signRelayable(
      {
        type: 'Like',
        author: CAROL,
        guid: guid(2),
        parentGuid: guid(1),
        parentType: 'Comment',
        positive: true,
      } as const,
      carol.privateKey,
    );
    const related = {
      [`Comment:${guid(1)}`]: {
        author: BOB,
        local: false,
        parent: { author: ALICE, local: false },
      },
    };
    const fromRoot = buildPublicMessage(like, { diasporaId: ALICE, privateKey: alice.privateKey });
    await expect(receivePublic(fromRoot, options(related))).resolves.toBeDefined();
    const fromIntermediate = buildPublicMessage(like, {
      diasporaId: BOB,
      privateKey: bob.privateKey,
    });
    await expect(receivePublic(fromIntermediate, options(related))).rejects.toThrow(
      InvalidSenderError,
    );
  });

  it('fails when the parent is unknown or the author key is missing', async () => {
    const signed = signRelayable(comment, bob.privateKey);
    const body = buildPublicMessage(signed, { diasporaId: ALICE, privateKey: alice.privateKey });
    await expect(receivePublic(body, options())).rejects.toThrow(RelatedEntityNotFoundError);
    const noBobKey: ReceiveOptions = {
      ...options(remotePost),
      fetchPublicKey: (id) => (id === ALICE ? alice.publicKey : null),
    };
    await expect(receivePublic(body, noBobKey)).rejects.toThrow(PublicKeyNotFoundError);
  });

  it('receives the gem fixture comment relayed in an envelope', async () => {
    const body = createMagicEnvelope(COMMENT_XML_ALICE, ALICE, alice.privateKey);
    const received = await receivePublic(body, {
      fetchPublicKey: (id) =>
        id === COMMENT_AUTHOR ? ALICE_PUBLIC_KEY : id === ALICE ? alice.publicKey : null,
      fetchRelatedEntity: (type, g) =>
        type === 'Post' && g === COMMENT_PARENT_GUID ? { author: ALICE, local: false } : null,
    });
    expect(received.entity).toMatchObject({ type: 'Comment', author: COMMENT_AUTHOR });
  });
});

describe('other entity checks', () => {
  it('retraction: only the target author (or root author for relayables)', async () => {
    const retraction = {
      type: 'Retraction',
      author: BOB,
      targetGuid: guid(1),
      targetType: 'Comment',
    } as const;
    const related = {
      [`Comment:${guid(1)}`]: { author: BOB, local: false, parent: { author: ALICE, local: true } },
    };
    const by = (id: string, key: TestKeyPair) =>
      receivePublic(
        buildPublicMessage(
          { ...retraction, author: id },
          { diasporaId: id, privateKey: key.privateKey },
        ),
        options(related),
      );
    await expect(by(BOB, bob)).resolves.toBeDefined();
    await expect(by(ALICE, alice)).resolves.toBeDefined();
    await expect(by(CAROL, carol)).rejects.toThrow(InvalidSenderError);
    const postRetraction = {
      type: 'Retraction',
      author: ALICE,
      targetGuid: POST_GUID,
      targetType: 'Post',
    } as const;
    await expect(
      receivePublic(
        buildPublicMessage(postRetraction, { diasporaId: ALICE, privateKey: alice.privateKey }),
        options(),
      ),
    ).rejects.toThrow(RelatedEntityNotFoundError);
  });

  it('reshare: root author must match', async () => {
    const reshare = {
      type: 'Reshare',
      author: BOB,
      guid: guid(5),
      rootAuthor: ALICE,
      rootGuid: POST_GUID,
    } as const;
    const signer = { diasporaId: BOB, privateKey: bob.privateKey };
    const related = { [`Post:${POST_GUID}`]: { author: ALICE, local: false } };
    await expect(
      receivePublic(buildPublicMessage(reshare, signer), options(related)),
    ).resolves.toBeDefined();
    await expect(
      receivePublic(
        buildPublicMessage({ ...reshare, rootAuthor: CAROL }, signer),
        options(related),
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('participation: parent must be local', async () => {
    const participation = {
      type: 'Participation',
      author: BOB,
      guid: guid(6),
      parentGuid: POST_GUID,
      parentType: 'Post',
    } as const;
    const signer = { diasporaId: BOB, privateKey: bob.privateKey };
    await expect(
      receivePublic(
        buildPublicMessage(participation, signer),
        options({ [`Post:${POST_GUID}`]: { author: ALICE, local: true } }),
      ),
    ).resolves.toBeDefined();
    await expect(
      receivePublic(
        buildPublicMessage(participation, signer),
        options({ [`Post:${POST_GUID}`]: { author: ALICE, local: false } }),
      ),
    ).rejects.toThrow(ParentNotLocalError);
  });

  it('account migration: verified with the key of the other identity', async () => {
    const migration: AccountMigration = {
      type: 'AccountMigration',
      author: ALICE,
      profile: { type: 'Profile', author: CAROL, firstName: 'Alice' },
    };
    const signed = signAccountMigration(migration, carol.privateKey);
    const signer = { diasporaId: ALICE, privateKey: alice.privateKey };
    await expect(
      receivePublic(buildPublicMessage(signed, signer), options()),
    ).resolves.toMatchObject({
      entity: { type: 'AccountMigration', oldIdentity: ALICE },
    });
    const wrong = signAccountMigration(migration, alice.privateKey);
    await expect(receivePublic(buildPublicMessage(wrong, signer), options())).rejects.toThrow(
      SignatureVerificationError,
    );
    // new identity as author: the old identity signs
    const fromNew = signAccountMigration(
      { ...migration, author: CAROL, oldIdentity: ALICE },
      alice.privateKey,
    );
    await expect(
      receivePublic(
        buildPublicMessage(fromNew, { diasporaId: CAROL, privateKey: carol.privateKey }),
        options(),
      ),
    ).resolves.toBeDefined();
  });
});

describe('private delivery', () => {
  const conversation: Conversation = {
    type: 'Conversation',
    author: ALICE,
    guid: guid(400),
    subject: 'secret',
    createdAt: new Date('2016-07-11T23:17:48Z'),
    participants: `${ALICE};${BOB}`,
    messages: [
      {
        type: 'Message',
        author: ALICE,
        guid: guid(401),
        text: 'hi bob',
        createdAt: new Date('2016-07-11T23:17:48Z'),
        conversationGuid: guid(400),
      },
    ],
  };

  it('encrypts for the recipient and receives', async () => {
    const body = buildPrivateMessage(
      conversation,
      { diasporaId: ALICE, privateKey: alice.privateKey },
      bob.publicKey,
    );
    expect(Object.keys(JSON.parse(body))).toEqual(['aes_key', 'encrypted_magic_envelope']);
    const received = await receivePrivate(body, bob.privateKey, options());
    expect(received.sender).toBe(ALICE);
    expect(received.entity).toEqual(applyDefaults(conversation));
  });

  it('accepts non-public entities', async () => {
    const body = buildPrivateMessage(
      { ...post, public: false },
      { diasporaId: ALICE, privateKey: alice.privateKey },
      bob.publicKey,
    );
    await expect(receivePrivate(body, bob.privatePem, options())).resolves.toBeDefined();
  });

  it('cannot be read by someone else', async () => {
    const body = buildPrivateMessage(
      conversation,
      { diasporaId: ALICE, privateKey: alice.privateKey },
      bob.publicKey,
    );
    await expect(receivePrivate(body, carol.privateKey, options())).rejects.toThrow(
      DecryptionError,
    );
  });
});
