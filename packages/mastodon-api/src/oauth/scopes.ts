/** Scopes an application may request (Mastodon's list, including granular scopes). */
const GRANULAR = {
  read: [
    'accounts',
    'blocks',
    'bookmarks',
    'favourites',
    'filters',
    'follows',
    'lists',
    'mutes',
    'notifications',
    'search',
    'statuses',
  ],
  write: [
    'accounts',
    'blocks',
    'bookmarks',
    'conversations',
    'favourites',
    'filters',
    'follows',
    'lists',
    'media',
    'mutes',
    'notifications',
    'reports',
    'statuses',
  ],
} as const;

export const TOP_LEVEL_SCOPES = ['read', 'write', 'follow', 'push', 'profile'] as const;

/** Scopes we accept at registration and authorization. `admin:*` is accepted but grants nothing. */
export function isKnownScope(scope: string): boolean {
  if ((TOP_LEVEL_SCOPES as readonly string[]).includes(scope)) return true;
  const [family, sub, ...rest] = scope.split(':');
  if (family === 'read' || family === 'write') {
    return rest.length === 0 && (GRANULAR[family] as readonly string[]).includes(sub ?? '');
  }
  if (family === 'admin') {
    return (sub === 'read' || sub === 'write') && rest.length <= 1;
  }
  return false;
}

export function supportedScopes(): string[] {
  return [
    ...TOP_LEVEL_SCOPES,
    ...GRANULAR.read.map((s) => `read:${s}`),
    ...GRANULAR.write.map((s) => `write:${s}`),
  ];
}

/** Splits a scope string (`"read write follow"`, also `+`-separated) into a de-duplicated list. */
export function parseScopes(value: string | undefined, fallback: string[] = ['read']): string[] {
  const parts = (value ?? '')
    .split(/[\s+]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length === 0 ? [...fallback] : [...new Set(parts)];
}

/** Legacy `follow` scope: what it covers among the granular scopes. */
const FOLLOW_COVERS = new Set([
  'read:follows',
  'write:follows',
  'read:blocks',
  'write:blocks',
  'read:mutes',
  'write:mutes',
]);

/**
 * Whether the granted scopes allow `required`. `read` covers every `read:*`, `write` every
 * `write:*`, `follow` the follow/block/mute scopes. `required` may be a top-level scope too.
 */
export function scopeAllows(granted: readonly string[], required: string): boolean {
  if (granted.includes(required)) return true;
  const [family] = required.split(':');
  if (family && family !== required && granted.includes(family)) return true;
  if (granted.includes('follow') && FOLLOW_COVERS.has(required)) return true;
  return false;
}

/** True when every requested scope is part of what the application registered for. */
export function scopesWithin(requested: readonly string[], registered: readonly string[]) {
  return requested.every((scope) => scopeAllows(registered, scope));
}
