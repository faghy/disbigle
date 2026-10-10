// hCard profile document: https://diaspora.github.io/diaspora_federation/discovery/hcard.html
import { parse as parseHtml } from 'node-html-parser';
import { isValidGuid } from '../entities/rules.ts';
import { InvalidDataError } from '../errors.ts';

/** Data published in (and extracted from) a diaspora* hCard. */
export interface HCard {
  guid: string;
  /** Local username. Optional. */
  nickname?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  /** PEM public key (`-----BEGIN PUBLIC KEY-----` …). */
  publicKey: string;
  /** 300x300 avatar URL. */
  photoLargeUrl: string;
  /** 100x100 avatar URL. */
  photoMediumUrl: string;
  /** 50x50 avatar URL. */
  photoSmallUrl: string;
  searchable: boolean;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function capitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function property(name: string, inner: string): string {
  return [
    `      <dl class="entity_${name}">`,
    `        <dt>${capitalize(name)}</dt>`,
    '        <dd>',
    `          ${inner}`,
    '        </dd>',
    '      </dl>',
  ].join('\n');
}

const span = (cls: string, value: string | undefined) =>
  `<span class="${cls}">${escapeHtml(value ?? '')}</span>`;

const img = (size: number, src: string) =>
  `<img class="photo avatar" width="${size}" height="${size}" src="${escapeAttr(src)}"/>`;

/**
 * Renders the hCard HTML of a local person, byte-identical to the reference implementation.
 * Serve it at `/hcard/users/:guid` with Content-Type `text/html`.
 */
export function buildHCard(hcard: HCard): string {
  const fullName = escapeHtml(hcard.fullName ?? '');
  return [
    '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN" "http://www.w3.org/TR/REC-html40/loose.dtd">',
    '<html>',
    '  <head>',
    '    <meta charset="UTF-8"/>',
    `    <title>${fullName}</title>`,
    '  </head>',
    '  <body>',
    '    <div id="content">',
    `      <h1>${fullName}</h1>`,
    '      <div id="content_inner" class="entity_profile vcard author">',
    '        <h2>User profile</h2>',
    ...[
      property('uid', span('uid', hcard.guid)),
      property('nickname', span('nickname', hcard.nickname)),
      property('full_name', span('fn', hcard.fullName)),
      property('searchable', span('searchable', String(hcard.searchable))),
      property('key', `<pre class="key">${escapeHtml(hcard.publicKey)}</pre>`),
      property('first_name', span('given_name', hcard.firstName)),
      property('family_name', span('family_name', hcard.lastName)),
      property('photo', img(300, hcard.photoLargeUrl)),
      property('photo_medium', img(100, hcard.photoMediumUrl)),
      property('photo_small', img(50, hcard.photoSmallUrl)),
    ].map((block) => block.replace(/^/gm, '  ')),
    '      </div>',
    '    </div>',
    '  </body>',
    '</html>',
    '',
  ].join('\n');
}

const NAME = (max: number) => new RegExp(`^[^;]{0,${max}}$`, 'u');

/**
 * Parses a remote hCard. Requires `.fn` and `.entity_photo .photo[src]` like the reference
 * implementation and validates GUID, names, public key and avatar URLs.
 * Throws `InvalidDataError` when the document is incomplete or invalid.
 */
export function parseHCard(html: string): HCard {
  const doc = parseHtml(html, { comment: false });
  const fn = doc.querySelector('.fn');
  const photo = doc.querySelector('.entity_photo .photo[src]');
  if (!fn || !photo) throw new InvalidDataError('hcard html incomplete');

  const content = (selector: string): string | undefined => {
    const text = doc.querySelector(selector)?.text;
    return text === undefined || text === '' ? undefined : text;
  };
  const src = (selector: string): string | undefined =>
    doc.querySelector(selector)?.getAttribute('src') || undefined;

  const result = {
    guid: content('.uid'),
    nickname: content('.nickname'),
    fullName: content('.fn'),
    firstName: content('.given_name'),
    lastName: content('.family_name'),
    publicKey: content('.key'),
    photoLargeUrl: src('.entity_photo .photo[src]'),
    photoMediumUrl: src('.entity_photo_medium .photo[src]'),
    photoSmallUrl: src('.entity_photo_small .photo[src]'),
    searchable: content('.searchable') === 'true',
  };

  const errors: string[] = [];
  if (!isValidGuid(result.guid)) errors.push('guid');
  if (result.fullName !== undefined && !NAME(70).test(result.fullName)) errors.push('full_name');
  if (result.firstName !== undefined && !NAME(32).test(result.firstName)) errors.push('first_name');
  if (result.lastName !== undefined && !NAME(32).test(result.lastName)) errors.push('last_name');
  const key = result.publicKey?.trim() ?? '';
  const pem =
    (key.startsWith('-----BEGIN PUBLIC KEY-----') && key.endsWith('-----END PUBLIC KEY-----')) ||
    (key.startsWith('-----BEGIN RSA PUBLIC KEY-----') && key.endsWith('-----END RSA PUBLIC KEY-----'));
  if (!pem) errors.push('public_key');
  if (!result.photoLargeUrl) errors.push('photo_large_url');
  if (!result.photoMediumUrl) errors.push('photo_medium_url');
  if (!result.photoSmallUrl) errors.push('photo_small_url');
  if (errors.length > 0) throw new InvalidDataError(`invalid hcard, properties: ${errors.join(', ')}`);

  const hcard: HCard = {
    guid: result.guid as string,
    publicKey: result.publicKey as string,
    photoLargeUrl: result.photoLargeUrl as string,
    photoMediumUrl: result.photoMediumUrl as string,
    photoSmallUrl: result.photoSmallUrl as string,
    searchable: result.searchable,
  };
  if (result.nickname !== undefined) hcard.nickname = result.nickname;
  if (result.fullName !== undefined) hcard.fullName = result.fullName;
  if (result.firstName !== undefined) hcard.firstName = result.firstName;
  if (result.lastName !== undefined) hcard.lastName = result.lastName;
  return hcard;
}
