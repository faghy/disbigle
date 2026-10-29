import type {
  CreateGroupRequest,
  Group,
  GroupMember,
  GroupMemberState,
  GroupRole,
  Status,
  UpdateGroupRequest,
} from '@disbigle/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, queryString } from './client.ts';
import type { PageParams } from './social.ts';

type Ok = { status: 'ok' };
export type GroupScope = 'mine' | 'invited' | 'requested' | 'discover';

const id = (value: string) => encodeURIComponent(value);

export const groups = {
  list: (scope: GroupScope, q?: string) => api.get<Group[]>(`/groups${queryString({ scope, q })}`),
  create: (body: CreateGroupRequest) => api.post<Group>('/groups', body),
  get: (idOrHandle: string) => api.get<Group>(`/groups/${id(idOrHandle)}`),
  update: (groupId: string, body: UpdateGroupRequest) =>
    api.patch<Group>(`/groups/${id(groupId)}`, body),
  remove: (groupId: string) => api.delete<Ok>(`/groups/${id(groupId)}`),
  timeline: (groupId: string, page: PageParams) =>
    api.get<Status[]>(`/groups/${id(groupId)}/timeline${queryString({ ...page })}`),
  join: (groupId: string) => api.post<Group>(`/groups/${id(groupId)}/join`),
  leave: (groupId: string) => api.post<Group | Ok>(`/groups/${id(groupId)}/leave`),
  members: (groupId: string, state: GroupMemberState = 'member') =>
    api.get<GroupMember[]>(`/groups/${id(groupId)}/members${queryString({ state })}`),
  approve: (groupId: string, accountId: string) =>
    api.post<Ok>(`/groups/${id(groupId)}/members/${id(accountId)}/approve`),
  reject: (groupId: string, accountId: string) =>
    api.post<Ok>(`/groups/${id(groupId)}/members/${id(accountId)}/reject`),
  invite: (groupId: string, accountId: string) =>
    api.post<Ok>(`/groups/${id(groupId)}/members/${id(accountId)}/invite`),
  setRole: (groupId: string, accountId: string, role: GroupRole) =>
    api.patch<Ok>(`/groups/${id(groupId)}/members/${id(accountId)}`, { role }),
  removeMember: (groupId: string, accountId: string) =>
    api.delete<Ok>(`/groups/${id(groupId)}/members/${id(accountId)}`),
  uploadImage: (groupId: string, kind: 'avatar' | 'header', file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.upload<Group>(`/groups/${id(groupId)}/${kind}`, form);
  },
  removeImage: (groupId: string, kind: 'avatar' | 'header') =>
    api.delete<Group>(`/groups/${id(groupId)}/${kind}`),
};

export const groupKeys = {
  all: ['groups'] as const,
  list: (scope: GroupScope, q = '') => ['groups', 'list', scope, q] as const,
  group: (idOrHandle: string) => ['groups', 'group', idOrHandle.toLowerCase()] as const,
  members: (groupId: string, state: GroupMemberState) =>
    ['groups', 'members', groupId, state] as const,
};

export const groupQueryOptions = (idOrHandle: string) =>
  queryOptions({
    queryKey: groupKeys.group(idOrHandle),
    queryFn: () => groups.get(idOrHandle),
    retry: false,
  });
