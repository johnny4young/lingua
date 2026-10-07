/**
 * main-process HTTP proxy (SSRF-guarded).
 *
 * The renderer's `executeHttpRequest` (src/renderer/runtime/httpClient.ts)
 * runs inside the browser sandbox, so it is bound by the browser's CORS
 * policy: a request to an API that does not send `Access-Control-Allow-*`
 * headers fails with an opaque `cors-error`, even though the request is
 * perfectly legal. The desktop build can do better — Electron's main
 * process is a full Node runtime with no same-origin policy — but that
 * power is exactly what makes an unguarded proxy an SSRF liability: a
 * compromised renderer (or a malicious pasted request) could reach
 * `http://169.254.169.254/…` cloud metadata, `http://127.0.0.1:…`
 * loopback admin panels, or RFC 1918 LAN hosts the user never intended
 * to expose.
 *
 * This module is the guarded engine. It mirrors the renderer client's
 * `HttpResponseV1` envelope byte-for-byte (so the UI renders a proxied
 * response identically to a browser-fetched one) while adding:
 *
 *   - **SSRF guard** — every hop (initial URL + each redirect target) has
 *     its hostname DNS-resolved and every resolved address checked against
 *     the loopback / link-local / RFC 1918 / CGNAT / ULA / multicast
 *     denylists. Private targets are rejected UNLESS the caller opts in via
 *     `allowPrivateHosts` (a desktop Settings toggle, off by default).
 *   - **Scheme allowlist** — only `http:` / `https:`. No `file:`, `ftp:`,
 *     `data:`, etc.
 *   - **Manual redirect following** — `redirect: 'manual'` + a bounded loop
 *     that re-runs the SSRF guard on each `Location`, so a public URL cannot
 *     bounce the proxy onto a private host. Capped at `MAX_REDIRECTS`.
 *   - **Body cap + timeout + header redaction** — identical semantics to the
 *     renderer client.
 *
 * Production requests use a per-hop undici dispatcher whose lookup is pinned
 * to the exact addresses cleared by the guard. That closes the DNS-rebinding
 * gap between validation and socket dial; test-injected fetch implementations
 * remain deliberately unpinned behind the explicit test seam.
 *
 * This engine never throws — it always settles to an `HttpResponseV1`, with
 * blocked / failed outcomes surfaced through the `kind` + `errorMessage`
 * fields, exactly like the renderer client.
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import { Agent, fetch as undiciFetch } from 'undici';
import {
  authInjectedHeaderName,
  composeRequestHeaders,
  isHeaderSensitive,
} from '../shared/httpWorkspaceHeaders';
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  MAX_REQUEST_BODY_BYTES,
  MAX_REQUEST_TIMEOUT_MS,
  MAX_RESPONSE_BODY_BYTES,
  MAX_STREAM_MESSAGES,
  utf8ByteLength,
  type HttpRequestV1,
  type HttpResponseHeader,
  type HttpResponseKind,
  type HttpResponseV1,
} from '../shared/httpWorkspaceSchema';
import { createPinnedLookup } from './pinnedLookup';
import {
  SsrfBlockedError,
  resolveGuardedNetworkTarget,
  type LookupImpl,
  type NetworkTargetOptions,
} from './networkTargetPolicy';
// Historical imports remain valid while transports consume the neutral leaf.
export {
  isPrivateAddress,
  resolveGuardedNetworkTarget,
  type GuardedNetworkTarget,
  type LookupImpl,
} from './networkTargetPolicy';

/** Max redirect hops the proxy follows before giving up. */
const MAX_REDIRECTS = 10;

/**
 * Credential-bearing request headers browsers either own or treat specially
 * when a redirect crosses origins. The main-process proxy must strip these,
 * plus Lingua's user-configured sensitive headers, so a public→public redirect
 * cannot forward secrets to an unintended host. Lower-cased for
 * `Headers.delete` (case-insensitive, but keep the list canonical).
 */
const CROSS_ORIGIN_STRIP_HEADERS = [
  'authorization',
  'cookie',
  'proxy-authorization',
] as const;

export interface HttpProxyOptions extends NetworkTargetOptions {
  /** Additive Settings allowlist merged with the baseline sensitive names. */
  userSensitiveHeaders?: readonly string[];
  /** Caller-supplied abort signal (e.g. user-driven cancel). */
  signal?: AbortSignal;
  /** Test seam: override the global `fetch`. Production passes undefined. */
  fetchImpl?: typeof fetch;
  /** Test seam: override the response body cap. */
  maxResponseBodyBytes?: number;
  /** Test seam: override the redirect cap. */
  maxRedirects?: number;
  /** Live SSE preview. Called with bounded, already-decoded content. */
  onProgress?: (progress: {
    body: string;
    sizeBytes: number;
    messageCount: number;
    opened: boolean;
  }) => void;
}

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

