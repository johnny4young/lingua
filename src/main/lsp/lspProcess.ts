import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

/**
 * implementation — generic LSP child-process wrapper.
 *
 * Owns the JSON-RPC v2 framing every LSP server speaks over stdio
 * (`Content-Length: N\r\n\r\n<JSON>`). The wrapper is intentionally
 * language-agnostic: it does not know anything about gopls vs. rust-
 * analyzer. A language-specific launcher (e.g. `rustAnalyzerLauncher.ts`)
 * picks the binary, builds the initialize parameters, and consumes the
 * messages this class emits.
 *
 * Spawning uses `spawn(command, args[], options)` with an explicit args
 * array — no shell interpolation — so the standard command-injection
 * concern that motivates `execFile`-style helpers does not apply here.
 *
 * Concurrency:
 *  - `sendRequest` returns a Promise resolved when the matching
 *    `id` flows back. The wrapper buffers in-flight requests in a Map
 *    keyed by `id` and rejects them all if the process exits before
 *    they complete.
 *  - `sendNotification` is fire-and-forget — LSP notifications have no
 *    id and no response.
 *  - Inbound messages come in two flavors: responses (carry `id`) and
 *    notifications (carry `method` but no `id`). The wrapper routes
 *    responses to the pending request map and forwards notifications
 *    to the `onNotification` listener.
 *
 * Robustness:
 *  - The stdout reader handles split chunks (a single Buffer chunk may
 *    carry a partial header, two messages, or a message split across
 *    two reads). Unicode payloads are decoded by counting bytes, not
 *    characters, so the `Content-Length` byte count stays accurate
 *    when the JSON contains multi-byte chars.
 *  - `dispose()` is idempotent — calling it twice is a no-op. The
 *    second call still resolves any caller waiting on `whenExited`.
 */

export type JsonRpcId = number | string;

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification<P = unknown> {
  jsonrpc: '2.0';
  method: string;
  params?: P;
}

export interface LspProcessOptions {
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * Called on every inbound JSON-RPC notification from the server.
   * Receivers should self-filter by method name (e.g. only handle
   * `textDocument/publishDiagnostics`).
   */
  onNotification?: (notification: JsonRpcNotification) => void;
  /**
   * Called once when the child process exits for any reason — clean
   * shutdown, crash, or kill. The wrapper guarantees this fires
   * exactly once per spawn even if the OS surfaces both `exit` and
   * `close`.
   */
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  /** Maximum bytes the wrapper will buffer before erroring. Default 32 MiB. */
  maxBufferBytes?: number;
}

const DEFAULT_MAX_BUFFER_BYTES = 32 * 1024 * 1024;
const HEADER_TERMINATOR = Buffer.from('\r\n\r\n');
const CONTENT_LENGTH_REGEX = /^Content-Length:\s*(\d+)/i;

export class LspProcess {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private nextRequestId = 1;
  private pending = new Map<
    JsonRpcId,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private disposed = false;
  private exited = false;
  private exitPromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  private exitResolver!: (value: {
    code: number | null;
    signal: NodeJS.Signals | null;
  }) => void;
  private readonly maxBufferBytes: number;

  constructor(private readonly options: LspProcessOptions) {
    this.maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
    this.exitPromise = new Promise((resolve) => {
      this.exitResolver = resolve;
    });
  }

