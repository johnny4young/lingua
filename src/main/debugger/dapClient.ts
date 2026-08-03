import net, { type Socket } from 'node:net';
import type { Readable, Writable } from 'node:stream';

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_DAP_MESSAGE_BYTES = 1_000_000;
const MAX_BUFFERED_EVENTS = 100;

export interface DapMessage {
  readonly seq: number;
  readonly type: 'request' | 'response' | 'event';
  readonly command?: string;
  readonly event?: string;
  readonly request_seq?: number;
  readonly success?: boolean;
  readonly message?: string;
  readonly body?: unknown;
}

interface PendingRequest {
  readonly command: string;
  readonly resolve: (message: DapMessage) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

interface EventWaiter {
  readonly event: string;
  readonly predicate?: (message: DapMessage) => boolean;
  readonly resolve: (message: DapMessage) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

interface DapTransport {
  readonly label: string;
  readonly write: (frame: string, callback: (error?: Error | null) => void) => void;
  readonly close: () => void;
}

export class DapClient {
  private sequence = 1;
  private buffer = Buffer.alloc(0);
  private readonly pending = new Map<number, PendingRequest>();
  private readonly eventWaiters = new Set<EventWaiter>();
  private readonly bufferedEvents: DapMessage[] = [];
  private readonly listeners = new Set<(message: DapMessage) => void>();
  private closed = false;

  private constructor(private readonly transport: DapTransport) {}

  static async connect(host: string, port: number, timeoutMs = 5_000): Promise<DapClient> {
    const socket = net.createConnection({ host, port });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off('connect', onConnect);
        socket.off('error', onError);
        socket.destroy();
        reject(new Error(`Delve DAP connection timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const settle = (callback: () => void): void => {
        clearTimeout(timer);
        socket.off('connect', onConnect);
        socket.off('error', onError);
        callback();
      };
      const onConnect = (): void => settle(resolve);
      const onError = (error: Error): void => settle(() => reject(error));
      socket.once('connect', onConnect);
      socket.once('error', onError);
    });
    return DapClient.fromSocket(socket, 'Delve DAP');
  }

  /**
   * Build a DAP client over an adapter's stdin/stdout pair. LLDB's official
   * `lldb-dap` binary uses this transport, unlike Delve's loopback TCP server.
   */
  static fromStreams(
    input: Writable,
    output: Readable,
    options: { readonly label?: string; readonly close?: () => void } = {}
  ): DapClient {
    const label = options.label ?? 'DAP adapter';
    const client = new DapClient({
      label,
      write: (frame, callback) => input.write(frame, callback),
      close: options.close ?? (() => input.destroy()),
    });
    output.on('data', chunk => client.onData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    output.on('error', error => client.failAll(error));
    output.on('close', () => client.failAll(new Error(`${label} connection closed`)));
    input.on('error', error => client.failAll(error));
    return client;
  }

  private static fromSocket(socket: Socket, label: string): DapClient {
    const client = new DapClient({
      label,
      write: (frame, callback) => socket.write(frame, callback),
      close: () => socket.destroy(),
    });
    socket.on('data', chunk => client.onData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    socket.on('error', error => client.failAll(error));
    socket.on('close', () => client.failAll(new Error(`${label} connection closed`)));
    return client;
  }

  onEvent(listener: (message: DapMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  request<TBody = unknown>(
    command: string,
    args: Record<string, unknown> = {},
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
  ): Promise<TBody> {
    if (this.closed) return Promise.reject(new Error(`${this.transport.label} connection is closed`));
    const requestSeq = this.sequence++;
    const payload = JSON.stringify({
      seq: requestSeq,
      type: 'request',
      command,
      arguments: args,
    });
    const payloadBytes = Buffer.byteLength(payload, 'utf8');
    if (payloadBytes > MAX_DAP_MESSAGE_BYTES) {
      return Promise.reject(new Error(`${this.transport.label} request exceeded the message limit`));
    }

    return new Promise<TBody>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestSeq);
        reject(new Error(`${this.transport.label} ${command} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(requestSeq, {
        command,
        timer,
        resolve: response => resolve(response.body as TBody),
        reject,
      });
      this.transport.write(`Content-Length: ${payloadBytes}\r\n\r\n${payload}`, error => {
        if (!error) return;
        const pending = this.pending.get(requestSeq);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(requestSeq);
        pending.reject(error);
      });
    });
  }

  waitForEvent(
    event: string,
    predicate?: (message: DapMessage) => boolean,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
  ): Promise<DapMessage> {
    const index = this.bufferedEvents.findIndex(
      message => message.event === event && (!predicate || predicate(message))
    );
    if (index >= 0) return Promise.resolve(this.bufferedEvents.splice(index, 1)[0]!);
    if (this.closed) return Promise.reject(new Error(`${this.transport.label} connection is closed`));
    return new Promise((resolve, reject) => {
      const waiter: EventWaiter = {
        event,
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.eventWaiters.delete(waiter);
          reject(new Error(`${this.transport.label} ${event} event timed out after ${timeoutMs}ms`));
        }, timeoutMs),
      };
      this.eventWaiters.add(waiter);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.transport.close();
    this.failAll(new Error(`${this.transport.label} connection closed`));
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_DAP_MESSAGE_BYTES * 2) {
      this.failAll(new Error(`${this.transport.label} input exceeded the buffer limit`));
      this.transport.close();
      return;
    }

    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const lengthMatch = /^Content-Length:\s*(\d+)\s*$/imu.exec(header);
      if (!lengthMatch) {
        this.failAll(new Error(`${this.transport.label} sent an invalid frame header`));
        this.transport.close();
        return;
      }
      const length = Number(lengthMatch[1]);
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_DAP_MESSAGE_BYTES) {
        this.failAll(new Error(`${this.transport.label} sent an oversized frame`));
        this.transport.close();
        return;
      }
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
      this.buffer = this.buffer.subarray(bodyStart + length);
      let message: DapMessage;
      try {
        const parsed: unknown = JSON.parse(body);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('DAP message must be an object');
        }
        message = parsed as DapMessage;
      } catch {
        this.failAll(new Error(`${this.transport.label} sent invalid JSON`));
        this.transport.close();
        return;
      }
      this.dispatch(message);
    }
  }

  private dispatch(message: DapMessage): void {
    if (message.type === 'response' && typeof message.request_seq === 'number') {
      const pending = this.pending.get(message.request_seq);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.request_seq);
      if (message.success === false) {
        pending.reject(new Error(message.message || `${this.transport.label} ${pending.command} failed`));
      } else {
        pending.resolve(message);
      }
      return;
    }
    if (message.type !== 'event' || !message.event) return;
    for (const listener of this.listeners) {
      try {
        listener(message);
      } catch {
        // A presentation listener cannot corrupt the transport lifecycle.
      }
    }
    for (const waiter of this.eventWaiters) {
      if (waiter.event !== message.event || (waiter.predicate && !waiter.predicate(message))) {
        continue;
      }
      clearTimeout(waiter.timer);
      this.eventWaiters.delete(waiter);
      waiter.resolve(message);
      return;
    }
    this.bufferedEvents.push(message);
    if (this.bufferedEvents.length > MAX_BUFFERED_EVENTS) this.bufferedEvents.shift();
  }

  private failAll(error: Error): void {
    if (!this.closed) this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.eventWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.eventWaiters.clear();
  }
}
