import { describe, expect, it } from 'vitest';
import {
  buildHCard,
  buildHostMeta,
  buildWebFinger,
  buildXrd,
  DiscoveryError,
  type HCard,
  InvalidDataError,
  InvalidDocumentError,
  isDiasporaWebFinger,
  parseHCard,
  parseHostMeta,
  parseJrd,
  parseWebFinger,
  parseXrd,
  toJrd,
  webFingerUrl,
} from '../src/index.ts';
import { SPEC_HCARD_HTML, SPEC_HCARD_KEY, XRD_JSON, XRD_XML } from './fixtures/gem.ts';
import { generateTestKeys } from './helpers.ts';

const POD = 'https://pod.example.tld/';
const GUID = '7dba7ca01d64013485eb3131731751e9';

describe('XRD / JRD (xrd_document_spec)', () => {
  const doc = {
    subject: 'http://blog.example.com/article/id/314',
    expires: new Date('2010-01-30T09:30:00Z'),
    aliases: ['http://blog.example.com/cool_new_thing', 'http://blog.example.com/steve/article/7'],
    properties: {
      'http://blgx.example.net/ns/version': '1.3',
      'http://blgx.example.net/ns/ext': null,
    },
    links: [
      { rel: 'author', type: 'text/html', href: 'http://blog.example.com/author/steve' },
      { rel: 'author', href: 'http://example.com/author/john' },
      { rel: 'copyright', template: 'http://example.com/copyright?id={uri}' },
    ],
  };

  it('generates the same XML as the gem', () => {
    expect(buildXrd(doc)).toBe(XRD_XML);
  });

  it('generates the same JSON as the gem', () => {
    expect(JSON.stringify(toJrd(doc), null, 2)).toBe(XRD_JSON);
  });

  it('parses the XML and JSON fixtures', () => {
    expect(parseXrd(XRD_XML)).toEqual(doc);
    expect(parseJrd(XRD_JSON)).toEqual(doc);
  });

  it('rejects documents that are not XRD/JRD', () => {
    expect(() => parseXrd('<foo/>')).toThrow(InvalidDocumentError);
    expect(() => parseXrd('garbage')).toThrow(InvalidDocumentError);
    expect(() => parseJrd('{"subject": ')).toThrow(InvalidDocumentError);
    expect(() => parseJrd('[]')).toThrow(InvalidDocumentError);
  });
});

