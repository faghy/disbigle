// Minimal XML toolkit: parsing via @xmldom/xmldom and a serializer reproducing the
// formatting of Nokogiri/libxml2 (two-space indentation, self-closed empty elements).
import { DOMParser, type Element, type Node } from '@xmldom/xmldom';
import { InvalidXmlError } from './errors.ts';

const ELEMENT_NODE = 1;

/** Characters not allowed in XML 1.0 documents; replaced with U+FFFD before serialising. */
const INVALID_XML_CHARS = new RegExp(
  '[^\\t\\n\\r\\u0020-\\uD7FF\\uE000-\\uFFFD\\u{10000}-\\u{10FFFF}]',
  'gu',
);

/** Replaces characters that are invalid in XML with U+FFFD, like the reference implementation. */
export function replaceInvalidXmlChars(value: string): string {
  return value.replace(INVALID_XML_CHARS, '�');
}

/** Escapes element text the way libxml2 does. */
export function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#13;');
}

/** Escapes an attribute value (double-quoted). */
export function escapeAttribute(value: string): string {
  return escapeText(value)
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '&#10;')
    .replace(/\t/g, '&#9;');
}

/** A node of the serialisation tree: either text content or child elements. */
export interface XmlNode {
  name: string;
  attributes?: ReadonlyArray<readonly [string, string]>;
  text?: string;
  children?: XmlNode[];
}

/** Serialises a node tree with Nokogiri-compatible pretty printing (no XML declaration). */
export function serializeXml(node: XmlNode, indent = 0): string {
  const pad = ' '.repeat(indent);
  const attrs = (node.attributes ?? []).map(([k, v]) => ` ${k}="${escapeAttribute(v)}"`).join('');
  if (node.children && node.children.length > 0) {
    const inner = node.children.map((child) => serializeXml(child, indent + 2)).join('\n');
    return `${pad}<${node.name}${attrs}>\n${inner}\n${pad}</${node.name}>`;
  }
  if (node.text !== undefined && node.text !== '') {
    return `${pad}<${node.name}${attrs}>${escapeText(node.text)}</${node.name}>`;
  }
  return `${pad}<${node.name}${attrs}/>`;
}

/** Parses an XML document and returns its root element; throws `InvalidXmlError` on bad input. */
export function parseXml(xml: string): Element {
  let doc: ReturnType<DOMParser['parseFromString']>;
  try {
    doc = new DOMParser({
      onError: (level, msg) => {
        if (level !== 'warning') throw new InvalidXmlError(msg);
      },
    }).parseFromString(xml, 'text/xml');
  } catch (error) {
    if (error instanceof InvalidXmlError) throw error;
    throw new InvalidXmlError(error instanceof Error ? error.message : String(error), {
      cause: error,
    });
  }
  const root = doc.documentElement;
  if (!root) throw new InvalidXmlError('document has no root element');
  return root;
}

/** Element children of `node`, in document order. */
export function elementChildren(node: Element): Element[] {
  const result: Element[] = [];
  for (let child: Node | null = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === ELEMENT_NODE) result.push(child as Element);
  }
  return result;
}

/** Local name of an element (without namespace prefix). */
export function localName(element: Element): string {
  return element.localName ?? element.nodeName.replace(/^.*:/, '');
}

/** Concatenated text content of an element and its descendants. */
export function textContent(element: Element): string {
  return element.textContent ?? '';
}

/** True if the element has any child node (text or element), like Nokogiri's `children.any?`. */
export function hasChildNodes(element: Element): boolean {
  return element.firstChild !== null;
}

/** First child element with the given local name. */
export function childByLocalName(element: Element, name: string): Element | undefined {
  return elementChildren(element).find((child) => localName(child) === name);
}
