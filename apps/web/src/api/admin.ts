import type {
  AdminAccount,
  CurrentUser,
  DomainBlock,
  InstanceSettings,
  KnownInstance,
  PendingUser,
  Report,
} from '@disbigle/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, queryString } from './client.ts';

/** Response shapes of `/api/v1/admin/*` (see `packages/core/src/moderation.ts`). */
export type Role = CurrentUser['role'];

export interface ModerationSummary {
  pendingUsers: number;
  openReports: number;
}

export interface AdminAccountFilter {
  q?: string | undefined;
  origin?: 'local' | 'remote' | undefined;
  status?: 'active' | 'suspended' | undefined;
}

// Shapes come from the shared package; they are re-exported for the admin pages.
export type { AdminAccount, DomainBlock, InstanceSettings, KnownInstance, PendingUser, Report };
export type DomainBlockSeverity = DomainBlock['severity'];

export interface DomainBlockRequest {
  domain: string;
  severity: DomainBlockSeverity;
  publicComment: string;
  privateComment: string;
}

export type RegistrationMode = InstanceSettings['registrationMode'];

type Ok = { status: 'ok' };
const id = (value: string) => encodeURIComponent(value);

export const admin = {
  summary: () => api.get<ModerationSummary>('/admin/summary'),
  pending: () => api.get<PendingUser[]>('/admin/pending'),
  approve: (userId: string) => api.post<Ok>(`/admin/pending/${id(userId)}/approve`),
  reject: (userId: string) => api.post<Ok>(`/admin/pending/${id(userId)}/reject`),
  accounts: (filter: AdminAccountFilter) =>
    api.get<AdminAccount[]>(`/admin/accounts${queryString({ ...filter })}`),
  suspend: (actorId: string, reason: string) =>
    api.post<Ok>(`/admin/accounts/${id(actorId)}/suspend`, { reason }),
  unsuspend: (actorId: string) => api.post<Ok>(`/admin/accounts/${id(actorId)}/unsuspend`),
  setRole: (userId: string, role: Role) =>
    api.post<Ok>(`/admin/users/${id(userId)}/role`, { role }),
  reports: (resolved: boolean) =>
    api.get<Report[]>(`/admin/reports${queryString({ resolved: resolved ? 'true' : 'false' })}`),
  resolveReport: (reportId: string) => api.post<Ok>(`/admin/reports/${id(reportId)}/resolve`),
  instances: (q?: string) =>
    api.get<KnownInstance[]>(`/admin/instances${queryString({ q: q || undefined })}`),
  settings: () => api.get<InstanceSettings>('/admin/settings'),
  updateSettings: (patch: Partial<InstanceSettings>) =>
    api.put<InstanceSettings>('/admin/settings', patch),
  domainBlocks: () => api.get<DomainBlock[]>('/admin/domain_blocks'),
  blockDomain: (body: DomainBlockRequest) => api.post<Ok>('/admin/domain_blocks', body),
  unblockDomain: (domain: string) => api.delete<Ok>(`/admin/domain_blocks/${id(domain)}`),
};

export const adminKeys = {
  all: ['admin'] as const,
  summary: ['admin', 'summary'] as const,
  pending: ['admin', 'pending'] as const,
  reports: (resolved: boolean) => ['admin', 'reports', resolved] as const,
  accounts: (filter: AdminAccountFilter) => ['admin', 'accounts', filter] as const,
  domainBlocks: ['admin', 'domainBlocks'] as const,
  settings: ['admin', 'settings'] as const,
  instances: (q: string) => ['admin', 'instances', q] as const,
};

export const summaryQueryOptions = queryOptions({
  queryKey: adminKeys.summary,
  queryFn: admin.summary,
  refetchInterval: 60_000,
  staleTime: 30_000,
});

export const isModerator = (user: CurrentUser | null | undefined) =>
  user?.role === 'moderator' || user?.role === 'admin';
export const isAdmin = (user: CurrentUser | null | undefined) => user?.role === 'admin';