describe('WebFinger (web_finger_spec)', () => {
  const full = {
    diasporaId: 'alice@pod.example.tld',
    hcardUrl: `${POD}hcard/users/${GUID}`,
    seedUrl: POD,
    profileUrl: `${POD}u/alice`,
    atomUrl: `${POD}public/alice.atom`,
    salmonUrl: `${POD}receive/users/${GUID}`,
    subscribeUrl: `${POD}people?q={uri}`,
    aliases: [`${POD}people/${GUID}`],
  };

  it('creates the same JSON document as the gem', () => {
    expect(JSON.stringify(buildWebFinger(full), null, 2)).toBe(`{
  "subject": "acct:alice@pod.example.tld",
  "aliases": [
    "${POD}people/${GUID}"
  ],
  "links": [
    {
      "rel": "http://microformats.org/profile/hcard",
      "type": "text/html",
      "href": "${POD}hcard/users/${GUID}"
    },
    {
      "rel": "http://joindiaspora.com/seed_location",
      "type": "text/html",
      "href": "${POD}"
    },
    {
      "rel": "http://webfinger.net/rel/profile-page",
      "type": "text/html",
      "href": "${POD}u/alice"
    },
    {
      "rel": "http://schemas.google.com/g/2010#updates-from",
      "type": "application/atom+xml",
      "href": "${POD}public/alice.atom"
    },
    {
      "rel": "salmon",
      "href": "${POD}receive/users/${GUID}"
    },
    {
      "rel": "http://ostatus.org/schema/1.0/subscribe",
      "template": "${POD}people?q={uri}"
    }
  ]
}`);
  });

  it('creates the minimal document and appends extra links (e.g. ActivityPub self)', () => {
    const jrd = buildWebFinger({
      diasporaId: 'Alice@Pod.Example.tld',
      hcardUrl: `${POD}hcard/users/${GUID}`,
      seedUrl: POD,
      links: [{ rel: 'self', type: 'application/activity+json', href: `${POD}users/alice` }],
    });
    expect(jrd.subject).toBe('acct:alice@pod.example.tld');
    expect(jrd.links?.map((l) => l.rel)).toEqual([
      'http://microformats.org/profile/hcard',
      'http://joindiaspora.com/seed_location',
      'self',
    ]);
    expect(jrd).not.toHaveProperty('aliases');
  });

  it('parses a document', () => {
    const info = parseWebFinger(JSON.stringify(buildWebFinger(full)), {
      expectedDiasporaId: 'acct:ALICE@pod.example.tld',
      requireDiaspora: true,
    });
    expect(info).toMatchObject({
      subject: 'acct:alice@pod.example.tld',
      diasporaId: 'alice@pod.example.tld',
      hcardUrl: full.hcardUrl,
      seedUrl: POD,
      profileUrl: full.profileUrl,
      atomUrl: full.atomUrl,
      salmonUrl: full.salmonUrl,
      subscribeUrl: full.subscribeUrl,
      aliases: full.aliases,
    });
    expect(isDiasporaWebFinger(info)).toBe(true);
  });

  it('parses a non-diaspora document without hcard links', () => {
    const info = parseWebFinger({
      subject: 'acct:bob@mastodon.example',
      links: [
        {
          rel: 'self',
          type: 'application/activity+json',
          href: 'https://mastodon.example/users/bob',
        },
      ],
    });
    expect(isDiasporaWebFinger(info)).toBe(false);
    expect(info.links[0]?.href).toBe('https://mastodon.example/users/bob');
    expect(() =>
      parseWebFinger(
        { subject: 'acct:bob@mastodon.example', links: [] },
        { requireDiaspora: true },
      ),
    ).toThrow(InvalidDataError);
  });

  it('rejects incomplete documents and subject mismatches', () => {
    expect(() => parseWebFinger('{"links": []}')).toThrow(InvalidDataError);
    expect(() => parseWebFinger('{"subject": "acct:a@b.c"}')).toThrow(InvalidDataError);
    expect(() => parseWebFinger('<XRD/>')).toThrow(InvalidDocumentError);
    expect(() =>
      parseWebFinger(JSON.stringify(buildWebFinger(full)), {
        expectedDiasporaId: 'eve@pod.example.tld',
      }),
    ).toThrow(DiscoveryError);
  });

  it('builds the request URL', () => {
    expect(webFingerUrl('Alice@Example.org:3000')).toBe(
      'https://example.org:3000/.well-known/webfinger?resource=acct:alice@example.org:3000',
    );
  });
});

