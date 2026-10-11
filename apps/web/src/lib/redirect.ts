/**
 * Where to go after signing in, for example `/oauth/authorize?...` when a third-party app
 * asked to connect. Only paths on this site are accepted: they must start with a single `/`
 * (never `//` or `/\`, which browsers treat as another host) and resolve to this origin.
 */
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.length === 0 || value.length > 2048) return undefined;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return undefined;
  // Control characters (tabs, newlines) are stripped by URL parsers and can hide a host.
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return undefined;
  }
  try {
    const base = 'https://disbigle.invalid';
    const url = new URL(value, base);
    if (url.origin !== base) return undefined;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}

/**
 * Leaves the single-page app for a page the server renders (such as the OAuth consent page).
 * Kept in an object so tests can replace it.
 */
export const fullNavigation = {
  assign(target: string) {
    window.location.assign(target);
  },
};