  start(): void {
    if (this.child) return;

    const child = spawn(this.options.command, [...(this.options.args ?? [])], {
      cwd: this.options.cwd,
      env: this.options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child = child;

    child.stdout.on('data', (chunk: Buffer) => {
      this.appendBuffer(chunk);
    });

    child.stderr.on('data', () => {
      // LSP servers chatter on stderr (logs, telemetry). Stay silent
      // here so packaged builds do not spam main's console.
    });

    // writeFramedMessage guards with `stdin.writable` + try/catch, but an
    // EPIPE from a server that dies while a frame flushes is delivered
    // ASYNCHRONOUSLY as a stream 'error' event — without this listener it
    // becomes an uncaught exception that crashes the main process. The
    // child 'exit'/'error' handlers above own the failure surfacing.
    child.stdin.on('error', () => {
      // EPIPE / ERR_STREAM_DESTROYED — server exited mid-write.
    });

    const handleExit = (
      code: number | null,
      signal: NodeJS.Signals | null
    ): void => {
      if (this.exited) return;
      this.exited = true;
      const error = new Error(
        `LSP process exited before responding (code=${code}, signal=${signal})`
      );
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
      this.exitResolver({ code, signal });
      this.options.onExit?.(code, signal);
    };

    child.on('exit', handleExit);
    child.on('error', (err) => {
      // `error` fires when spawn itself fails (ENOENT etc.). Treat as
      // immediate exit with a synthetic non-zero code so the caller
      // surfaces a startup-failed status.
      if (!this.exited) {
        handleExit(-1, null);
      }
      // Avoid an unhandled `error` rethrow on the EventEmitter.
      void err;
    });
  }

  get stderr(): NodeJS.ReadableStream | null {
    return this.child?.stderr ?? null;
  }

  whenExited(): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    return this.exitPromise;
  }

  isAlive(): boolean {
    return this.child !== null && !this.exited && !this.disposed;
  }

  sendNotification<P>(method: string, params?: P): void {
    if (!this.isAlive()) return;
    const payload: JsonRpcNotification<P> = { jsonrpc: '2.0', method, params };
    this.writeFramedMessage(payload);
  }

  sendRequest<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.isAlive()) {
      return Promise.reject(new Error('LSP process is not running'));
    }
    const id = this.nextRequestId++;
    const payload = { jsonrpc: '2.0' as const, id, method, params };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.writeFramedMessage(payload);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.child && !this.exited) {
      try {
        this.child.kill();
      } catch {
        // Already dead — fine.
      }
    }
  }

  private writeFramedMessage(payload: unknown): void {
    if (!this.child || !this.child.stdin.writable) return;
    const json = JSON.stringify(payload);
    const body = Buffer.from(json, 'utf8');
    const header = Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, 'ascii');
    try {
      this.child.stdin.write(header);
      this.child.stdin.write(body);
    } catch {
      // The stdin pipe can close if the child died between the
      // `isAlive` check and the write. Drop the message rather than
      // crashing the main process.
    }
  }

  private appendBuffer(chunk: Buffer): void {
    if (this.buffer.byteLength + chunk.byteLength > this.maxBufferBytes) {
      // Hard cap defends against a runaway server filling main's heap.
      // Silently resetting the buffer would corrupt the framing parser:
      // subsequent chunks would resume mid-message and every later
      // Content-Length header would be off. Disposing the process is
      // the safer recovery — the launcher reports `'degraded'` once the
      // `exit` event fires, and the user can restart through Settings.
      this.dispose();
      return;
    }
    this.buffer = this.buffer.byteLength === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    this.drainBuffer();
  }

  private drainBuffer(): void {
    // Parse as many complete framed messages as the buffer currently
    // holds. Each iteration:
    //   1. Locate "\r\n\r\n" — the end of the header block.
    //   2. Read Content-Length from the header.
    //   3. If the body is fully buffered, slice it out, decode, and
    //      dispatch. Otherwise stop and wait for the next chunk.
    while (true) {
      const headerEnd = this.buffer.indexOf(HEADER_TERMINATOR);
      if (headerEnd === -1) return;

      const headerText = this.buffer.subarray(0, headerEnd).toString('ascii');
      const contentLength = parseContentLength(headerText);
      if (contentLength === null) {
        this.buffer = this.buffer.subarray(headerEnd + HEADER_TERMINATOR.byteLength);
        continue;
      }

      const bodyStart = headerEnd + HEADER_TERMINATOR.byteLength;
      const bodyEnd = bodyStart + contentLength;
      if (this.buffer.byteLength < bodyEnd) return;

      const body = this.buffer.subarray(bodyStart, bodyEnd).toString('utf8');
      this.buffer = this.buffer.subarray(bodyEnd);
      this.dispatchMessage(body);
    }
  }

  private dispatchMessage(json: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      // A server sending non-JSON inside a framed message is a hard
      // bug, but losing one message is preferable to a main-process
      // crash. Drop and continue.
      return;
    }

    if (!isObject(parsed)) return;
    const message = parsed as Record<string, unknown>;

    if ('id' in message && typeof message.id !== 'undefined') {
      const id = message.id as JsonRpcId;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (message.error) {
        const err = message.error as { code: number; message: string };
        pending.reject(new Error(`LSP error ${err.code}: ${err.message}`));
        return;
      }
      pending.resolve(message.result);
      return;
    }

    if (typeof message.method === 'string') {
      this.options.onNotification?.({
        jsonrpc: '2.0',
        method: message.method,
        params: message.params,
      });
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseContentLength(headerBlock: string): number | null {
  for (const line of headerBlock.split('\r\n')) {
    const match = CONTENT_LENGTH_REGEX.exec(line);
    if (match) {
      const value = Number.parseInt(match[1] ?? '', 10);
      if (Number.isFinite(value) && value >= 0) return value;
    }
  }
  return null;
}
