import { createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../App.tsx';
import { createQueryClient, DEFAULT_LIMITS } from '../api/queries.ts';
import { createAppRouter } from '../router.tsx';

export interface MockResponse {
  status?: number;
  body?: unknown;
}

type Handler = (body: unknown, url: URL) => MockResponse | Promise<MockResponse>;

/**
 * Replaces `fetch` with a table of `"METHOD /path"` handlers (paths relative to /api/v1).
 * Unknown routes answer 404 like the real API. Returns the mock to inspect calls.
 */
/** Answers for endpoints most signed-in pages call; tests override them as needed. */
const defaultRoutes: Record<string, Handler | MockResponse> = {
  'GET /timelines/home': { body: [] },
  'GET /aspects': { body: [] },
  'GET /notifications/unread_count': { body: { count: 0 } },
};

export function mockApi(routes: Record<string, Handler | MockResponse>) {
  const table = { ...defaultRoutes, ...routes };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const key = `${init?.method ?? 'GET'} ${url.pathname.replace(/^\/api\/v1/, '')}`;
    const route = table[key];
    const raw = init?.body;
    const body = raw instanceof FormData ? raw : raw ? JSON.parse(String(raw)) : undefined;
    const result: MockResponse = route
      ? typeof route === 'function'
        ? await route(body, url)
        : route
      : { status: 404, body: { error: 'not_found', message: 'Route not found' } };
    return new Response(result.body === undefined ? null : JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export const signedOut: MockResponse = {
  status: 401,
  body: { error: 'unauthorized', message: 'Sign in required' },
};

export function instance(registrationMode: 'open' | 'approval' | 'invite' | 'closed' = 'open') {
  return {
    body: {
      domain: 'disbigle.test',
      title: 'disbigle.test',
      description: '',
      registrationMode,
      version: '0.1.0',
      limits: DEFAULT_LIMITS,
    },
  };
}

export function renderApp(path: string) {
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  const result = render(<App queryClient={queryClient} router={router} />);
  return { ...result, router, queryClient };
}