describe('host-meta', () => {
  it('points to the WebFinger endpoint', () => {
    const xml = buildHostMeta('https://example.org/');
    expect(xml).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">
  <Link rel="lrdd" type="application/jrd+json" template="https://example.org/.well-known/webfinger?resource={uri}"/>
</XRD>
`);
    expect(parseHostMeta(xml).webFingerTemplate).toBe(
      'https://example.org/.well-known/webfinger?resource={uri}',
    );
  });

  it('parses legacy host-meta documents', () => {
    const legacy = `<?xml version='1.0' encoding='UTF-8'?>
<XRD xmlns='http://docs.oasis-open.org/ns/xri/xrd-1.0'>
  <Link rel='lrdd' type='application/xrd+xml' template='https://old.example/webfinger?q={uri}' />
</XRD>`;
    expect(parseHostMeta(legacy).webFingerTemplate).toBe('https://old.example/webfinger?q={uri}');
    expect(parseHostMeta(buildXrd({})).webFingerTemplate).toBeUndefined();
  });
});

describe('hCard (h_card_spec)', () => {
  const keys = generateTestKeys();
  const hcard: HCard = {
    guid: GUID,
    nickname: 'alice',
    fullName: 'Alice Smith',
    firstName: 'Alice',
    lastName: 'Smith',
    publicKey: keys.publicPem,
    photoLargeUrl: `${POD}upload/large.png`,
    photoMediumUrl: `${POD}upload/medium.png`,
    photoSmallUrl: `${POD}upload/small.png`,
    searchable: true,
  };

  it('renders exactly the HTML of the gem', () => {
    expect(
      buildHCard(hcard),
    ).toBe(`<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN" "http://www.w3.org/TR/REC-html40/loose.dtd">
<html>
  <head>
    <meta charset="UTF-8"/>
    <title>Alice Smith</title>
  </head>
  <body>
    <div id="content">
      <h1>Alice Smith</h1>
      <div id="content_inner" class="entity_profile vcard author">
        <h2>User profile</h2>
        <dl class="entity_uid">
          <dt>Uid</dt>
          <dd>
            <span class="uid">${GUID}</span>
          </dd>
        </dl>
        <dl class="entity_nickname">
          <dt>Nickname</dt>
          <dd>
            <span class="nickname">alice</span>
          </dd>
        </dl>
        <dl class="entity_full_name">
          <dt>Full_name</dt>
          <dd>
            <span class="fn">Alice Smith</span>
          </dd>
        </dl>
        <dl class="entity_searchable">
          <dt>Searchable</dt>
          <dd>
            <span class="searchable">true</span>
          </dd>
        </dl>
        <dl class="entity_key">
          <dt>Key</dt>
          <dd>
            <pre class="key">${keys.publicPem}</pre>
          </dd>
        </dl>
        <dl class="entity_first_name">
          <dt>First_name</dt>
          <dd>
            <span class="given_name">Alice</span>
          </dd>
        </dl>
        <dl class="entity_family_name">
          <dt>Family_name</dt>
          <dd>
            <span class="family_name">Smith</span>
          </dd>
        </dl>
        <dl class="entity_photo">
          <dt>Photo</dt>
          <dd>
            <img class="photo avatar" width="300" height="300" src="${POD}upload/large.png"/>
          </dd>
        </dl>
        <dl class="entity_photo_medium">
          <dt>Photo_medium</dt>
          <dd>
            <img class="photo avatar" width="100" height="100" src="${POD}upload/medium.png"/>
          </dd>
        </dl>
        <dl class="entity_photo_small">
          <dt>Photo_small</dt>
          <dd>
            <img class="photo avatar" width="50" height="50" src="${POD}upload/small.png"/>
          </dd>
        </dl>
      </div>
    </div>
  </body>
</html>
`);
  });

  it('reads its own output', () => {
    expect(parseHCard(buildHCard(hcard))).toEqual(hcard);
  });

  it('escapes HTML in names and reads it back', () => {
    const tricky = { ...hcard, fullName: 'A <b>&amp</b>', firstName: 'A & B' };
    const html = buildHCard(tricky);
    expect(html).toContain('<span class="fn">A &lt;b&gt;&amp;amp&lt;/b&gt;</span>');
    expect(parseHCard(html)).toEqual(tricky);
  });

  it('parses the hCard of the protocol documentation', () => {
    expect(parseHCard(SPEC_HCARD_HTML)).toEqual({
      guid: GUID,
      fullName: 'Alice Smith',
      firstName: 'Alice',
      lastName: 'Smith',
      publicKey: SPEC_HCARD_KEY,
      photoLargeUrl: 'https://example.org/images/thumb_large_a795f872c93309597345.jpg',
      photoMediumUrl: 'https://example.org/images/thumb_medium_a795f872c93309597345.jpg',
      photoSmallUrl: 'https://example.org/images/thumb_small_a795f872c93309597345.jpg',
      searchable: true,
    });
  });

  it('treats empty searchable as false and empty names as absent', () => {
    const html = buildHCard(hcard)
      .replace('class="searchable">true<', 'class="searchable"><')
      .replace('class="fn">Alice Smith<', 'class="fn"><')
      .replace('class="given_name">Alice<', 'class="given_name"><')
      .replace('class="family_name">Smith<', 'class="family_name"><');
    const parsed = parseHCard(html);
    expect(parsed.searchable).toBe(false);
    expect(parsed.fullName).toBeUndefined();
    expect(parsed.firstName).toBeUndefined();
    expect(parsed.lastName).toBeUndefined();
  });

  it('fails if the document is incomplete or invalid', () => {
    expect(() => parseHCard('<div id="content"><span class="fn">Alice</span></div>')).toThrow(
      InvalidDataError,
    );
    expect(() => parseHCard('')).toThrow(InvalidDataError);
    expect(() => parseHCard(buildHCard({ ...hcard, publicKey: 'not a key' }))).toThrow(
      /public_key/,
    );
    expect(() => parseHCard(buildHCard({ ...hcard, guid: 'short' }))).toThrow(/guid/);
    expect(() => parseHCard(buildHCard({ ...hcard, firstName: 'semi;colon' }))).toThrow(
      /first_name/,
    );
  });
});