// ---------------------------------------------------------------------------
// Body / header helpers (mirror src/renderer/runtime/httpClient.ts)
// ---------------------------------------------------------------------------

async function readBodyWithCap(
  response: Response,
  cap: number,
  onProgress?: HttpProxyOptions['onProgress'],
  maxMessages?: number
): Promise<{ text: string; size: number; tooLarge: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    const encoded = new TextEncoder().encode(text);
    const bytes = encoded.byteLength;
    let boundedText = text;
    let tooLarge = false;
    if (bytes > cap) {
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
  // Plain bodies are buffered and decoded once; only SSE needs a running view.
  if (!onProgress && maxMessages === undefined) {
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let tooLarge = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      const kept = totalBytes > cap ? value.subarray(0, value.byteLength - (totalBytes - cap)) : value;
      chunks.push(kept);
      if (totalBytes > cap) {
        tooLarge = true;
        await cancelReader(reader);
        break;
      }
    }
    const text = new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks));
    return { text, size: totalBytes, tooLarge };
  }

  const decoder = new TextDecoder('utf-8', { fatal: false });
  const events = new SseEventCounter();
  let totalBytes = 0;
  let tooLarge = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    const overCap = totalBytes > cap;
    const kept = overCap ? value.subarray(0, value.byteLength - (totalBytes - cap)) : value;
    // A capped stream ends here, so flush any character split at the cut.
    events.append(decoder.decode(kept, { stream: !overCap }));
    if (overCap) tooLarge = true;
    if (maxMessages !== undefined && events.count > maxMessages) {
      events.truncate(limitSseMessages(events.text, maxMessages).text);
      tooLarge = true;
    }
    onProgress?.({
      body: events.text,
      sizeBytes: Math.min(totalBytes, cap),
      messageCount: events.count,
      opened: true,
    });
    if (tooLarge) {
      await cancelReader(reader);
      break;
    }
  }
  if (!tooLarge) events.append(decoder.decode());
  return { text: events.text, size: totalBytes, tooLarge };
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    /* stream already finalised */
  }
}

/**
 * Counts SSE events as text arrives, matching `countSseEvents` on the whole
 * body without rescanning it per chunk. A boundary is at most four chars, so
 * only the tail of the previous text can complete one.
 */
class SseEventCounter {
  text = '';
  private segmentStart = 0;
  private completed = 0;
  private trailingContent = false;

  get count(): number {
    return this.completed + (this.trailingContent ? 1 : 0);
  }

  append(chunk: string): void {
    if (chunk.length === 0) return;
    const scanFrom = Math.max(this.segmentStart, this.text.length - 3);
    this.text += chunk;
    const boundary = /\r?\n\r?\n/gu;
    boundary.lastIndex = scanFrom;
    let found = false;
    for (let match = boundary.exec(this.text); match; match = boundary.exec(this.text)) {
      if (/\S/u.test(this.text.slice(this.segmentStart, match.index))) this.completed += 1;
      this.segmentStart = match.index + match[0].length;
      found = true;
    }
    this.trailingContent = found
      ? /\S/u.test(this.text.slice(this.segmentStart))
      : this.trailingContent || /\S/u.test(chunk);
  }

  truncate(text: string): void {
    this.text = '';
    this.segmentStart = 0;
    this.completed = 0;
    this.trailingContent = false;
    this.append(text);
  }
}

