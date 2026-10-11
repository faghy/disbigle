import { api } from './client.ts';

export interface Invite {
  id: string;
  code: string;
  url: string;
  /** `null` means unlimited. */
  maxUses: number | null;
  uses: number;
  /** `null` means it never expires. */
  expiresAt: string | null;
  createdAt: string;
}

export interface InviteRequest {
  maxUses: number | null;
  expiresIn: number | null;
}

export const inviteKeys = { all: ['invites'] as const };

export const invites = {
  list: () => api.get<Invite[]>('/invites'),
  create: (body: InviteRequest) => api.post<Invite>('/invites', body),
  remove: (id: string) => api.delete<{ status: 'ok' }>(`/invites/${encodeURIComponent(id)}`),
};

/** Still usable: not expired and not used up. */
export function inviteActive(invite: Invite, now = Date.now()): boolean {
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() <= now) return false;
  return invite.maxUses === null || invite.uses < invite.maxUses;
}
