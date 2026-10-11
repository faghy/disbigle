import { DomainError } from '@disbigle/core';
import type { ErrorCode } from '@disbigle/shared';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

/** A parsed form or JSON body: nested objects, arrays and string leaves (JSON keeps its types). */
export type FormValue =
  | string
  | number
  | boolean
  | null
  | FormValue[]
  | { [key: string]: FormValue };
export type FormObject = { [key: string]: FormValue };

/**
 * Builds a nested object from `key=value` pairs using the Rails bracket convention that Mastodon
 * clients rely on: `media_ids[]=1&media_ids[]=2`, `poll[options][]=a`, `poll[expires_in]=300`,
 * `fields_attributes[0][name]=x`. A repeated key without brackets keeps its last value (as Rails).
 */
export function parseBracketPairs(pairs: Iterable<[string, string]>): FormObject {
  const root: FormObject = {};
  for (const [rawKey, value] of pairs) {
    const match = /^([^[\]]+)((?:\[[^[\]]*\])*)$/.exec(rawKey);
    if (!match) {
      root[rawKey] = value;
      continue;
    }
    const path = [
      match[1] ?? '',
      ...[...(match[2] ?? '').matchAll(/\[([^[\]]*)\]/g)].map((m) => m[1] ?? ''),
    ];
    let node: FormObject | FormValue[] = root;
    for (let i = 0; i < path.length; i++) {
      const key = path[i] ?? '';
      const last = i === path.length - 1;
      const nextKey = path[i + 1];
      if (Array.isArray(node)) {
        // `[]` followed by more keys (`a[][b]=1`) is rare; treat each as a new element.
        if (last) {
          node.push(value);
          break;
        }
        const child: FormObject | FormValue[] = nextKey === '' ? [] : {};
        node.push(child);
        node = child;
        continue;
      }
      if (last) {
        if (key === '') break;
        node[key] = value;
        break;
      }
      const existing: FormValue | undefined = node[key];
      const wantArray = nextKey === '';
      if (wantArray ? !Array.isArray(existing) : !isObject(existing)) {
        node[key] = wantArray ? [] : {};
      }
      node = node[key] as FormObject | FormValue[];
    }
  }
  return root;
}

function isObject(value: FormValue | undefined): value is FormObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseFormBody(body: string): FormObject {
  return parseBracketPairs(new URLSearchParams(body));
}

/** The query string of a request, parsed with bracket notation (`types[]=mention`). */
export function parseQuery(request: FastifyRequest): FormObject {
  const index = request.url.indexOf('?');
  return index === -1 ? {} : parseFormBody(request.url.slice(index + 1));
}

// --- Coercion helpers: clients send the same field as JSON, form fields or multipart parts. ---

export function str(value: FormValue | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

export function bool(value: FormValue | undefined): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string')
    return ['true', '1', 'on', 't', 'yes'].includes(value.toLowerCase());
  return undefined;
}

export function int(value: FormValue | undefined): number | undefined {
  const text = str(value);
  if (text === undefined || text.trim() === '') return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

/** An array field: a real array, an object with index keys (`a[0]=x`), or a single value. */
export function list(value: FormValue | undefined): FormValue[] {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value;
  if (isObject(value)) {
    return Object.keys(value)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => value[k] as FormValue);
  }
  return [value];
}

export function strings(value: FormValue | undefined): string[] {
  return list(value)
    .map((v) => str(v))
    .filter((v): v is string => v !== undefined && v !== '');
}

export function obj(value: FormValue | undefined): FormObject {
  return isObject(value) ? value : {};
}

