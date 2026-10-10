import i18n from '../lib/i18n.ts';
import { ApiError, type FieldIssue } from './client.ts';

export type FieldErrors = Record<string, string>;

/** Human-readable, translated message for any error thrown by the API client or the browser. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const key = `errors.${error.code}`;
    if (i18n.exists(key)) return i18n.t(key);
    return error.message || i18n.t('errors.unknown_error');
  }
  if (error instanceof Error) {
    // WebAuthn ceremonies fail with DOMException-style names (see @simplewebauthn/browser).
    const code = (error as Error & { code?: string }).code;
    if (error.name === 'NotAllowedError' || error.name === 'AbortError')
      return i18n.t('errors.webauthn_cancelled');
    if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' || error.name === 'InvalidStateError')
      return i18n.t('errors.webauthn_already_registered');
    if (error.name === 'NotSupportedError' || error.name === 'SecurityError')
      return i18n.t('errors.webauthn_unsupported');
    if (error.message) return error.message;
  }
  return i18n.t('errors.unknown_error');
}

/** Translates one field problem: a known field message when there is one, else the raw message. */
export function fieldMessage(path: string, message: string, required = false): string {
  if (required) return i18n.t('validation.required');
  const key = `validation.fields.${path}`;
  return i18n.exists(key) ? i18n.t(key) : message;
}

/** Field errors from a 422 response, keyed by field path (`fields.0.name`). */
export function fieldErrorsFrom(error: unknown): FieldErrors {
  if (!(error instanceof ApiError)) return {};
  return issuesToFieldErrors(error.fieldIssues);
}

interface IssueLike {
  path: PropertyKey[] | string;
  message: string;
  code?: string;
  minimum?: number | bigint;
}

/** Converts client-side (Zod) or server-side issues to a map of translated messages. */
export function issuesToFieldErrors(issues: readonly (IssueLike | FieldIssue)[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const path = Array.isArray(issue.path) ? issue.path.map(String).join('.') : issue.path;
    if (errors[path]) continue;
    const like = issue as IssueLike;
    const required = like.code === 'too_small' && Number(like.minimum) === 1;
    errors[path] = fieldMessage(path, issue.message, required);
  }
  return errors;
}

/** True when the error only concerns fields, so no general message is needed. */
export function isFieldError(error: unknown): boolean {
  return error instanceof ApiError && error.fieldIssues.length > 0;
}
