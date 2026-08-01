/**
 * implementation — HTTP client that wraps native `fetch` with the
 * full privacy + safety envelope:
 *
 *   - `AbortController` timeout (30 s default; user-configurable per
 *     request capped at 5 min).
 *   - Response body streamed + capped at `MAX_RESPONSE_BODY_BYTES`
 *     (4 MiB). The stream is aborted as soon as the cap is hit and
 *     the `tooLarge` flag set so the UI surfaces it.
 *   - Case-insensitive EXACT-match header redaction (RFC 7230 §3.2):
 *     `Authorization` / `authorization` / `AUTHORIZATION` all match;
 *     `Document-Authorization-Date` does NOT match (no substring
 *     redaction false positives).
 *   - Typed error classification: `network-error` / `timeout` /
 *     `cors-error` — the UI swaps copy + actionable affordances
 *     based on the closed-enum kind.
 *
 * "No silent network call" principle — this function ONLY runs when
 * the user explicitly clicks Send / presses Cmd+Enter. The Send
 * button disables during the in-flight execution to prevent
 * accidental concurrent runs (single-flight UX).
 */

import {
  composeRequestHeaders,
  isHeaderSensitive,
} from '../../shared/httpWorkspaceHeaders';
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  MAX_REQUEST_BODY_BYTES,
  MAX_REQUEST_TIMEOUT_MS,
  MAX_RESPONSE_BODY_BYTES,
  MAX_STREAM_MESSAGES,
  bucketHttpStatus,
  utf8ByteLength,
  type HttpRequestV1,
  type HttpResponseHeader,
  type HttpResponseKind,
  type HttpResponseV1,
  type HttpStatusBucket,
} from '../../shared/httpWorkspaceSchema';
import { BASELINE_SENSITIVE_HEADERS } from '../../shared/httpSensitiveHeaders';

/**
 * Caller-provided options. `userSensitiveHeaders` is the additive
 * Settings allowlist (baseline names always apply regardless).
 * `signal` lets the UI cancel an in-flight request before the
 * timeout expires.
 */
export interface ExecuteHttpRequestOptions {
  /** Names from Settings → Privacy → "Sensitive HTTP headers". */
  userSensitiveHeaders?: readonly string[];
  /** Caller-supplied abort signal (e.g. user-driven cancel). */
  signal?: AbortSignal;
  /** Test seam: override the global `fetch`. Production passes undefined. */
  fetchImpl?: typeof fetch;
  /** Test seam: override the response body cap. Production passes undefined. */
  maxResponseBodyBytes?: number;
  /** Desktop proxy opt-in; ignored by the browser transport. */
  allowPrivateHosts?: boolean;
  /** Bounded live preview for SSE/WebSocket runs. */
  onProgress?: (progress: {
    body: string;
    sizeBytes: number;
    messageCount: number;
    opened: boolean;
  }) => void;
  /** Stable run id for the typed desktop IPC lifecycle. */
  runId?: string;
}

/**
 * Map the runtime outcome to the closed-enum kind. Status codes
 * follow the standard buckets; the typed failure cases come from
 * the catch-block classifier below.
 */
function classifyResponseKind(status: number): HttpResponseKind {
  if (status >= 200 && status < 400) return 'success';
  if (status >= 400 && status < 500) return 'client-error';
  return 'server-error';
}

/**
 * Best-effort classification of the thrown error. The browser fetch
 * API does not distinguish CORS from generic network errors cleanly;
 * we infer from the message + the `AbortSignal.reason` when present.
 */
function classifyFetchError(err: unknown, signal: AbortSignal | null): {
  kind: 'network-error' | 'timeout' | 'cors-error';
  message: string;
} {
  if (signal?.aborted) {
    // `AbortController.abort('timeout')` plumbs the reason through.
    const reason = signal.reason;
    if (typeof reason === 'string' && reason === 'timeout') {
      return { kind: 'timeout', message: 'Request timed out' };
    }
    if (reason instanceof Error && reason.message.includes('timeout')) {
      return { kind: 'timeout', message: reason.message };
    }
  }
  const message = err instanceof Error ? err.message : String(err ?? 'fetch failed');
  // Browser CORS errors typically surface as `TypeError: Failed to fetch`
  // with a low-level message about CORS. We surface `'cors-error'`
  // when the message contains a CORS-specific hint; everything else
  // falls through to `'network-error'`.
  if (
    /cors/i.test(message) ||
    /preflight/i.test(message) ||
    /cross-origin/i.test(message)
  ) {
    return { kind: 'cors-error', message };
  }
  return { kind: 'network-error', message };
}

