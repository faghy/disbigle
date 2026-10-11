/** Stable, machine-readable error codes returned by the API. */
export const errorCodes = [
  'bad_request',
  'validation_failed',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'invalid_credentials',
  'mfa_required',
  'invalid_mfa_code',
  'too_many_attempts',
  'wrong_password',
  'username_taken',
  'email_taken',
  'registrations_closed',
  'invalid_invite',
  'account_pending_approval',
  'account_disabled',
  'bot_check_failed',
  'internal_error',
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export interface ApiErrorBody {
  error: ErrorCode;
  message: string;
  details?: unknown;
}
