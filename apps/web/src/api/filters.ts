import { api } from './client.ts';

export const filterContexts = ['home', 'public', 'notifications', 'thread'] as const;
export type FilterContext = (typeof filterContexts)[number];

/** Mirrors `KeywordFilter` in `packages/core/src/social/filters.ts`. */
export interface KeywordFilter {
  id: string;
  phrase: string;
  wholeWord: boolean;
  contexts: FilterContext[];
  expiresAt: string | null;
}

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
