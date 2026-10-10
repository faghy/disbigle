import { beforeAll, describe, expect, it } from 'vitest';
import {
  type Comment,
  type Like,
  parseEntity,
  parseEntityAs,
  type Relayable,
  relayableSignatureData,
  serializeEntity,
  signatureOrder,
  signRelayable,
  ValidationError,
  verifyRelayableSignature,
} from '../src/index.ts';
import {
  ALICE_PRIVATE_KEY,
  ALICE_PUBLIC_KEY,
  COMMENT_AUTHOR,
  COMMENT_GUID,
  COMMENT_PARENT_GUID,
  COMMENT_TEXT,
  COMMENT_XML_ALICE,
  COMMENT_XML_ALICE_WITH_NEW_DATA,
  COMMENT_XML_BOB,
  COMMENT_XML_BOB_LEGACY_ORDER,
  COMMENT_XML_BOB_WITH_NEW_DATA,
} from './fixtures/gem.ts';
import { ALICE, generateTestKeys, guid, type TestKeyPair } from './helpers.ts';

describe('relayables: interop fixtures from the gem (comment_integration_spec)', () => {
  it('verifies the author signature of the comment created by the gem', () => {
    const comment = parseEntityAs('Comment', COMMENT_XML_ALICE);
    expect(comment.author).toBe(COMMENT_AUTHOR);
    expect(comment.guid).toBe(COMMENT_GUID);
    expect(comment.parentGuid).toBe(COMMENT_PARENT_GUID);
    expect(comment.text).toBe(COMMENT_TEXT);
    expect(comment.propertyOrder).toEqual(['author', 'guid', 'parent_guid', 'text']);
    expect(relayableSignatureData(comment)).toBe(
      `${COMMENT_AUTHOR};${COMMENT_GUID};${COMMENT_PARENT_GUID};${COMMENT_TEXT}`,
    );
    expect(verifyRelayableSignature(comment, ALICE_PUBLIC_KEY)).toBe(true);
  });

  it('verifies the comment with an unknown property (new_data)', () => {
    const comment = parseEntityAs('Comment', COMMENT_XML_ALICE_WITH_NEW_DATA);
    expect(comment.additionalData).toEqual({ new_data: 'foobar' });
    expect(comment.propertyOrder).toEqual(['author', 'guid', 'parent_guid', 'text', 'new_data']);
    expect(verifyRelayableSignature(comment, ALICE_PUBLIC_KEY)).toBe(true);
  });

  it('verifies the comment in legacy order', () => {
    const comment = parseEntityAs('Comment', COMMENT_XML_BOB_LEGACY_ORDER);
    expect(comment.author).toBe(COMMENT_AUTHOR);
    expect(comment.text).toBe(COMMENT_TEXT);
    expect(signatureOrder(comment)).toEqual(['guid', 'parent_guid', 'text', 'author']);
    expect(verifyRelayableSignature(comment, ALICE_PUBLIC_KEY)).toBe(true);
  });

  it('relays byte-identically to the gem (same order)', () => {
    const comment = parseEntity(COMMENT_XML_ALICE);
    expect(serializeEntity(comment)).toBe(COMMENT_XML_BOB.trim());
  });

  it('relays byte-identically to the gem (unknown data kept)', () => {
    const comment = parseEntity(COMMENT_XML_ALICE_WITH_NEW_DATA);
    expect(serializeEntity(comment)).toBe(COMMENT_XML_BOB_WITH_NEW_DATA.trim());
  });

  it('relays the legacy order unchanged and the signature still verifies', () => {
    const relayed = parseEntityAs('Comment', serializeEntity(parseEntity(COMMENT_XML_BOB_LEGACY_ORDER)));
    expect(relayed.propertyOrder).toEqual(['guid', 'parent_guid', 'text', 'author']);
    expect(verifyRelayableSignature(relayed, ALICE_PUBLIC_KEY)).toBe(true);
  });

  it('reproduces the exact signatures of the gem with the same key (deterministic RSA)', () => {
    const fromGem = parseEntityAs('Comment', COMMENT_XML_ALICE);
    const { authorSignature: _sig, ...unsigned } = fromGem;
    const signed = signRelayable(unsigned, ALICE_PRIVATE_KEY);
    expect(signed.authorSignature).toBe(fromGem.authorSignature);

    const withNewData = parseEntityAs('Comment', COMMENT_XML_ALICE_WITH_NEW_DATA);
    const { authorSignature: _sig2, ...unsigned2 } = withNewData;
    expect(signRelayable(unsigned2, ALICE_PRIVATE_KEY).authorSignature).toBe(
      withNewData.authorSignature,
    );
  });

  it('creates the gem comment XML from scratch', () => {
    const comment: Comment = {
      type: 'Comment',
      author: COMMENT_AUTHOR,
      guid: COMMENT_GUID,
      parentGuid: COMMENT_PARENT_GUID,
      text: COMMENT_TEXT,
      // the fixture predates created_at; reproduce its property order
      propertyOrder: ['author', 'guid', 'parent_guid', 'text'],
    };
    expect(serializeEntity(signRelayable(comment, ALICE_PRIVATE_KEY))).toBe(COMMENT_XML_ALICE.trim());
  });

  it('rejects the fixture with a tampered value', () => {
    const tampered = COMMENT_XML_ALICE.replace(COMMENT_TEXT, 'this is a forged comment');
    expect(verifyRelayableSignature(parseEntityAs('Comment', tampered), ALICE_PUBLIC_KEY)).toBe(false);
  });

  it('rejects the fixture when an unknown property is tampered or dropped', () => {
    const tampered = COMMENT_XML_ALICE_WITH_NEW_DATA.replace('foobar', 'foobaz');
    expect(verifyRelayableSignature(parseEntityAs('Comment', tampered), ALICE_PUBLIC_KEY)).toBe(false);
    const dropped = COMMENT_XML_ALICE_WITH_NEW_DATA.replace('  <new_data>foobar</new_data>\n', '');
    expect(verifyRelayableSignature(parseEntityAs('Comment', dropped), ALICE_PUBLIC_KEY)).toBe(false);
  });

  it('rejects the fixture when the element order is changed', () => {
    const reordered = COMMENT_XML_ALICE.replace(
      '  <author>alice@pod-a.org</author>\n  <guid>e21589b0b41101333b870f77ba60fa73</guid>\n',
      '  <guid>e21589b0b41101333b870f77ba60fa73</guid>\n  <author>alice@pod-a.org</author>\n',
    );
    const comment = parseEntityAs('Comment', reordered);
    expect(comment.propertyOrder?.slice(0, 2)).toEqual(['guid', 'author']);
    expect(verifyRelayableSignature(comment, ALICE_PUBLIC_KEY)).toBe(false);
  });

  it('rejects the fixture with a wrong key', () => {
    const other = generateTestKeys();
    expect(verifyRelayableSignature(parseEntityAs('Comment', COMMENT_XML_ALICE), other.publicKey)).toBe(
      false,
    );
  });

  it('rejects a missing or garbage signature', () => {
    const comment = parseEntityAs('Comment', COMMENT_XML_ALICE);
    const { authorSignature: _s, ...unsigned } = comment;
    expect(verifyRelayableSignature(unsigned, ALICE_PUBLIC_KEY)).toBe(false);
    expect(verifyRelayableSignature({ ...comment, authorSignature: 'aa' }, ALICE_PUBLIC_KEY)).toBe(false);
  });
});