/**
 * Stream a response body with a hard byte cap. Returns the decoded
 * UTF-8 string + a `tooLarge` flag when the cap was hit. We use the
 * Response's `body` ReadableStream so a partial download still
 * surfaces the cap suffix without paying for the full transfer.
 */
async function readBodyWithCap(
  response: Response,
  cap: number,
  onProgress?: ExecuteHttpRequestOptions['onProgress'],
  maxMessages?: number
): Promise<{ text: string; size: number; tooLarge: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) {
    // Some platforms (older Safari, jsdom) don't expose
    // `Response.body`. Fall back to `text()` with the cap applied
    // post-decode. Compare BYTES (not UTF-16 code units) — a
    // multi-byte UTF-8 payload's `text.length` would underreport the
    // actual byte count and bypass the cap.
    const text = await response.text();
    const encoded = new TextEncoder().encode(text);
    const bytes = encoded.byteLength;
    let boundedText = text;
    let tooLarge = false;
    if (bytes > cap) {
      // Truncate by bytes; decode back. `fatal: false` tolerates a
      // mid-code-point cut at the boundary.
      boundedText = new TextDecoder('utf-8', { fatal: false }).decode(
        encoded.subarray(0, cap)
      );
      tooLarge = true;
    }
    const limited = limitSseMessages(boundedText, maxMessages);
    onProgress?.({
      body: limited.text,
      sizeBytes: bytes,
      messageCount: limited.count,
      opened: true,
    });
    return {
      text: limited.text,
      size: bytes,
      tooLarge: tooLarge || limited.tooLarge,
    };
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let tooLarge = false;
  // Stream-read loop. Re-throws on read error so the outer catch in
  // `executeHttpRequest` classifies the failure as a network /
  // timeout / cors error. ESLint complains about a try/catch that
  // only re-throws — we have no try/catch here; the outer
  // `executeHttpRequest` catches.
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      totalBytes += value.byteLength;
      if (totalBytes > cap) {
        // Trim the last chunk + abort the rest of the stream.
        const overshoot = totalBytes - cap;
        const trimmed = value.subarray(0, value.byteLength - overshoot);
        chunks.push(trimmed);
        tooLarge = true;
      } else {
        chunks.push(value);
      }
      const limited = limitSseMessages(decodeChunks(chunks), maxMessages);
      if (limited.tooLarge) {
        chunks.splice(
          0,
          chunks.length,
          new TextEncoder().encode(limited.text)
        );
        tooLarge = true;
      }
      if (onProgress) {
        onProgress({
          body: limited.text,
          sizeBytes: Math.min(totalBytes, cap),
          messageCount: limited.count,
          opened: true,
        });
      }
      if (tooLarge) {
        try {
          await reader.cancel();
        } catch {
          /* stream already finalised */
        }
        break;
      }
    }
  }
  // Concatenate the chunks into a single Uint8Array and decode.
  let combinedLength = 0;
  for (const c of chunks) combinedLength += c.byteLength;
  const combined = new Uint8Array(combinedLength);
  let offset = 0;
  for (const c of chunks) {
    combined.set(c, offset);
    offset += c.byteLength;
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(combined);
  return { text, size: tooLarge ? totalBytes : combined.byteLength, tooLarge };
}

