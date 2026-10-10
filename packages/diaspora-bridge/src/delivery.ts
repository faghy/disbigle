// Outgoing HTTP delivery. Long-term retries are the job queue's business (see queue.ts);
// `httpDeliver` only retries quickly once for transient network hiccups.

/** Sends a body to a remote URL; must throw when the delivery failed. */
export type DeliverFn = (url: string, body: string, contentType: string) => Promise<void>;

/** The remote server answered with an error status. */
export class DeliveryHttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`POST ${url} answered ${status}`);
    this.name = 'DeliveryHttpError';
  }

  /** 4xx answers (except 408 and 429) will not get better by retrying. */
  get permanent(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429;
  }
}

export interface HttpDeliverOptions {
  timeoutMs?: number;
  /** Immediate extra attempts for network errors and 5xx answers. */
  retries?: number;
  /** Delay between immediate attempts, in milliseconds. */
  backoffMs?: number;
  userAgent?: string;
}

/** Default `deliver`: `fetch` with a timeout. */
export function httpDeliver(options: HttpDeliverOptions = {}): DeliverFn {
  const { timeoutMs = 15_000, retries = 1, backoffMs = 1_000, userAgent = 'Disbigle' } = options;
  return async (url, body, contentType) => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(backoffMs * 4 ** (attempt - 1));
      try {
        const response = await fetch(url, {
          method: 'POST',
          body,
          headers: { 'content-type': contentType, 'user-agent': userAgent },
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'follow',
        });
        await response.body?.cancel();
        if (response.ok) return;
        lastError = new DeliveryHttpError(url, response.status);
        if ((lastError as DeliveryHttpError).permanent) break;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