describe('relayables: generated', () => {
  let keys: TestKeyPair;
  beforeAll(() => {
    keys = generateTestKeys();
  });

  const like: Like = {
    type: 'Like',
    author: ALICE,
    guid: guid(1),
    parentGuid: guid(2),
    parentType: 'Post',
    positive: true,
  };

  it('signs in schema order and serialises like the gem like_spec template', () => {
    const signed = signRelayable(like, keys.privateKey);
    expect(serializeEntity(signed)).toBe(`<like>
  <author>${ALICE}</author>
  <guid>${guid(1)}</guid>
  <parent_guid>${guid(2)}</parent_guid>
  <parent_type>Post</parent_type>
  <positive>true</positive>
  <author_signature>${signed.authorSignature}</author_signature>
</like>`);
    const parsed = parseEntityAs('Like', serializeEntity(signed));
    expect(verifyRelayableSignature(parsed, keys.publicKey)).toBe(true);
  });

  it('signs `false` booleans as "false"', () => {
    const dislike = signRelayable({ ...like, positive: false }, keys.privateKey);
    expect(relayableSignatureData(dislike)).toBe(`${ALICE};${guid(1)};${guid(2)};Post;false`);
    expect(serializeEntity(dislike)).toContain('<positive>false</positive>');
    expect(verifyRelayableSignature(parseEntity(serializeEntity(dislike)) as Like, keys.publicKey)).toBe(
      true,
    );
  });

  it('accepts other boolean spellings but signs the normalised value (gem behaviour)', () => {
    const signed = signRelayable(like, keys.privateKey);
    const xml = serializeEntity(signed).replace('<positive>true</positive>', '<positive>1</positive>');
    const parsed = parseEntityAs('Like', xml);
    expect(parsed.positive).toBe(true);
    expect(verifyRelayableSignature(parsed, keys.publicKey)).toBe(true);
  });

  it('signs comments with created_at and edited_at, omitting absent optional values', () => {
    const createdAt = new Date('2016-07-12T00:49:06.789Z');
    const comment: Comment = {
      type: 'Comment',
      author: ALICE,
      guid: guid(3),
      parentGuid: guid(4),
      text: 'hello',
      createdAt,
    };
    const signed = signRelayable(comment, keys.privateKey);
    expect(relayableSignatureData(signed)).toBe(
      `${ALICE};${guid(3)};${guid(4)};hello;2016-07-12T00:49:06Z`,
    );
    const edited = signRelayable({ ...comment, editedAt: new Date('2016-07-13T00:00:00Z') }, keys.privateKey);
    expect(serializeEntity(edited)).toBe(`<comment>
  <author>${ALICE}</author>
  <guid>${guid(3)}</guid>
  <parent_guid>${guid(4)}</parent_guid>
  <text>hello</text>
  <created_at>2016-07-12T00:49:06Z</created_at>
  <edited_at>2016-07-13T00:00:00Z</edited_at>
  <author_signature>${edited.authorSignature}</author_signature>
</comment>`);
  });

  it('fills created_at once when signing, so the serialisation matches the signature', () => {
    const signed = signRelayable(
      { type: 'Comment', author: ALICE, guid: guid(5), parentGuid: guid(6), text: 'x' },
      keys.privateKey,
    );
    expect(signed.createdAt).toBeInstanceOf(Date);
    const parsed = parseEntityAs('Comment', serializeEntity(signed));
    expect(verifyRelayableSignature(parsed, keys.publicKey)).toBe(true);
  });

  it('includes unknown properties in a custom order (relayable_spec)', () => {
    const relayable: Relayable = {
      ...like,
      propertyOrder: ['author', 'guid', 'parent_guid', 'new_property', 'parent_type', 'positive'],
      additionalData: { new_property: 'some text' },
    };
    const signed = signRelayable(relayable, keys.privateKey);
    expect(relayableSignatureData(signed)).toBe(
      `${ALICE};${guid(1)};${guid(2)};some text;Post;true`,
    );
    const parsed = parseEntityAs('Like', serializeEntity(signed));
    expect(parsed.additionalData).toEqual({ new_property: 'some text' });
    expect(verifyRelayableSignature(parsed, keys.publicKey)).toBe(true);
  });

  it('writes empty elements for properties in the order without value', () => {
    const xml = serializeEntity({
      ...like,
      propertyOrder: ['author', 'guid', 'parent_guid', 'parent_type', 'positive', 'new_property'],
      authorSignature: 'aa',
    });
    expect(xml).toContain('<new_property/>\n  <author_signature>aa</author_signature>');
  });

  it('filters signature elements from order and additional data', () => {
    const signed = signRelayable(like, keys.privateKey);
    const xml = serializeEntity(signed).replace(
      '</like>',
      '  <parent_author_signature>bb</parent_author_signature>\n</like>',
    );
    const parsed = parseEntityAs('Like', xml);
    expect(parsed.propertyOrder).not.toContain('parent_author_signature');
    expect(parsed.additionalData).toEqual({});
    expect(verifyRelayableSignature(parsed, keys.publicKey)).toBe(true);
    expect(serializeEntity(parsed)).not.toContain('parent_author_signature');
  });

  it('replaces invalid XML characters before signing (relayable_spec)', () => {
    const signed = signRelayable(
      {
        type: 'Comment',
        author: ALICE,
        guid: guid(7),
        parentGuid: guid(8),
        text: 'asdf\u001casdf asdf💩asdf\nasdf',
        createdAt: new Date('2020-01-01T00:00:00Z'),
      },
      keys.privateKey,
    );
    expect(relayableSignatureData(signed)).toBe(
      `${ALICE};${guid(7)};${guid(8)};asdf�asdf asdf💩asdf\nasdf;2020-01-01T00:00:00Z`,
    );
    const parsed = parseEntityAs('Comment', serializeEntity(signed));
    expect(verifyRelayableSignature(parsed, keys.publicKey)).toBe(true);
  });

  it('omits author_signature when unsigned (author is the root author)', () => {
    expect(serializeEntity(like)).not.toContain('author_signature');
  });

  it('requires parent_guid and parent_type', () => {
    expect(() => parseEntity('<like>\n</like>')).toThrow("Invalid Like! Missing 'parent_type'.");
    expect(() => parseEntity(`<comment><guid>${guid(1)}</guid></comment>`)).toThrow(
      `Invalid Comment:${guid(1)}! Missing 'parent_guid'.`,
    );
    expect(() => parseEntity(`<comment><author>${ALICE}</author></comment>`)).toThrow(
      `Invalid Comment from ${ALICE}! Missing 'parent_guid'.`,
    );
    expect(() => parseEntity('<poll_participation></poll_participation>')).toThrow(ValidationError);
  });
});
