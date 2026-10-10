import { createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../App.tsx';
import { createQueryClient } from '../api/queries.ts';
import { createAppRouter } from '../router.tsx';

export interface MockResponse {
  status?: number;
  body?: unknown;
}

type Handler = (body: unknown) => MockResponse;

/**
 * Replaces `fetch` with a table of `"METHOD /path"` handlers (paths relative to /api/v1).
 * Unknown routes answer 404 like the real API. Returns the mock to inspect calls.
 */
export function mockApi(routes: Record<string, Handler | MockResponse>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const key = `${init?.method ?? 'GET'} ${url.pathname.replace(/^\/api\/v1/, '')}`;
    const route = routes[key];
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const result: MockResponse = route
      ? typeof route === 'function'
        ? route(body)
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
    body: { domain: 'disbigle.test', title: 'disbigle.test', registrationMode, version: '0.1.0' },
  };
}

export function renderApp(path: string) {
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  const result = render(<App queryClient={queryClient} router={router} />);
  return { ...result, router, queryClient };
}
