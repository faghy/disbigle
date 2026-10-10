import { describe, expect, it } from 'vitest';
import {
  type AccountMigration,
  applyDefaults,
  type Conversation,
  type Entity,
  type Event,
  InvalidXmlError,
  type Message,
  type Photo,
  type Poll,
  type Profile,
  parseEntity,
  parseEntityAs,
  parseTimestamp,
  type StatusMessage,
  serializeEntity,
  UnknownEntityError,
  ValidationError,
} from '../src/index.ts';
import { SPEC_EXAMPLES } from './fixtures/spec-examples.ts';
import { ALICE, BOB, CAROL, guid } from './helpers.ts';

const T1 = new Date('2016-07-11T22:38:19Z');
const T2 = new Date('2016-07-12T10:00:00Z');

const location = { type: 'Location', address: 'Vienna, Austria', lat: '48.208174', lng: '16.373819' } as const;

const photo = (n: number, sm = guid(100)): Photo => ({
  type: 'Photo',
  guid: guid(n),
  author: ALICE,
  public: true,
  createdAt: T1,
  editedAt: T2,
  remotePhotoPath: 'https://example.org/uploads/images/',
  remotePhotoName: `${n}.jpg`,
  text: `photo ${n}`,
  statusMessageGuid: sm,
  height: 480,
  width: 800,
});

const poll: Poll = {
  type: 'Poll',
  guid: guid(200),
  question: 'Select an answer',
  pollAnswers: [
    { type: 'PollAnswer', guid: guid(201), answer: 'Yes' },
    { type: 'PollAnswer', guid: guid(202), answer: 'No' },
  ],
};

const event: Event = {
  type: 'Event',
  author: ALICE,
  guid: guid(300),
  summary: 'Cool event',
  description: 'You need to see this!',
  start: new Date('2016-12-27T12:00:00Z'),
  end: new Date('2016-12-27T13:00:00Z'),
  allDay: false,
  timezone: 'Europe/Berlin',
  location,
};

const profile: Profile = {
  type: 'Profile',
  author: ALICE,
  editedAt: T2,
  fullName: 'Alice Smith',
  firstName: 'Alice',
  lastName: 'Smith',
  imageUrl: 'https://example.org/images/thumb_large.jpg',
  imageUrlMedium: 'https://example.org/images/thumb_medium.jpg',
  imageUrlSmall: 'https://example.org/images/thumb_small.jpg',
  bio: 'some text about me',
  birthday: '1988-07-15',
  gender: 'Female',
  location: 'github',
  searchable: true,
  public: false,
  nsfw: false,
  tagString: '#i #love #tags',
};

const message = (n: number, conversation = guid(400)): Message => ({
  type: 'Message',
  author: ALICE,
  guid: guid(n),
  text: `message ${n}`,
  createdAt: T1,
  conversationGuid: conversation,
});

/** One fully populated instance of every entity. */
const SAMPLES: Entity[] = [
  { type: 'AccountDeletion', author: ALICE },
  {
    type: 'AccountMigration',
    author: ALICE,
    profile: { ...profile, author: 'alice@newpod.example.net' },
    signature: 'c2lnbmF0dXJl',
    oldIdentity: ALICE,
    remotePhotoPath: 'https://newpod.example.net/uploads/images/',
  },
  {
    type: 'Comment',
    author: ALICE,
    guid: guid(1),
    parentGuid: guid(2),
    text: 'a comment',
    createdAt: T1,
    editedAt: T2,
    authorSignature: 'c2ln',
  },
  { type: 'Contact', author: ALICE, recipient: BOB, following: true, sharing: true, blocking: false },
  {
    type: 'Conversation',
    author: ALICE,
    guid: guid(400),
    subject: 'subject',
    createdAt: T1,
    participants: `${ALICE};${BOB}`,
    messages: [message(401), message(402)],
  },
  { type: 'Embed', url: 'https://example.org/', title: 'Example', description: 'Desc', image: 'https://example.org/x.png' },
  event,
  {
    type: 'EventParticipation',
    author: BOB,
    guid: guid(3),
    parentGuid: guid(300),
    status: 'accepted',
    authorSignature: 'c2ln',
  },
  {
    type: 'Like',
    author: BOB,
    guid: guid(4),
    parentGuid: guid(1),
    parentType: 'Comment',
    positive: true,
    authorSignature: 'c2ln',
  },
  location,
  { ...message(5), editedAt: T2 },
  { type: 'Participation', author: BOB, guid: guid(6), parentGuid: guid(100), parentType: 'Post' },
  photo(7),
  poll,
  { type: 'PollAnswer', guid: guid(8), answer: 'Maybe' },
  { type: 'PollParticipation', author: BOB, guid: guid(9), parentGuid: guid(200), pollAnswerGuid: guid(201), authorSignature: 'c2ln' },
  profile,
  { type: 'Reshare', author: BOB, guid: guid(10), createdAt: T1, rootAuthor: ALICE, rootGuid: guid(100) },
  { type: 'Retraction', author: ALICE, targetGuid: guid(100), targetType: 'Post' },
  {
    type: 'StatusMessage',
    author: ALICE,
    guid: guid(100),
    createdAt: T1,
    public: true,
    providerDisplayName: 'mobile',
    text: 'i am a very interesting status update',
    editedAt: T2,
    photos: [photo(11), photo(12)],
    location,
    poll,
    event,
    embed: { type: 'Embed', nothing: true },
  },
];

