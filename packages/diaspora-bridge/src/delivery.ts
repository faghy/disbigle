// Outgoing HTTP delivery and a small in-process queue keeping it off the request path.
// The queue is not persistent: jobs pending at shutdown are lost (see the package notes).

/** Sends a body to a remote URL; must throw when the delivery failed. */
export type DeliverFn = (url: string, body: string, contentType: string) => Promise<void>;

export interface HttpDeliverOptions {
  timeoutMs?: number;
  /** Attempts after the first one, for network errors, 5xx and 429. */
  retries?: number;
  /** Base delay of the exponential backoff, in milliseconds. */
  backoffMs?: number;
  userAgent?: string;
}

/** Default `deliver`: `fetch` with a timeout and a few retries with exponential backoff. */
export function httpDeliver(options: HttpDeliverOptions = {}): DeliverFn {
  const { timeoutMs = 15_000, retries = 3, backoffMs = 1_000, userAgent = 'Disbigle' } = options;
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
        lastError = new Error(`POST ${url} answered ${response.status}`);
        if (response.status < 500 && response.status !== 429) break;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A bounded-concurrency in-memory job queue. */
export class TaskQueue {
  private readonly pending: Array<() => Promise<void>> = [];
  private running = 0;
  private waiters: Array<() => void> = [];

  constructor(
    private readonly concurrency = 4,
    private readonly onError: (error: unknown) => void = (error) =>
      console.error('diaspora: background job failed', error),
  ) {}

  /** Enqueues a job; returns immediately. */
  push(job: () => Promise<void>): void {
    this.pending.push(job);
    this.drain();
  }

  /** Resolves when no job is pending or running (tests, graceful shutdown). */
  idle(): Promise<void> {
    if (this.running === 0 && this.pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private drain(): void {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift();
      if (!job) break;
      this.running++;
      job()
        .catch(this.onError)
        .finally(() => {
          this.running--;
          this.drain();
          if (this.running === 0 && this.pending.length === 0) {
            const waiters = this.waiters;
            this.waiters = [];
            for (const resolve of waiters) resolve();
          }
        });
    }
  }
}
