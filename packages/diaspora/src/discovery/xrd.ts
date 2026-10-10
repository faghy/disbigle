// XRD (XML) and JRD (JSON) resource descriptors, as in the reference XrdDocument.
import { InvalidDocumentError, InvalidXmlError } from '../errors.ts';
import {
  elementChildren,
  localName,
  parseXml,
  serializeXml,
  textContent,
  type XmlNode,
} from '../xml.ts';

export const XRD_XMLNS = 'http://docs.oasis-open.org/ns/xri/xrd-1.0';

/** A descriptor link; attribute order on output is rel, type, href, template. */
export interface XrdLink {
  rel?: string;
  type?: string;
  href?: string;
  template?: string;
}

/** A resource descriptor (WebFinger JRD or host-meta XRD). */
export interface XrdDocument {
  subject?: string;
  expires?: Date;
  aliases?: string[];
  properties?: Record<string, string | null>;
  links?: XrdLink[];
}

/** The JSON shape of a JRD document. */
export interface JrdJson {
  subject?: string;
  expires?: string;
  aliases?: string[];
  properties?: Record<string, string | null>;
  links?: XrdLink[];
}

const LINK_ATTRS = ['rel', 'type', 'href', 'template'] as const;

function formatExpires(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function cleanLink(link: Record<string, unknown>): XrdLink {
  const result: XrdLink = {};
  for (const attr of LINK_ATTRS) {
    const value = link[attr];
    if (typeof value === 'string') result[attr] = value;
  }
  return result;
}

/** Serialises an XRD document (with XML declaration), formatted like the reference implementation. */
export function buildXrd(doc: XrdDocument): string {
  const children: XmlNode[] = [];
  if (doc.expires) children.push({ name: 'Expires', text: formatExpires(doc.expires) });
  if (doc.subject) children.push({ name: 'Subject', text: doc.subject });
  for (const alias of doc.aliases ?? []) if (alias) children.push({ name: 'Alias', text: alias });
  for (const [type, value] of Object.entries(doc.properties ?? {})) {
    children.push({ name: 'Property', attributes: [['type', type]], text: value ?? '' });
  }
  for (const link of doc.links ?? []) {
    const attributes = LINK_ATTRS.filter((a) => link[a] !== undefined).map(
      (a) => [a, link[a] as string] as const,
    );
    children.push({ name: 'Link', attributes });
  }
  const xrd: XmlNode = { name: 'XRD', attributes: [['xmlns', XRD_XMLNS]], children };
  const body = children.length > 0 ? serializeXml(xrd) : `<XRD xmlns="${XRD_XMLNS}">\n</XRD>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`;
}

/** Parses an XRD document. Throws `InvalidDocumentError` if it is not XRD. */
export function parseXrd(xml: string): XrdDocument {
  let root: ReturnType<typeof parseXml>;
  try {
    root = parseXml(xml);
  } catch (error) {
    if (error instanceof InvalidXmlError) {
      throw new InvalidDocumentError('Not an XRD document', { cause: error });
    }
    throw error;
  }
  if (localName(root) !== 'XRD') throw new InvalidDocumentError('Not an XRD document');
  const doc: XrdDocument = {};
  const aliases: string[] = [];
  const properties: Record<string, string | null> = {};
  const links: XrdLink[] = [];
  for (const child of elementChildren(root)) {
    switch (localName(child)) {
      case 'Expires': {
        const date = new Date(textContent(child).trim());
        if (!Number.isNaN(date.getTime())) doc.expires = date;
        break;
      }
      case 'Subject':
        doc.subject = textContent(child);
        break;
      case 'Alias':
        aliases.push(textContent(child));
        break;
      case 'Property':
        properties[child.getAttribute('type') ?? ''] =
          child.firstChild === null ? null : textContent(child);
        break;
      case 'Link': {
        const link: XrdLink = {};
        for (const attr of LINK_ATTRS) {
          if (child.hasAttribute(attr)) link[attr] = child.getAttribute(attr) ?? '';
        }
        links.push(link);
        break;
      }
      default:
        break;
    }
  }
  if (aliases.length > 0) doc.aliases = aliases;
  if (Object.keys(properties).length > 0) doc.properties = properties;
  if (links.length > 0) doc.links = links;
  return doc;
}

/** Converts a descriptor to its JRD JSON object (keys in the reference order, empty parts omitted). */
export function toJrd(doc: XrdDocument): JrdJson {
  const json: JrdJson = {};
  if (doc.subject !== undefined) json.subject = doc.subject;
  if (doc.expires) json.expires = formatExpires(doc.expires);
  if (doc.aliases && doc.aliases.length > 0) json.aliases = doc.aliases;
  if (doc.properties && Object.keys(doc.properties).length > 0) json.properties = doc.properties;
  if (doc.links && doc.links.length > 0) json.links = doc.links.map((l) => cleanLink({ ...l }));
  return json;
}

/** Parses a JRD document (JSON string or object). Throws `InvalidDocumentError`. */
export function parseJrd(input: string | object): XrdDocument {
  let json: unknown;
  try {
    json = typeof input === 'string' ? JSON.parse(input) : input;
  } catch (error) {
    throw new InvalidDocumentError(
      `Not a JRD document: ${error instanceof Error ? error.message.slice(0, 256) : ''}`,
      { cause: error },
    );
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new InvalidDocumentError('Not a JRD document');
  }
  const obj = json as Record<string, unknown>;
  const doc: XrdDocument = {};
  if (typeof obj.subject === 'string') doc.subject = obj.subject;
  if (typeof obj.expires === 'string') {
    const date = new Date(obj.expires);
    if (!Number.isNaN(date.getTime())) doc.expires = date;
  }
  if (Array.isArray(obj.aliases)) {
    doc.aliases = obj.aliases.filter((a): a is string => typeof a === 'string');
  }
  if (typeof obj.properties === 'object' && obj.properties !== null) {
    doc.properties = obj.properties as Record<string, string | null>;
  }
  if (Array.isArray(obj.links)) {
    doc.links = obj.links
      .filter((l): l is Record<string, unknown> => typeof l === 'object' && l !== null)
      .map(cleanLink);
  }
  return doc;
}