function decodeChunks(chunks: ReadonlyArray<Uint8Array>): string {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function countSseEvents(body: string): number {
  if (!body) return 0;
  return body.split(/\r?\n\r?\n/u).filter((event) => event.trim().length > 0)
    .length;
}

function limitSseMessages(
  body: string,
  maxMessages?: number
): { text: string; count: number; tooLarge: boolean } {
  const count = countSseEvents(body);
  if (maxMessages === undefined || count <= maxMessages) {
    return { text: body, count, tooLarge: false };
  }
  const boundary = /\r?\n\r?\n/gu;
  let start = 0;
  let retained = 0;
  for (const match of body.matchAll(boundary)) {
    if (body.slice(start, match.index).trim().length > 0) retained += 1;
    if (retained === maxMessages) {
      return {
        text: body.slice(0, match.index + match[0].length),
        count: maxMessages,
        tooLarge: true,
      };
    }
    start = match.index + match[0].length;
  }
  return { text: body, count, tooLarge: true };
}

/**
 * Materialise the redacted response headers. Header values for
 * sensitive entries are replaced with a fixed sentinel string so the
 * UI can render the row + the value but the secret never reaches
 * persisted storage or telemetry.
 */
function buildRedactedHeaders(
  rawHeaders: Headers,
  userAllowlist: readonly string[]
): { headers: HttpResponseHeader[]; redactedHeaders: string[] } {
  const headers: HttpResponseHeader[] = [];
  const redactedHeaders: string[] = [];
  rawHeaders.forEach((value, name) => {
    if (isHeaderSensitive(name, userAllowlist)) {
      headers.push({ name, value: '<redacted>', redacted: true });
      redactedHeaders.push(name.toLowerCase());
    } else {
      headers.push({ name, value, redacted: false });
    }
  });
  return { headers, redactedHeaders };
}

/**
 * Build the outgoing fetch headers from the user's request. Skips
 * `enabled: false` rows. Returns a plain `Headers` instance so the
 * browser can apply its standard validation (forbidden-header
 * filtering, etc.).
 */
function buildRequestHeaders(
  request: HttpRequestV1,
  willSendBody: boolean
): Headers {
  const headers = new Headers();
  // `composeRequestHeaders` already drops `enabled: false` + empty-name
  // rows and injects the Auth sub-tab header (auth wins a name
  // collision). The injected header is always baseline-sensitive
  // (`Authorization` / `x-api-key`), so the response-side redaction
  // still scrubs the echo on the way back.
  for (const entry of composeRequestHeaders(request)) {
    try {
      headers.append(entry.name, entry.value);
    } catch {
      // The browser rejects some header names (e.g. with newlines).
      // Skip rather than abort the whole send — the user can fix
      // and retry.
    }
  }
  // Default Content-Type for JSON / form bodies when the user did
  // not set one explicitly. Skips when a Content-Type is already
  // present (case-insensitive check).
  if (
    willSendBody &&
    request.body &&
    request.body.kind !== 'none' &&
    !headers.has('Content-Type')
  ) {
    if (request.body.kind === 'json') headers.set('Content-Type', 'application/json');
    else if (request.body.kind === 'form')
      headers.set('Content-Type', 'application/x-www-form-urlencoded');
    else if (request.body.kind === 'text') headers.set('Content-Type', 'text/plain');
  }
  return headers;
}

/**
 * Build the outgoing fetch body. Returns `undefined` for `'none'`,
 * for `GET` / `HEAD` / `OPTIONS` (the editor hides the body field for
 * these methods), or for an empty content string.
 */
function buildRequestBody(
  request: HttpRequestV1
): { ok: true; body?: string } | { ok: false; message: string } {
  if (!request.body || request.body.kind === 'none') return { ok: true };
  if (
    request.method === 'GET' ||
    request.method === 'HEAD' ||
    request.method === 'OPTIONS'
  ) {
    return { ok: true };
  }
  const content = request.body.content ?? '';
  if (content.length === 0) return { ok: true };
  if (utf8ByteLength(content) > MAX_REQUEST_BODY_BYTES) {
    return { ok: false, message: 'Request body exceeds 1 MiB cap' };
  }
  return { ok: true, body: content };
}

/**
 * Run an HTTP request. Always settles to an `HttpResponseV1` — never
 * throws. The caller checks `response.kind` to dispatch on the
 * outcome.
 */
async function executeBrowserHttpRequest(
  request: HttpRequestV1,
  options: ExecuteHttpRequestOptions = {}
): Promise<HttpResponseV1> {
  const start = performance.now();
  const recordedAt = new Date().toISOString();
  const allowlist = options.userSensitiveHeaders ?? [];
  const bodyCap = options.maxResponseBodyBytes ?? MAX_RESPONSE_BODY_BYTES;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  // Validate URL early — `new URL()` throws on malformed input.
  try {
    new URL(request.url);
  } catch {
    return {
      version: 1,
      transport: request.transport ?? 'http',
      kind: 'network-error',
      status: 0,
      statusText: '',
      url: request.url,
      finalUrl: request.url,
      headers: [],
      body: '',
      contentType: '',
      sizeBytes: 0,
      durationMs: Math.round(performance.now() - start),
      tooLarge: false,
      redactedHeaders: [],
      recordedAt,
      errorMessage: 'Invalid URL',
    };
  }

  const requestBody = buildRequestBody(request);
  if (!requestBody.ok) {
    return {
      version: 1,
      transport: request.transport ?? 'http',
      kind: 'network-error',
      status: 0,
      statusText: '',
      url: request.url,
      finalUrl: request.url,
      headers: [],
      body: '',
      contentType: '',
      sizeBytes: 0,
      durationMs: Math.round(performance.now() - start),
      tooLarge: false,
      redactedHeaders: [],
      recordedAt,
      errorMessage: requestBody.message,
    };
  }

  // Compose the abort signal: caller's signal OR our timeout.
  // `AbortSignal.any` would be cleaner but is not yet ubiquitous;
  // a manual fan-in keeps the surface portable.
  const controller = new AbortController();
  const timeoutMs = Math.min(
    request.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    MAX_REQUEST_TIMEOUT_MS
  );
  const timeoutHandle: ReturnType<typeof setTimeout> = setTimeout(() => {
    controller.abort('timeout');
  }, timeoutMs);
  const onCallerAbort = (): void => {
    controller.abort(options.signal?.reason ?? 'cancelled');
  };
  if (options.signal) {
    if (options.signal.aborted) onCallerAbort();
    else options.signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  let response: Response;
  try {
    response = await fetchImpl(request.url, {
      method: request.method,
      headers: buildRequestHeaders(request, requestBody.body !== undefined),
      body: requestBody.body,
      signal: controller.signal,
      // `redirect: 'follow'` is the fetch default; pinned here for
      // clarity. `finalUrl` captures where we ultimately landed.
      redirect: 'follow',
    });
  } catch (err) {
    clearTimeout(timeoutHandle);
    if (options.signal) options.signal.removeEventListener('abort', onCallerAbort);
    const classified = classifyFetchError(err, controller.signal);
    return {
      version: 1,
      transport: request.transport ?? 'http',
      kind: classified.kind,
      status: 0,
      statusText: '',
      url: request.url,
      finalUrl: request.url,
      headers: [],
      body: '',
      contentType: '',
      sizeBytes: 0,
      durationMs: Math.round(performance.now() - start),
      tooLarge: false,
      redactedHeaders: [],
      recordedAt,
      errorMessage: classified.message,
    };
  }

  // Body reading happens AFTER fetch resolves — the headers + status
  // are already final at this point.
  let bodyResult: { text: string; size: number; tooLarge: boolean };
  try {
    bodyResult = await readBodyWithCap(
      response,
      bodyCap,
      request.transport === 'sse' ? options.onProgress : undefined,
      request.transport === 'sse' ? MAX_STREAM_MESSAGES : undefined
    );
  } catch (err) {
    clearTimeout(timeoutHandle);
    if (options.signal) options.signal.removeEventListener('abort', onCallerAbort);
    const classified = classifyFetchError(err, controller.signal);
    return {
      version: 1,
      transport: request.transport ?? 'http',
      kind: classified.kind,
      status: response.status,
      statusText: response.statusText,
      url: request.url,
      finalUrl: response.url || request.url,
      headers: [],
      body: '',
      contentType: response.headers.get('content-type') ?? '',
      sizeBytes: 0,
      durationMs: Math.round(performance.now() - start),
      tooLarge: false,
      redactedHeaders: [],
      recordedAt,
      errorMessage: classified.message,
    };
  }

  clearTimeout(timeoutHandle);
  if (options.signal) options.signal.removeEventListener('abort', onCallerAbort);

  const { headers, redactedHeaders } = buildRedactedHeaders(
    response.headers,
    allowlist
  );
  const contentType = response.headers.get('content-type') ?? '';
  const kind: HttpResponseKind = bodyResult.tooLarge
    ? 'too-large'
    : classifyResponseKind(response.status);

  return {
    version: 1,
    transport: request.transport ?? 'http',
    kind,
    status: response.status,
    statusText: response.statusText,
    url: request.url,
    finalUrl: response.url || request.url,
    headers,
    body: bodyResult.text,
    contentType,
    sizeBytes: bodyResult.size,
    durationMs: Math.round(performance.now() - start),
    tooLarge: bodyResult.tooLarge,
    redactedHeaders,
    recordedAt,
    ...(request.transport === 'sse'
      ? { messageCount: countSseEvents(bodyResult.text) }
      : {}),
  };
}

function browserWebSocketFailure(
  request: HttpRequestV1,
  kind: 'network-error' | 'timeout' | 'too-large',
  message: string,
  startedAt: number,
  body = '',
  sizeBytes = 0,
  messageCount = 0
): HttpResponseV1 {
  return {
    version: 1,
    transport: 'websocket',
    kind,
    status: 0,
    statusText: '',
    url: request.url,
    finalUrl: request.url,
    headers: [],
    body,
    contentType: 'application/websocket',
    sizeBytes,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    tooLarge: kind === 'too-large',
    redactedHeaders: [],
    recordedAt: new Date().toISOString(),
    errorMessage: message,
    messageCount,
  };
}

async function executeBrowserWebSocketRequest(
  request: HttpRequestV1,
  options: ExecuteHttpRequestOptions
): Promise<HttpResponseV1> {
  const startedAt = performance.now();
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return browserWebSocketFailure(
      request,
      'network-error',
      'Invalid URL',
      startedAt
    );
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    return browserWebSocketFailure(
      request,
      'network-error',
      `Unsupported URL scheme: ${url.protocol}`,
      startedAt
    );
  }
  if (composeRequestHeaders(request).length > 0) {
    return browserWebSocketFailure(
      request,
      'network-error',
      'Custom WebSocket headers require Lingua Desktop',
      startedAt
    );
  }
  const cap = options.maxResponseBodyBytes ?? MAX_RESPONSE_BODY_BYTES;
  const timeoutMs = Math.min(
    request.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    MAX_REQUEST_TIMEOUT_MS
  );
  return new Promise<HttpResponseV1>((resolve) => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      resolve(
        browserWebSocketFailure(
          request,
          'network-error',
          error instanceof Error ? error.message : String(error),
          startedAt
        )
      );
      return;
    }
    let settled = false;
    let opened = false;
    let sizeBytes = 0;
    let messageCount = 0;
    const messages: string[] = [];
    const body = (): string => messages.join('\n');
    const finish = (response: HttpResponseV1): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      resolve(response);
    };
    const emit = (): void =>
      options.onProgress?.({
        body: body(),
        sizeBytes,
        messageCount,
        opened,
      });
    const abort = (): void => {
      socket.close(1000, 'cancelled');
      finish(
        browserWebSocketFailure(
          request,
          'network-error',
          'Request cancelled',
          startedAt
        )
      );
    };
    const timer = window.setTimeout(() => {
      socket.close(1000, 'timeout');
      finish(
        browserWebSocketFailure(
          request,
          'timeout',
          'Request timed out',
          startedAt,
          body(),
          sizeBytes,
          messageCount
        )
      );
    }, timeoutMs);
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener('abort', abort, { once: true });
    socket.addEventListener('open', () => {
      opened = true;
      emit();
      const openingMessage = request.body?.content ?? '';
      if (openingMessage) socket.send(openingMessage);
    });
    socket.addEventListener('message', (event) => {
      const value =
        typeof event.data === 'string'
          ? event.data
          : `[binary message: ${event.data instanceof Blob ? event.data.size : event.data.byteLength} bytes]`;
      sizeBytes +=
        typeof event.data === 'string'
          ? utf8ByteLength(event.data)
          : event.data instanceof Blob
            ? event.data.size
            : event.data.byteLength;
      messageCount += 1;
      if (sizeBytes > cap || messageCount > MAX_STREAM_MESSAGES) {
        socket.close(1009, 'Lingua stream limit reached');
        finish(
          browserWebSocketFailure(
            request,
            'too-large',
            messageCount > MAX_STREAM_MESSAGES
              ? `Stream exceeds ${MAX_STREAM_MESSAGES} message cap`
              : 'Stream exceeds 4 MiB cap',
            startedAt,
            body(),
            sizeBytes,
            messageCount
          )
        );
        return;
      }
      messages.push(value);
      emit();
    });
    socket.addEventListener('error', () => {
      finish(
        browserWebSocketFailure(
          request,
          'network-error',
          'WebSocket connection failed',
          startedAt
        )
      );
    });
    socket.addEventListener('close', (event) => {
      if (!opened) {
        finish(
          browserWebSocketFailure(
            request,
            'network-error',
            'WebSocket closed before opening',
            startedAt
          )
        );
        return;
      }
      finish({
        version: 1,
        transport: 'websocket',
        kind: 'success',
        status: 101,
        statusText: 'Switching Protocols',
        url: request.url,
        finalUrl: request.url,
        headers: [],
        body: body(),
        contentType: 'application/websocket',
        sizeBytes,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        tooLarge: false,
        redactedHeaders: [],
        recordedAt: new Date().toISOString(),
        messageCount,
        closeCode: event.code,
        closeReason: event.reason,
      });
    });
  });
}

