import type { FilterContext, KeywordFilter } from '@disbigle/shared';
import { api } from './client.ts';

export const filterContexts: readonly FilterContext[] = [
  'home',
  'public',
  'notifications',
  'thread',
];
export type { FilterContext, KeywordFilter };

export interface KeywordFilterRequest {
  phrase: string;
  wholeWord: boolean;
  contexts: FilterContext[];
  expiresIn: number | null;
}

export const filterKeys = { all: ['filters'] as const };

export const filters = {
  list: () => api.get<KeywordFilter[]>('/filters'),
  create: (body: KeywordFilterRequest) => api.post<KeywordFilter>('/filters', body),
  remove: (id: string) => api.delete<{ status: 'ok' }>(`/filters/${encodeURIComponent(id)}`),
};