/** Strips relayable parsing metadata, to compare with the input. */
function withoutMeta(entity: Entity): Entity {
  const { propertyOrder: _o, additionalData: _a, ...rest } = entity as Entity & {
    propertyOrder?: unknown;
    additionalData?: unknown;
  };
  return rest as Entity;
}

describe('entities: round trip', () => {
  it('covers every entity type', () => {
    expect(new Set(SAMPLES.map((e) => e.type)).size).toBe(20);
  });

  for (const sample of SAMPLES) {
    it(`${sample.type} survives serialise → parse → serialise`, () => {
      const xml = serializeEntity(sample);
      const parsed = parseEntity(xml);
      expect(withoutMeta(parsed)).toEqual(applyDefaults(sample));
      expect(serializeEntity(parsed)).toBe(xml);
    });
  }
});

describe('entities: XML identical to the gem spec templates', () => {
  it('StatusMessage with photos and location (status_message_spec)', () => {
    const p1 = photo(11);
    const p2 = photo(12);
    const sm: StatusMessage = {
      type: 'StatusMessage',
      author: ALICE,
      guid: guid(100),
      createdAt: T1,
      public: false,
      providerDisplayName: 'something',
      text: 'i am a very interesting status update',
      editedAt: T2,
      photos: [p1, p2],
      location,
    };
    const photoXml = (p: Photo) => `  <photo>
    <guid>${p.guid}</guid>
    <author>${p.author}</author>
    <public>true</public>
    <created_at>2016-07-11T22:38:19Z</created_at>
    <edited_at>2016-07-12T10:00:00Z</edited_at>
    <remote_photo_path>${p.remotePhotoPath}</remote_photo_path>
    <remote_photo_name>${p.remotePhotoName}</remote_photo_name>
    <text>${p.text}</text>
    <status_message_guid>${p.statusMessageGuid}</status_message_guid>
    <height>480</height>
    <width>800</width>
  </photo>`;
    expect(serializeEntity(sm)).toBe(`<status_message>
  <author>${ALICE}</author>
  <guid>${guid(100)}</guid>
  <created_at>2016-07-11T22:38:19Z</created_at>
  <public>false</public>
  <provider_display_name>something</provider_display_name>
  <text>i am a very interesting status update</text>
  <edited_at>2016-07-12T10:00:00Z</edited_at>
${photoXml(p1)}
${photoXml(p2)}
  <location>
    <address>Vienna, Austria</address>
    <lat>48.208174</lat>
    <lng>16.373819</lng>
  </location>
</status_message>`);
  });

  it('Conversation with messages (conversation_spec, message_spec)', () => {
    const conversation: Conversation = {
      type: 'Conversation',
      author: ALICE,
      guid: guid(400),
      subject: 'this is a very informative subject',
      createdAt: T1,
      participants: `${ALICE};${BOB}`,
      messages: [message(401)],
    };
    expect(serializeEntity(conversation)).toBe(`<conversation>
  <author>${ALICE}</author>
  <guid>${guid(400)}</guid>
  <subject>this is a very informative subject</subject>
  <created_at>2016-07-11T22:38:19Z</created_at>
  <participants>${ALICE};${BOB}</participants>
  <message>
    <author>${ALICE}</author>
    <guid>${guid(401)}</guid>
    <text>message 401</text>
    <created_at>2016-07-11T22:38:19Z</created_at>
    <conversation_guid>${guid(400)}</conversation_guid>
  </message>
</conversation>`);
  });

  it('AccountMigration with nested profile (account_migration_spec)', () => {
    const migration: AccountMigration = {
      type: 'AccountMigration',
      author: ALICE,
      profile: {
        type: 'Profile',
        author: CAROL,
        fullName: 'Carol',
        firstName: 'Carol',
        imageUrl: '/assets/user/default.png',
        imageUrlMedium: '/assets/user/default.png',
        imageUrlSmall: '/assets/user/default.png',
        bio: 'bio',
        birthday: '1988-07-15',
        gender: 'Female',
        location: 'github',
        searchable: true,
        public: false,
        nsfw: false,
        tagString: '#i #love #tags',
      },
      signature: 'c2ln',
      oldIdentity: ALICE,
      remotePhotoPath: 'http://localhost:3000/uploads/images/',
    };
    expect(serializeEntity(migration)).toBe(`<account_migration>
  <author>${ALICE}</author>
  <profile>
    <author>${CAROL}</author>
    <full_name>Carol</full_name>
    <first_name>Carol</first_name>
    <image_url>/assets/user/default.png</image_url>
    <image_url_medium>/assets/user/default.png</image_url_medium>
    <image_url_small>/assets/user/default.png</image_url_small>
    <bio>bio</bio>
    <birthday>1988-07-15</birthday>
    <gender>Female</gender>
    <location>github</location>
    <searchable>true</searchable>
    <public>false</public>
    <nsfw>false</nsfw>
    <tag_string>#i #love #tags</tag_string>
  </profile>
  <signature>c2ln</signature>
  <old_identity>${ALICE}</old_identity>
  <remote_photo_path>http://localhost:3000/uploads/images/</remote_photo_path>
</account_migration>`);
  });

  it('writes old_identity as the author when the author is the old identity', () => {
    const xml = serializeEntity({
      type: 'AccountMigration',
      author: ALICE,
      profile: { type: 'Profile', author: CAROL },
      signature: 'c2ln',
    });
    expect(xml).toContain(`<old_identity>${ALICE}</old_identity>`);
  });

  it('Contact, Participation, Reshare, Retraction, AccountDeletion, Poll, Event', () => {
    expect(serializeEntity({ type: 'Contact', author: ALICE, recipient: BOB })).toBe(`<contact>
  <author>${ALICE}</author>
  <recipient>${BOB}</recipient>
  <following>true</following>
  <sharing>true</sharing>
  <blocking>false</blocking>
</contact>`);
    expect(
      serializeEntity({ type: 'Participation', author: BOB, guid: guid(6), parentGuid: guid(1), parentType: 'Post' }),
    ).toBe(`<participation>
  <author>${BOB}</author>
  <guid>${guid(6)}</guid>
  <parent_guid>${guid(1)}</parent_guid>
  <parent_type>Post</parent_type>
</participation>`);
    expect(
      serializeEntity({ type: 'Reshare', author: BOB, guid: guid(10), createdAt: T1, rootAuthor: ALICE, rootGuid: guid(1) }),
    ).toBe(`<reshare>
  <author>${BOB}</author>
  <guid>${guid(10)}</guid>
  <created_at>2016-07-11T22:38:19Z</created_at>
  <root_author>${ALICE}</root_author>
  <root_guid>${guid(1)}</root_guid>
</reshare>`);
    expect(serializeEntity({ type: 'Retraction', author: ALICE, targetGuid: guid(1), targetType: 'Post' }))
      .toBe(`<retraction>
  <author>${ALICE}</author>
  <target_guid>${guid(1)}</target_guid>
  <target_type>Post</target_type>
</retraction>`);
    expect(serializeEntity({ type: 'AccountDeletion', author: ALICE })).toBe(
      `<account_deletion>\n  <author>${ALICE}</author>\n</account_deletion>`,
    );
    expect(serializeEntity(poll)).toBe(`<poll>
  <guid>${guid(200)}</guid>
  <question>Select an answer</question>
  <poll_answer>
    <guid>${guid(201)}</guid>
    <answer>Yes</answer>
  </poll_answer>
  <poll_answer>
    <guid>${guid(202)}</guid>
    <answer>No</answer>
  </poll_answer>
</poll>`);
    expect(serializeEntity({ ...event, end: undefined, timezone: undefined, allDay: true })).toBe(`<event>
  <author>${ALICE}</author>
  <guid>${guid(300)}</guid>
  <summary>Cool event</summary>
  <description>You need to see this!</description>
  <start>2016-12-27T12:00:00Z</start>
  <all_day>true</all_day>
  <location>
    <address>Vienna, Austria</address>
    <lat>48.208174</lat>
    <lng>16.373819</lng>
  </location>
</event>`);
  });

  it('writes an empty element for an empty required string', () => {
    const xml = serializeEntity({ type: 'StatusMessage', author: ALICE, guid: guid(1), createdAt: T1 });
    expect(xml).toBe(`<status_message>
  <author>${ALICE}</author>
  <guid>${guid(1)}</guid>
  <created_at>2016-07-11T22:38:19Z</created_at>
  <public>false</public>
  <text/>
</status_message>`);
  });

  it('escapes text like libxml2 and replaces invalid XML characters', () => {
    const xml = serializeEntity({
      type: 'StatusMessage',
      author: ALICE,
      guid: guid(1),
      createdAt: T1,
      text: 'a < b && c > d\r\u0001 "q"',
    });
    expect(xml).toContain('<text>a &lt; b &amp;&amp; c &gt; d&#13;� "q"</text>');
    expect(parseEntityAs('StatusMessage', xml).text).toBe('a < b && c > d\r� "q"');
  });
});

