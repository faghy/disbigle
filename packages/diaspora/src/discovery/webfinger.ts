// WebFinger and host-meta documents for diaspora* discovery:
// https://diaspora.github.io/diaspora_federation/discovery/webfinger.html
import { normalizeDiasporaId, parseDiasporaId } from '../diaspora-id.ts';
import { DiscoveryError, InvalidDataError } from '../errors.ts';
import {
  buildXrd,
  type JrdJson,
  parseJrd,
  parseXrd,
  toJrd,
  type XrdDocument,
  type XrdLink,
} from './xrd.ts';

export const REL_HCARD = 'http://microformats.org/profile/hcard';
export const REL_SEED = 'http://joindiaspora.com/seed_location';
export const REL_PROFILE = 'http://webfinger.net/rel/profile-page';
export const REL_ATOM = 'http://schemas.google.com/g/2010#updates-from';
export const REL_SALMON = 'salmon';
export const REL_SUBSCRIBE = 'http://ostatus.org/schema/1.0/subscribe';
export const REL_LRDD = 'lrdd';
/** Media type of WebFinger responses. */
export const JRD_CONTENT_TYPE = 'application/jrd+json';

/** Data needed to publish the diaspora* part of a local person's WebFinger document. */
export interface WebFingerInput {
  /** diaspora* ID (`alice@example.org`); the subject becomes `acct:alice@example.org`. */
  diasporaId: string;
  /** URL of the hCard (`https://example.org/hcard/users/<guid>`). Mandatory. */
  hcardUrl: string;
  /** URL of the server (`https://example.org/`). Mandatory. */
  seedUrl: string;
  /** Profile page URL (optional, sent by diaspora* pods). */
  profileUrl?: string;
  /** Atom feed URL (optional, legacy). */
  atomUrl?: string;
  /** Private receive URL (`https://example.org/receive/users/<guid>`), published as `salmon`. */
  salmonUrl?: string;
  /** Remote follow template, e.g. `https://example.org/people?q={uri}`. */
  subscribeUrl?: string;
  aliases?: string[];
  properties?: Record<string, string | null>;
  /** Extra links appended after the diaspora* ones (e.g. the ActivityPub `self` link). */
  links?: XrdLink[];
}

/**
 * Builds the WebFinger JRD object for a local person. Links are in the order used by
 * diaspora* pods: hcard, seed_location, profile-page, atom, salmon, subscribe, then extras.
 * Serve it with `JSON.stringify` and Content-Type `application/jrd+json`.
 */
export function buildWebFinger(input: WebFingerInput): JrdJson {
  const links: XrdLink[] = [
    { rel: REL_HCARD, type: 'text/html', href: input.hcardUrl },
    { rel: REL_SEED, type: 'text/html', href: input.seedUrl },
  ];
  if (input.profileUrl) links.push({ rel: REL_PROFILE, type: 'text/html', href: input.profileUrl });
  if (input.atomUrl) links.push({ rel: REL_ATOM, type: 'application/atom+xml', href: input.atomUrl });
  if (input.salmonUrl) links.push({ rel: REL_SALMON, href: input.salmonUrl });
  if (input.subscribeUrl) links.push({ rel: REL_SUBSCRIBE, template: input.subscribeUrl });
  links.push(...(input.links ?? []));
  const doc: XrdDocument = {
    subject: `acct:${parseDiasporaId(input.diasporaId).id}`,
    links,
  };
  if (input.aliases) doc.aliases = input.aliases;
  if (input.properties) doc.properties = input.properties;
  return toJrd(doc);
}

/** diaspora*-relevant data extracted from a remote WebFinger document. */
export interface WebFingerInfo {
  /** The `subject` as received. */
  subject: string;
  /** The subject normalised to a diaspora* ID (without `acct:`, lowercase). */
  diasporaId: string;
  /** hCard URL; absent for accounts that do not speak diaspora*. */
  hcardUrl?: string;
  /** Server URL (seed_location); absent for accounts that do not speak diaspora*. */
  seedUrl?: string;
  profileUrl?: string;
  atomUrl?: string;
  salmonUrl?: string;
  subscribeUrl?: string;
  aliases: string[];
  properties: Record<string, string | null>;
  /** All links of the document, including non-diaspora ones (e.g. ActivityPub `self`). */
  links: XrdLink[];
}

