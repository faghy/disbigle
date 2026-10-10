// Text conversions between Disbigle markdown and diaspora* markdown.
// diaspora* writes mentions as `@{Name; user@host}` (or `@{user@host}`); Disbigle as `@user@host`.

/** diaspora* mention syntax: `@{Name; id}` or `@{id}`. */
const DIASPORA_MENTION = /@\{(?:([^}]*?);\s*)?([^}\s;]+@[^}\s;]+)\s*\}/g;

/** Disbigle mention syntax, as in the core's renderer. */
const LOCAL_MENTION =
  /(?<![\w/@])@([a-zA-Z0-9_]{1,30})(?:@([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+(?::\d{1,5})?|localhost(?::\d{1,5})?))?/g;

export interface DiasporaMention {
  /** Display name, if given. */
  name: string | undefined;
  /** diaspora* ID, lowercased. */
  id: string;
}

/** Lists the mentions of a diaspora* text. */
export function parseDiasporaMentions(text: string): DiasporaMention[] {
  const seen = new Map<string, DiasporaMention>();
  for (const match of text.matchAll(DIASPORA_MENTION)) {
    const id = (match[2] ?? '').toLowerCase();
    if (!seen.has(id)) seen.set(id, { name: match[1]?.trim() || undefined, id });
  }
  return [...seen.values()];
}

const escapeMarkdownText = (text: string) => text.replace(/([\\[\]])/g, '\\$1');

/**
 * Rewrites diaspora* mentions for the core markdown renderer: known people become links to
 * their profile, unknown ones plain `@Name` text.
 */
export function diasporaMentionsToMarkdown(
  text: string,
  profileUrl: (id: string) => string | null,
): string {
  return text.replace(DIASPORA_MENTION, (_match, name: string | undefined, rawId: string) => {
    const id = rawId.toLowerCase();
    const label = `@${escapeMarkdownText(name?.trim() || id)}`;
    const url = profileUrl(id);
    return url ? `[${label}](${url})` : label;
  });
}

/**
 * Rewrites Disbigle mentions (`@user`, `@user@host`) into diaspora* mentions (`@{user@host}`).
 * `resolve` maps `username`/`domain` (domain null for local) to a diaspora* ID; mentions it
 * cannot resolve are left unchanged.
 */
export function mentionsToDiaspora(
  text: string,
  resolve: (username: string, domain: string | null) => string | null,
): string {
  // Leave code untouched, like the core renderer does.
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(LOCAL_MENTION, (match, username: string, domain: string | undefined) => {
            const id = resolve(username, domain?.toLowerCase() ?? null);
            return id ? `@{${id}}` : match;
          }),
    )
    .join('');
}

/** Very small HTML → text conversion, for posts that have no markdown source (e.g. received over ActivityPub). */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

/** Guesses the MIME type of a diaspora* photo from its file name (diaspora* does not send it). */
export function mimeTypeFromName(name: string): string {
  const extension = /\.([a-z0-9]+)(?:\?.*)?$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? 'image/jpeg';
}

/** Turns a UUID (or any id) into a 32-character hex GUID valid for diaspora*. */
export function guidFromId(id: string): string {
  const hex = id.replace(/[^0-9a-f]/gi, '').toLowerCase();
  return hex.length >= 16 ? hex : hex.padEnd(16, '0');
}