describe('entities: parsing', () => {
  for (const { name, xml } of SPEC_EXAMPLES) {
    it(`parses the protocol documentation example: ${name}`, () => {
      const entity = parseEntity(xml);
      expect(serializeEntity(entity)).toBeTypeOf('string');
    });
  }

  it('reads the values of the documentation examples', () => {
    const sm = parseEntityAs(
      'StatusMessage',
      SPEC_EXAMPLES.find((e) => e.name === 'status_message #6')?.xml ?? '',
    );
    expect(sm.photos).toHaveLength(2);
    expect(sm.photos?.[0]?.height).toBe(480);
    expect(sm.poll?.pollAnswers.map((a) => a.answer)).toEqual(['Yes', 'No', 'Maybe']);
    expect(sm.location?.lat).toBe('48.208174');
    expect(sm.embed?.title).toBe('Example Website');
    expect(sm.providerDisplayName).toBe('mobile');
    expect(sm.createdAt).toEqual(new Date('2016-07-11T23:02:24Z'));

    const migration = parseEntityAs(
      'AccountMigration',
      SPEC_EXAMPLES.find((e) => e.name === 'account_migration')?.xml ?? '',
    );
    expect(migration.profile.author).toBe('alice@newpod.example.net');
    expect(migration.profile.lastName).toBeUndefined();
    expect(migration.signature?.trim()).toMatch(/^07b1OIY6/);

    const like = parseEntityAs('Like', SPEC_EXAMPLES.find((e) => e.name === 'like')?.xml ?? '');
    expect(like.propertyOrder).toEqual(['positive', 'guid', 'parent_type', 'parent_guid', 'author']);
  });

  it('applies defaults only for absent elements', () => {
    const contact = parseEntityAs('Contact', `<contact><author>${ALICE}</author><recipient>${BOB}</recipient></contact>`);
    expect(contact).toMatchObject({ following: true, sharing: true, blocking: false });
    expect(() =>
      parseEntity(`<contact><author>${ALICE}</author><recipient>${BOB}</recipient><sharing/></contact>`),
    ).toThrow(ValidationError);
  });

  it('parses lenient booleans, integers and timestamps', () => {
    const p = parseEntityAs(
      'Photo',
      `<photo><guid>${guid(1)}</guid><author>${ALICE}</author><public>yes</public>
       <created_at>2016-06-29 04:42:23 UTC</created_at><remote_photo_path>https://x.org/</remote_photo_path>
       <remote_photo_name>a.jpg</remote_photo_name><height>abc</height><width>800</width></photo>`,
    );
    expect(p.public).toBe(true);
    expect(p.createdAt).toEqual(new Date('2016-06-29T04:42:23Z'));
    expect(p.height).toBeUndefined();
    expect(p.width).toBe(800);
    expect(parseTimestamp('2016-07-11T22:38:19.123+02:00')).toEqual(new Date('2016-07-11T20:38:19.123Z'));
    expect(parseTimestamp('not a date')).toBeUndefined();
  });

  it('ignores unknown elements of non-relayable entities', () => {
    const r = parseEntity(
      `<retraction><author>${ALICE}</author><target_guid>${guid(1)}</target_guid><target_type>Post</target_type><x>1</x></retraction>`,
    );
    expect(r).toEqual({ type: 'Retraction', author: ALICE, targetGuid: guid(1), targetType: 'Post' });
  });

  it('treats empty nested elements as absent', () => {
    const sm = parseEntityAs(
      'StatusMessage',
      `<status_message><author>${ALICE}</author><guid>${guid(1)}</guid><text>x</text><location/><photo/></status_message>`,
    );
    expect(sm.location).toBeUndefined();
    expect(sm.photos).toEqual([]);
  });
});

