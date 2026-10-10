import { DomainError } from '@disbigle/core';
import type { ApiErrorBody, ErrorCode } from '@disbigle/shared';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError, type z } from 'zod';

const statusByCode: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  invalid_credentials: 401,
  mfa_required: 401,
  invalid_mfa_code: 401,
  too_many_attempts: 429,
  wrong_password: 403,
  username_taken: 409,
  email_taken: 409,
  registrations_closed: 403,
  invalid_invite: 422,
  account_pending_approval: 403,
  account_disabled: 403,
  internal_error: 500,
};

/** Validates input with a Zod schema, turning failures into a 422 response. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  return schema.parse(value ?? {});
}

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  let status = 500;
  let body: ApiErrorBody = { error: 'internal_error', message: 'Something went wrong' };

  if (error instanceof DomainError) {
    status = statusByCode[error.code];
    body = { error: error.code, message: error.message, details: error.details };
  } else if (error instanceof ZodError) {
    status = 422;
    body = {
      error: 'validation_failed',
      message: 'Some fields are invalid',
      details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  } else if (
    'statusCode' in error &&
    typeof error.statusCode === 'number' &&
    error.statusCode < 500
  ) {
    status = error.statusCode;
    const code: ErrorCode =
      status === 429
        ? 'rate_limited'
        : status === 404
          ? 'not_found'
          : status === 401
            ? 'unauthorized'
            : 'bad_request';
    body = { error: code, message: error.message };
  }

  if (status >= 500) request.log.error(error);
  return reply.status(status).send(body);
}