async function executeDesktopHttpRequest(
  request: HttpRequestV1,
  options: ExecuteHttpRequestOptions,
  bridge: NonNullable<LinguaAPI['http']>
): Promise<HttpResponseV1> {
  const runId = options.runId ?? crypto.randomUUID();
  const unsubscribe = bridge.onProgress((progress) => {
    if (progress.runId !== runId || progress.requestId !== request.id) return;
    options.onProgress?.(progress);
  });
  const abort = (): void => {
    void bridge.cancel(runId);
  };
  try {
    const execution = bridge.execute(runId, request, {
      allowPrivateHosts: options.allowPrivateHosts ?? false,
      userSensitiveHeaders: [...(options.userSensitiveHeaders ?? [])],
    });
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener('abort', abort, { once: true });
    return await execution;
  } finally {
    unsubscribe();
    options.signal?.removeEventListener('abort', abort);
  }
}

/** Platform transport dispatcher used by single sends and HTTP pipelines. */
export async function executeHttpRequest(
  request: HttpRequestV1,
  options: ExecuteHttpRequestOptions = {}
): Promise<HttpResponseV1> {
  const desktopBridge =
    options.fetchImpl === undefined && typeof window !== 'undefined'
      ? window.lingua?.http
      : undefined;
  if (desktopBridge) return executeDesktopHttpRequest(request, options, desktopBridge);
  if (request.transport === 'websocket') {
    return executeBrowserWebSocketRequest(request, options);
  }
  return executeBrowserHttpRequest(request, options);
}

/**
 * Helper: bucket the response's status for the telemetry payload.
 * `kind` already carries the closed-enum classification; this maps
 * the renderer `HttpResponseKind` to the telemetry `HttpStatusBucket`.
 * Mirrors the renderer + worker enum shapes.
 */
export function statusBucketForResponse(response: HttpResponseV1): HttpStatusBucket {
  if (response.kind === 'network-error') return 'network-error';
  if (response.kind === 'timeout') return 'timeout';
  if (response.kind === 'cors-error') return 'cors-error';
  // Both `success` and `too-large` map to their status buckets
  // (200 OK with too-large body still bubbles `'2xx'` at the
  // telemetry layer — the renderer surfaces the too-large badge
  // separately).
  return bucketHttpStatus(response.status);
}

/**
 * Helper exported for tests: confirm that the baseline list is
 * always merged into the user allowlist.
 */
export function effectiveSensitiveHeaderSet(
  userAllowlist: readonly string[]
): ReadonlySet<string> {
  const set = new Set<string>();
  for (const name of BASELINE_SENSITIVE_HEADERS) set.add(name);
  for (const name of userAllowlist) {
    if (typeof name === 'string' && name.trim().length > 0) {
      set.add(name.toLowerCase().trim());
    }
  }
  return set;
}