function countSseEvents(body: string): number {
  if (body.length === 0) return 0;
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

function buildRequestHeaders(request: HttpRequestV1, willSendBody: boolean): Headers {
  const headers = new Headers();
  for (const entry of composeRequestHeaders(request)) {
    try {
      headers.append(entry.name, entry.value);
    } catch {
      /* skip names the runtime rejects (e.g. newlines) */
    }
  }
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

function addHeaderName(out: Set<string>, name: string | null | undefined): void {
  const normalized = name?.trim().toLowerCase();
  if (normalized) out.add(normalized);
}

function crossOriginStripHeaderNames(
  request: HttpRequestV1,
  userAllowlist: readonly string[]
): string[] {
  const names = new Set<string>(CROSS_ORIGIN_STRIP_HEADERS);
  addHeaderName(names, authInjectedHeaderName(request.auth));
  for (const entry of composeRequestHeaders(request)) {
    if (isHeaderSensitive(entry.name, userAllowlist)) {
      addHeaderName(names, entry.name);
    }
  }
  return [...names];
}

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

function classifyResponseKind(status: number): HttpResponseKind {
  if (status >= 200 && status < 400) return 'success';
  if (status >= 400 && status < 500) return 'client-error';
  return 'server-error';
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/** Build a failure envelope with the shared shape. */
function failure(
  request: HttpRequestV1,
  kind: HttpResponseKind,
  errorMessage: string,
  start: number,
  recordedAt: string
): HttpResponseV1 {
  return {
    version: 1,
    transport: request.transport ?? 'http',
    kind,
    status: 0,
    statusText: '',
    url: request.url,
    finalUrl: request.url,
    headers: [],
    body: '',
    contentType: '',
    sizeBytes: 0,
    durationMs: Math.max(0, Math.round(Date.now() - start)),
    tooLarge: false,
    redactedHeaders: [],
    recordedAt,
    errorMessage,
  };
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/**
 * Run an HTTP request through the SSRF-guarded main-process proxy. Always
 * settles to an `HttpResponseV1` — never throws. Mirrors the renderer client's
 * envelope so the UI renders proxied and browser-fetched responses uniformly.
 */
export async function executeHttpProxyRequest(
  request: HttpRequestV1,
  options: HttpProxyOptions = {}
): Promise<HttpResponseV1> {
  const start = Date.now();
  const recordedAt = new Date(start).toISOString();
  const allowlist = options.userSensitiveHeaders ?? [];
  const allowPrivateHosts = options.allowPrivateHosts ?? false;
  const bodyCap = options.maxResponseBodyBytes ?? MAX_RESPONSE_BODY_BYTES;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const fetchImpl = options.fetchImpl;
  const lookupImpl: LookupImpl =
    options.lookupImpl ??
    ((hostname) => dnsLookup(hostname, { all: true }));

  if (!fetchImpl && typeof globalThis.fetch !== 'function') {
    return failure(
      request,
      'network-error',
      'Fetch is not available in this runtime',
      start,
      recordedAt
    );
  }

  const requestBody = buildRequestBody(request);
  if (!requestBody.ok) {
    return failure(request, 'network-error', requestBody.message, start, recordedAt);
  }

  const controller = new AbortController();
  const timeoutMs = Math.min(
    request.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    MAX_REQUEST_TIMEOUT_MS
  );
  const timeoutHandle = setTimeout(() => controller.abort('timeout'), timeoutMs);
  const onCallerAbort = (): void => {
    controller.abort(options.signal?.reason ?? 'cancelled');
  };
  if (options.signal) {
    if (options.signal.aborted) onCallerAbort();
    else options.signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  const cleanup = (): void => {
    clearTimeout(timeoutHandle);
    if (options.signal) options.signal.removeEventListener('abort', onCallerAbort);
  };

  const requestHeaders = buildRequestHeaders(request, requestBody.body !== undefined);
  const stripHeadersOnCrossOriginRedirect = crossOriginStripHeaderNames(
    request,
    allowlist
  );

  let currentUrl = request.url;
  // Method + body are mutable across hops: a redirect can downgrade them (see
  // the Fetch redirect rules applied below), so they must not be pinned to the
  // original request for every fetch.
  let currentMethod: string = request.method;
  let currentBody = requestBody.body;
  let response: Response;
  let finalDispatcher: Agent | null = null;
  let currentDispatcher: Agent | null | undefined;
  try {
    for (let hop = 0; ; hop += 1) {
      // Re-run the SSRF guard on every hop, including redirect targets.
      const target = await resolveGuardedNetworkTarget(
        currentUrl,
        HTTP_PROTOCOLS,
        allowPrivateHosts,
        lookupImpl
      );
      let hopDispatcher: Agent | null = null;
      if (fetchImpl) {
        response = await fetchImpl(currentUrl, {
          method: currentMethod,
          headers: requestHeaders,
          body: currentBody,
          signal: controller.signal,
          redirect: 'manual',
        });
      } else {
        // Pin the socket lookup to the exact addresses that passed the SSRF
        // guard. This closes the DNS-rebinding gap between validation and dial.
        // allowH2 stays off: undici 8 negotiates HTTP/2 by default, which would
        // silently change the protocol the HTTP workspace speaks to any TLS
        // server that offers it. tests/main/httpProxyDispatcher.test.ts pins it.
        hopDispatcher = new Agent({
          allowH2: false,
          connect: { lookup: createPinnedLookup(target.addresses) },
        });
        const serializedHeaders: Array<[string, string]> = [];
        requestHeaders.forEach((value, name) => {
          serializedHeaders.push([name, value]);
        });
        response = (await undiciFetch(currentUrl, {
          method: currentMethod,
          headers: serializedHeaders,
          body: currentBody,
          signal: controller.signal,
          redirect: 'manual',
          dispatcher: hopDispatcher,
        })) as unknown as Response;
        currentDispatcher = hopDispatcher;
      }

      if (!isRedirectStatus(response.status)) {
        finalDispatcher = hopDispatcher;
        currentDispatcher = null;
        break;
      }

      const location = response.headers.get('location');
      if (!location) {
        finalDispatcher = hopDispatcher;
        currentDispatcher = null;
        break; // redirect status without a target — treat as final
      }
      if (hop >= maxRedirects) {
        if (hopDispatcher) await hopDispatcher.close();
        currentDispatcher = null;
        cleanup();
        return failure(
          request,
          'network-error',
          `Exceeded maximum of ${maxRedirects} redirects`,
          start,
          recordedAt
        );
      }
      // Rewrite method/body per the Fetch redirect rules so the proxy never
      // re-sends the request body to a redirect target: 303 downgrades any
      // non-GET/HEAD method to GET; 301/302 downgrade POST to GET. 307/308
      // preserve method + body. When the body is dropped, so is Content-Type.
      if (
        (response.status === 303 &&
          currentMethod !== 'GET' &&
          currentMethod !== 'HEAD') ||
        ((response.status === 301 || response.status === 302) &&
          currentMethod === 'POST')
      ) {
        currentMethod = 'GET';
        if (currentBody !== undefined) {
          currentBody = undefined;
          requestHeaders.delete('Content-Type');
        }
      }
      // Resolve relative Location against the current URL.
      const nextUrl = new URL(location, currentUrl);
      // Strip credential headers once the chain leaves the current origin, so
      // a redirect to a different (even public) host cannot exfiltrate the
      // user's Authorization / Cookie / API-key style secrets. Deleted in
      // place, so once dropped they stay dropped for every subsequent hop.
      if (nextUrl.origin !== new URL(currentUrl).origin) {
        for (const name of stripHeadersOnCrossOriginRedirect) {
          try {
            requestHeaders.delete(name);
          } catch {
            /* ignore names the runtime would not accept as headers anyway */
          }
        }
      }
      currentUrl = nextUrl.toString();
      // Drain the redirect body so the socket can be reused.
      try {
        await response.body?.cancel();
      } catch {
        /* already finalised */
      }
      if (hopDispatcher) await hopDispatcher.close();
      currentDispatcher = null;
    }
  } catch (err) {
    if (currentDispatcher) await currentDispatcher.close();
    if (finalDispatcher) await finalDispatcher.close();
    cleanup();
    if (err instanceof SsrfBlockedError) {
      return failure(request, 'network-error', err.message, start, recordedAt);
    }
    if (controller.signal.aborted && controller.signal.reason === 'timeout') {
      return failure(request, 'timeout', 'Request timed out', start, recordedAt);
    }
    const message = err instanceof Error ? err.message : String(err ?? 'fetch failed');
    return failure(request, 'network-error', message, start, recordedAt);
  }

  let bodyResult: { text: string; size: number; tooLarge: boolean };
  try {
    bodyResult = await readBodyWithCap(
      response,
      bodyCap,
      request.transport === 'sse' ? options.onProgress : undefined,
      request.transport === 'sse' ? MAX_STREAM_MESSAGES : undefined
    );
  } catch (err) {
    if (finalDispatcher) await finalDispatcher.close();
    cleanup();
    if (controller.signal.aborted && controller.signal.reason === 'timeout') {
      return failure(request, 'timeout', 'Request timed out', start, recordedAt);
    }
    const message = err instanceof Error ? err.message : String(err ?? 'read failed');
    return failure(request, 'network-error', message, start, recordedAt);
  }

  cleanup();
  if (finalDispatcher) await finalDispatcher.close();

  const { headers, redactedHeaders } = buildRedactedHeaders(response.headers, allowlist);
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
    finalUrl: response.url || currentUrl,
    headers,
    body: bodyResult.text,
    contentType,
    sizeBytes: bodyResult.size,
    durationMs: Math.max(0, Math.round(Date.now() - start)),
    tooLarge: bodyResult.tooLarge,
    redactedHeaders,
    recordedAt,
    ...(request.transport === 'sse'
      ? { messageCount: countSseEvents(bodyResult.text) }
      : {}),
  };
}