/** True if the WebFinger document has the links that diaspora* requires (hcard and seed). */
export function isDiasporaWebFinger(info: WebFingerInfo): boolean {
  return info.hcardUrl !== undefined && info.seedUrl !== undefined;
}

export interface ParseWebFingerOptions {
  /** If set, the subject must match this diaspora* ID (as the reference discovery requires). */
  expectedDiasporaId?: string;
  /** If true, missing hcard/seed links raise `InvalidDataError`. */
  requireDiaspora?: boolean;
}

/** Parses a WebFinger JRD (string or object). Throws `InvalidDocumentError` / `InvalidDataError` / `DiscoveryError`. */
export function parseWebFinger(
  input: string | object,
  options: ParseWebFingerOptions = {},
): WebFingerInfo {
  const doc = parseJrd(input);
  if (doc.subject === undefined || doc.links === undefined) {
    throw new InvalidDataError('Webfinger JSON is incomplete');
  }
  const links = doc.links;
  const find = (rel: string) => links.find((l) => l.rel === rel);
  const diasporaId = normalizeDiasporaId(doc.subject);
  if (
    options.expectedDiasporaId !== undefined &&
    normalizeDiasporaId(options.expectedDiasporaId) !== diasporaId
  ) {
    throw new DiscoveryError(
      `diaspora* ID does not match: Wanted ${normalizeDiasporaId(options.expectedDiasporaId)} but got ${diasporaId}`,
    );
  }
  const info: WebFingerInfo = {
    subject: doc.subject,
    diasporaId,
    aliases: doc.aliases ?? [],
    properties: doc.properties ?? {},
    links,
  };
  const assign = (key: keyof WebFingerInfo, value: string | undefined) => {
    if (value !== undefined) (info as unknown as Record<string, unknown>)[key] = value;
  };
  assign('hcardUrl', find(REL_HCARD)?.href);
  assign('seedUrl', find(REL_SEED)?.href);
  assign('profileUrl', find(REL_PROFILE)?.href);
  assign('atomUrl', find(REL_ATOM)?.href);
  assign('salmonUrl', find(REL_SALMON)?.href);
  assign('subscribeUrl', find(REL_SUBSCRIBE)?.template);
  if (options.requireDiaspora && !isDiasporaWebFinger(info)) {
    throw new InvalidDataError('WebFinger has no hcard or seed_location link');
  }
  return info;
}

/** URL of the WebFinger request for a diaspora* ID (`https://host/.well-known/webfinger?resource=acct:…`). */
export function webFingerUrl(diasporaId: string, scheme: 'https' | 'http' = 'https'): string {
  const id = parseDiasporaId(diasporaId);
  return `${scheme}://${id.host}/.well-known/webfinger?resource=acct:${id.id}`;
}

/**
 * Builds `/.well-known/host-meta` (XRD) pointing at the WebFinger endpoint through an `lrdd`
 * template. `baseUrl` is the server URL, e.g. `https://example.org`.
 */
export function buildHostMeta(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return buildXrd({
    links: [
      {
        rel: REL_LRDD,
        type: JRD_CONTENT_TYPE,
        template: `${base}/.well-known/webfinger?resource={uri}`,
      },
    ],
  });
}

/** Parses a host-meta XRD and returns the `lrdd` template, if any, plus the whole document. */
export function parseHostMeta(xml: string): { webFingerTemplate?: string; document: XrdDocument } {
  const document = parseXrd(xml);
  const lrdd = (document.links ?? []).filter((l) => l.rel === REL_LRDD && l.template);
  const preferred = lrdd.find((l) => l.type === JRD_CONTENT_TYPE || l.type === undefined) ?? lrdd[0];
  return preferred?.template ? { webFingerTemplate: preferred.template, document } : { document };
}
