import { Marked, type TokenizerAndRendererExtension } from 'marked';
import sanitizeHtml from 'sanitize-html';

/** `@user` or `@user@domain`, not preceded by a word character (so emails don't match). */
const MENTION_RE =
  /(?<![\w/@])@([a-zA-Z0-9_]{1,30})(?:@([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+(?::\d{1,5})?|localhost(?::\d{1,5})?))?/g;
/** `#tag`: letters, digits and underscores, at least one non-digit. */
const TAG_RE = /(?<![\w/&#])#([\p{L}\p{N}_]*[\p{L}_][\p{L}\p{N}_]*)/gu;

export interface ParsedMention {
  username: string;
  domain: string | null;
  /** The text as written, e.g. `@alice@example.org`. */
  text: string;
}

export function extractMentions(source: string): ParsedMention[] {
  const seen = new Map<string, ParsedMention>();
  for (const match of stripCode(source).matchAll(MENTION_RE)) {
    const username = match[1] ?? '';
    const domain = match[2]?.toLowerCase() ?? null;
    const key = `${username.toLowerCase()}@${domain ?? ''}`;
    if (!seen.has(key)) seen.set(key, { username, domain, text: match[0] });
  }
  return [...seen.values()];
}

export function extractTags(source: string): string[] {
  const tags = new Set<string>();
  for (const match of stripCode(source).matchAll(TAG_RE)) {
    const name = (match[1] ?? '').toLowerCase();
    if (name.length <= 100) tags.add(name);
  }
  return [...tags];
}

/** Removes fenced and inline code so mentions and tags inside code are ignored. */
function stripCode(source: string): string {
  return source.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
}

export interface RenderOptions {
  /** Resolves a mention to the profile URL of a known account; unresolved mentions stay plain text. */
  resolveMention: (username: string, domain: string | null) => string | null;
  tagUrl: (tag: string) => string;
}

const allowedTags = [
  'p',
  'br',
  'a',
  'span',
  'strong',
  'em',
  'del',
  's',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'sub',
  'sup',
];

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Renders post markdown (the format diaspora uses) to sanitised HTML.
 * Raw HTML in the source is escaped; images are not allowed inline (media are attachments).
 */
export function renderMarkdown(source: string, options: RenderOptions): string {
  const mention: TokenizerAndRendererExtension = {
    name: 'mention',
    level: 'inline',
    start: (src) => src.match(/(?<![\w/@])@[a-zA-Z0-9_]/)?.index,
    tokenizer(src) {
      const match =
        /^@([a-zA-Z0-9_]{1,30})(?:@([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+(?::\d{1,5})?|localhost(?::\d{1,5})?))?/.exec(
          src,
        );
      if (!match) return undefined;
      return { type: 'mention', raw: match[0], username: match[1], domain: match[2] ?? null };
    },
    renderer(token) {
      const url = options.resolveMention(token.username, token.domain);
      const text = escapeHtml(token.raw);
      return url
        ? `<span class="h-card"><a href="${escapeHtml(url)}" class="u-url mention">${text}</a></span>`
        : text;
    },
  };
  const hashtag: TokenizerAndRendererExtension = {
    name: 'hashtag',
    level: 'inline',
    start: (src) => src.match(/(?<![\w/&#])#[\p{L}\p{N}_]/u)?.index,
    tokenizer(src) {
      const match = /^#([\p{L}\p{N}_]*[\p{L}_][\p{L}\p{N}_]*)/u.exec(src);
      if (!match) return undefined;
      return { type: 'hashtag', raw: match[0], tag: match[1] };
    },
    renderer(token) {
      const url = options.tagUrl(String(token.tag).toLowerCase());
      return `<a href="${escapeHtml(url)}" class="mention hashtag" rel="tag">#<span>${escapeHtml(token.tag)}</span></a>`;
    },
  };

  const marked = new Marked({ gfm: true, breaks: true, async: false });
  marked.use({
    extensions: [mention, hashtag],
    renderer: {
      html: ({ text }) => escapeHtml(text),
      image: ({ href, text }) => `<a href="${escapeHtml(href)}">${escapeHtml(text || href)}</a>`,
    },
  });
  const html = marked.parse(source) as string;

  return sanitizeHtml(html, {
    allowedTags,
    allowedAttributes: { a: ['href', 'rel', 'class', 'target'], span: ['class'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedClasses: { a: ['mention', 'hashtag', 'u-url'], span: ['h-card'] },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          rel: attribs.rel === 'tag' ? 'tag' : 'nofollow noopener noreferrer',
          target: '_blank',
        },
      }),
    },
  }).trim();
}

/** Sanitises HTML received from other servers before storing it. */
export function sanitizeRemoteHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags,
    allowedAttributes: { a: ['href', 'rel', 'class'], span: ['class'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedClasses: {
      a: ['mention', 'hashtag', 'u-url'],
      span: ['h-card', 'invisible', 'ellipsis'],
    },
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', {
        rel: 'nofollow noopener noreferrer',
        target: '_blank',
      }),
    },
  });
}
