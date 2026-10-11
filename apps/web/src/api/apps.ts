import type { AuthorizedApp } from '@disbigle/shared';
import { api } from './client.ts';

export type { AuthorizedApp };

export const appKeys = { all: ['authorizedApps'] as const };

export const authorizedApps = {
  list: () => api.get<AuthorizedApp[]>('/me/apps'),
  revoke: (id: string) => api.delete<{ status: 'ok' }>(`/me/apps/${encodeURIComponent(id)}`),
};

export interface ScopeGroup {
  /** `read`, `write`, `follow`, `push`, `admin`… */
  name: string;
  /** True when the app has the whole group (`read`), false for only parts (`read:statuses`). */
  full: boolean;
  parts: string[];
}

/** Collapses granular scopes into their top-level group: `read:statuses` → `read` (partial). */
export function groupScopes(scopes: string[]): ScopeGroup[] {
  const groups = new Map<string, ScopeGroup>();
  for (const scope of scopes) {
    const [name = scope, part] = scope.split(':');
    const group = groups.get(name) ?? { name, full: false, parts: [] };
    if (part === undefined) group.full = true;
    else group.parts.push(part);
    groups.set(name, group);
  }
  const order = ['read', 'write', 'follow', 'push', 'admin'];
  return [...groups.values()].sort(
    (a, b) =>
      (order.indexOf(a.name) + 1 || 99) - (order.indexOf(b.name) + 1 || 99) ||
      a.name.localeCompare(b.name),
  );
}