/** The request body as an object (JSON or form-encoded; empty when absent). */
export function body(request: FastifyRequest): FormObject {
  const value = request.body as FormValue | undefined;
  return isObject(value) ? value : {};
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** A route `:id`: anything that is not one of our ids cannot exist, so it is a 404. */
export function idParam(request: FastifyRequest, name = 'id'): string {
  const value = (request.params as Record<string, string | undefined>)[name];
  if (!isUuid(value)) throw new MastodonError(404, 'Record not found');
  return value.toLowerCase();
}

/** Mastodon-style error: `{ "error": "..." }` with an HTTP status. */
export class MastodonError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'MastodonError';
  }
}

const statusByCode: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 422,
  rate_limited: 429,
  invalid_credentials: 401,
  mfa_required: 401,
  invalid_mfa_code: 401,
  too_many_attempts: 429,
  wrong_password: 403,
  username_taken: 422,
  email_taken: 422,
  registrations_closed: 403,
  invalid_invite: 422,
  account_pending_approval: 403,
  account_disabled: 403,
  internal_error: 500,
};

/** Error handler for the Mastodon routes: same statuses as Mastodon, `{ error }` bodies. */
export function mastodonErrorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  let status = 500;
  let payload: Record<string, unknown> = { error: 'Something went wrong' };
  if (error instanceof MastodonError) {
    status = error.statusCode;
    payload = { error: error.message, ...error.extra };
  } else if (error instanceof DomainError) {
    status = statusByCode[error.code];
    payload = {
      error:
        error.code === 'not_found'
          ? 'Record not found'
          : status === 422
            ? `Validation failed: ${error.message}`
            : error.message,
    };
  } else if (error instanceof ZodError) {
    status = 422;
    const detail = error.issues.map((i) => `${i.path.join('.') || 'value'} ${i.message}`);
    payload = { error: `Validation failed: ${detail.join(', ')}` };
  } else if (
    'statusCode' in error &&
    typeof error.statusCode === 'number' &&
    error.statusCode < 500
  ) {
    status = error.statusCode;
    payload = { error: error.message };
  }
  if (status >= 500) request.log.error(error);
  return reply.status(status).send(payload);
}

/**
 * Sets the `Link` header the way Mastodon does: `next` pages to older items with `max_id`,
 * `prev` to newer items with `min_id`. Other query parameters (limit, filters) are kept.
 */
export function setLinkHeader(
  request: FastifyRequest,
  reply: FastifyReply,
  baseUrl: string,
  cursors: { first: string; last: string } | null,
  options: { hasNext: boolean },
) {
  if (!cursors) return;
  const [path = '', search = ''] = request.url.split('?');
  const keep = new URLSearchParams(search);
  for (const key of ['max_id', 'min_id', 'since_id', 'access_token']) keep.delete(key);
  const link = (key: string, value: string) => {
    const params = new URLSearchParams(keep);
    params.set(key, value);
    return `<${baseUrl}${path}?${params.toString()}>`;
  };
  const parts: string[] = [];
  if (options.hasNext) parts.push(`${link('max_id', cursors.last)}; rel="next"`);
  parts.push(`${link('min_id', cursors.first)}; rel="prev"`);
  reply.header('Link', parts.join(', '));
}

/** Cursor parameters common to every paginated Mastodon endpoint. */
export interface PageParams {
  maxId?: string;
  sinceId?: string;
  minId?: string;
  limit: number;
}

export function pageParams(query: FormObject, defaultLimit: number, maxLimit: number): PageParams {
  const cursor = (name: string) => {
    const value = str(query[name]);
    if (value === undefined || value === '') return undefined;
    if (!isUuid(value)) throw new MastodonError(422, `Validation failed: invalid ${name}`);
    return value.toLowerCase();
  };
  const requested = int(query.limit);
  const limit = Math.min(Math.max(requested ?? defaultLimit, 1), maxLimit);
  const params: PageParams = { limit };
  const maxId = cursor('max_id');
  const sinceId = cursor('since_id');
  const minId = cursor('min_id');
  if (maxId) params.maxId = maxId;
  if (sinceId) params.sinceId = sinceId;
  if (minId) params.minId = minId;
  return params;
}
