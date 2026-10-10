import type { StreamEvent } from '@disbigle/shared';

export type StreamListener = (event: StreamEvent) => void;

export const STREAMING_PATH = '/api/v1/streaming';

export function streamingUrl(location: Pick<Location, 'protocol' | 'host'> = window.location) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}${STREAMING_PATH}`;
}

function isStreamEvent(value: unknown): value is StreamEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = (value as { event?: unknown }).event;
  return (
    event === 'update' ||
    event === 'status.update' ||
    event === 'delete' ||
    event === 'notification'
  );
}

/**
 * One WebSocket shared by the whole app. Streams are reference-counted: the server is asked
 * to subscribe while at least one listener needs a stream. Reconnects with backoff.
 */
export class StreamingClient {
  private socket: WebSocket | null = null;
  private readonly counts = new Map<string, number>();
  private readonly byStream = new Map<string, Set<StreamListener>>();
  private readonly anyListeners = new Set<StreamListener>();
  private readonly reconnectListeners = new Set<() => void>();
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private connectedBefore = false;

  constructor(private readonly url: string = streamingUrl()) {}

  connect() {
    if (this.closed || this.socket || typeof WebSocket === 'undefined') return;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.attempts = 0;
      for (const stream of this.counts.keys()) this.send({ type: 'subscribe', stream });
      if (this.connectedBefore) for (const listener of this.reconnectListeners) listener();
      this.connectedBefore = true;
    });
    socket.addEventListener('message', (message: MessageEvent) => {
      let data: unknown;
      try {
        data = JSON.parse(String(message.data));
      } catch {
        return;
      }
      if (!isStreamEvent(data)) return;
      for (const listener of this.anyListeners) listener(data);
      for (const listener of this.byStream.get(data.stream) ?? []) listener(data);
    });
    socket.addEventListener('close', () => {
      this.socket = null;
      if (this.closed) return;
      // Exponential backoff up to 30 seconds.
      const delay = Math.min(30_000, 1000 * 2 ** this.attempts);
      this.attempts += 1;
      this.timer = setTimeout(() => this.connect(), delay);
    });
  }

  private send(message: { type: 'subscribe' | 'unsubscribe'; stream: string }) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  /** Listens to one stream (`user`, `public`, `public:local`, `hashtag:tag`). */
  subscribe(stream: string, listener: StreamListener): () => void {
    const name = stream.toLowerCase();
    const count = this.counts.get(name) ?? 0;
    this.counts.set(name, count + 1);
    if (count === 0) this.send({ type: 'subscribe', stream: name });
    let listeners = this.byStream.get(name);
    if (!listeners) {
      listeners = new Set();
      this.byStream.set(name, listeners);
    }
    listeners.add(listener);
    this.connect();

    return () => {
      listeners.delete(listener);
      const remaining = (this.counts.get(name) ?? 1) - 1;
      if (remaining > 0) {
        this.counts.set(name, remaining);
      } else {
        this.counts.delete(name);
        this.byStream.delete(name);
        this.send({ type: 'unsubscribe', stream: name });
      }
    };
  }

  /** Receives every event, whatever the stream (deletions are not tied to one stream). */
  onAny(listener: StreamListener): () => void {
    this.anyListeners.add(listener);
    return () => this.anyListeners.delete(listener);
  }

  /** Called after the connection comes back, so callers can refetch what they missed. */
  onReconnect(listener: () => void): () => void {
    this.reconnectListeners.add(listener);
    return () => this.reconnectListeners.delete(listener);
  }

  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.socket?.close();
    this.socket = null;
  }
}
