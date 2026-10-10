import type { ApiErrorBody, ErrorCode } from '@disbigle/shared';

export const API_BASE = '/api/v1';

/** A field-level validation problem, as returned in `details` of a 422 response. */
export interface FieldIssue {
  path: string;
  message: string;
}

/** Error codes the client can produce on its own, in addition to the server's. */
export type ClientErrorCode = 'network_error' | 'unknown_error';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | ClientErrorCode;
  readonly details: unknown;

  constructor(
    status: number,
    code: ErrorCode | ClientErrorCode,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Field issues when the server rejected the input (422), otherwise an empty list. */
  get fieldIssues(): FieldIssue[] {
    if (!Array.isArray(this.details)) return [];
    return this.details.filter(
      (d): d is FieldIssue =>
        typeof d === 'object' &&
        d !== null &&
        typeof (d as FieldIssue).path === 'string' &&
        typeof (d as FieldIssue).message === 'string',
    );
  }
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ApiErrorBody).error === 'string' &&
    typeof (value as ApiErrorBody).message === 'string'
  );
}

/** Query string from defined values; arrays repeat the key (`id[]=a&id[]=b`). */
export function queryString(
  params: Record<string, string | number | boolean | readonly string[] | null | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) for (const item of value) search.append(key, item);
    else search.append(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const init: RequestInit = { method, headers, credentials: 'same-origin' };
  if (body instanceof FormData) {
    // The browser sets the multipart boundary itself.
    init.body = body;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch (error) {
    throw new ApiError(0, 'network_error', (error as Error).message || 'Network error');
  }

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    if (isErrorBody(data))
      throw new ApiError(response.status, data.error, data.message, data.details);
    throw new ApiError(response.status, 'unknown_error', response.statusText || 'Request failed');
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