describe('entities: negative cases', () => {
  it('rejects unknown and invalid root elements', () => {
    expect(() => parseEntity('<unknown_thing/>')).toThrow(UnknownEntityError);
    expect(() => parseEntity('<Status-Message/>')).toThrow(UnknownEntityError);
    expect(() => parseEntityAs('Comment', `<retraction><author>${ALICE}</author></retraction>`)).toThrow();
  });

  it('rejects malformed XML', () => {
    expect(() => parseEntity('<status_message><author>')).toThrow(InvalidXmlError);
    expect(() => parseEntity('')).toThrow(InvalidXmlError);
  });

  it('reports missing required properties', () => {
    expect(() => parseEntity(`<retraction><author>${ALICE}</author></retraction>`)).toThrow(
      'Retraction from alice@example.org: Missing required properties: target_guid, target_type',
    );
    expect(() => parseEntity('<account_deletion/>')).toThrow('Missing required properties: author');
  });

  it('validates property values', () => {
    expect(() => parseEntity('<account_deletion><author>not an id</author></account_deletion>')).toThrow(
      /diaspora_id/,
    );
    expect(() =>
      serializeEntity({ type: 'Retraction', author: ALICE, targetGuid: 'short', targetType: 'Post' }),
    ).toThrow(/guid/);
    expect(() =>
      serializeEntity({ type: 'Like', author: ALICE, guid: guid(1), parentGuid: guid(2), parentType: 'Photo', positive: true }),
    ).toThrow(ValidationError);
    expect(() =>
      serializeEntity({ type: 'Profile', author: ALICE, firstName: 'semi;colon' }),
    ).toThrow(ValidationError);
    expect(() =>
      serializeEntity({ type: 'Profile', author: ALICE, birthday: '1988-02-30' }),
    ).toThrow(ValidationError);
    expect(() =>
      serializeEntity({ type: 'Profile', author: ALICE, tagString: '#a #b #c #d #e #f' }),
    ).toThrow(ValidationError);
    expect(() => serializeEntity({ ...poll, pollAnswers: poll.pollAnswers.slice(0, 1) })).toThrow(
      ValidationError,
    );
  });

  it('enforces the cross-property rules', () => {
    expect(() =>
      serializeEntity({ type: 'Contact', author: ALICE, recipient: BOB, blocking: true }),
    ).toThrow(/can't both be true/);
    expect(
      serializeEntity({ type: 'Contact', author: ALICE, recipient: BOB, following: false, sharing: false, blocking: true }),
    ).toContain('<blocking>true</blocking>');
    expect(() =>
      serializeEntity({ type: 'Conversation', author: ALICE, guid: guid(1), subject: 's', participants: `${ALICE};${BOB}`, messages: [{ ...message(2, guid(1)), author: BOB }] }),
    ).toThrow(/different author/);
    expect(() =>
      serializeEntity({ type: 'StatusMessage', author: ALICE, guid: guid(1), photos: [{ ...photo(2), author: BOB }] }),
    ).toThrow(/different author/);
    expect(() => serializeEntity({ type: 'Embed' })).toThrow(/nothing/);
    expect(() => serializeEntity({ type: 'Embed', url: 'https://x.org/', nothing: true })).toThrow(/nothing/);
    expect(() =>
      serializeEntity({ type: 'Conversation', author: ALICE, guid: guid(1), subject: 's', participants: ALICE }),
    ).toThrow(/diaspora_id_list/);
  });
});
