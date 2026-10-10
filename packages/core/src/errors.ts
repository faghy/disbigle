import type { ErrorCode } from '@disbigle/shared';

/** An expected failure of a domain operation, safe to show to the user. */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
