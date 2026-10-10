/** A stand-in for the browser WebSocket that tests can drive by hand. */
export class MockWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  readonly sent: unknown[] = [];

  constructor(url: string) {
    super();
    this.url = url;
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      if (this.readyState !== MockWebSocket.CONNECTING) return;
      this.readyState = MockWebSocket.OPEN;
      this.dispatchEvent(new Event('open'));
    });
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent(new Event('close'));
  }

  /** Delivers a server message to the client. */
  receive(message: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  }

  /** Streams this socket has asked the server for. */
  get subscriptions(): string[] {
    const streams = new Set<string>();
    for (const message of this.sent as { type: string; stream: string }[]) {
      if (message.type === 'subscribe') streams.add(message.stream);
      else streams.delete(message.stream);
    }
    return [...streams];
  }

  static latest(): MockWebSocket | undefined {
    return MockWebSocket.instances.filter((s) => s.readyState === MockWebSocket.OPEN).at(-1);
  }

  static reset() {
    MockWebSocket.instances = [];
  }
}
