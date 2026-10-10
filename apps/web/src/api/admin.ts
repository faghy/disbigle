import type { Account, CurrentUser } from '@disbigle/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, queryString } from './client.ts';
import type { ReportCategory } from './social.ts';

/** Response shapes of `/api/v1/admin/*` (see `packages/core/src/moderation.ts`). */
export type Role = CurrentUser['role'];

export interface ModerationSummary {
  pendingUsers: number;
  openReports: number;
}

export interface PendingUser {
  userId: string;
  email: string;
  reason: string;
  createdAt: string;
  account: Account;
}

export interface AdminAccount {
  account: Account;
  domain: string | null;
  suspended: boolean;
  user: {
    id: string;
    email: string;
    role: Role;
    approved: boolean;
    lastSignInAt: string | null;
  } | null;
}

export interface AdminAccountFilter {
  q?: string | undefined;
  origin?: 'local' | 'remote' | undefined;
  status?: 'active' | 'suspended' | undefined;
}

export interface Report {
  id: string;
  category: ReportCategory;
  comment: string;
  statusIds: string[];
  createdAt: string;
  resolvedAt: string | null;
  reporter: Account | null;
  target: Account | null;
}

export type DomainBlockSeverity = 'silence' | 'suspend';

export interface DomainBlock {
  id: string;
  domain: string;
  severity: DomainBlockSeverity;
  publicComment: string;
  privateComment: string;
  createdAt: string;
}

export interface DomainBlockRequest {
  domain: string;
  severity: DomainBlockSeverity;
  publicComment: string;
  privateComment: string;
}

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
