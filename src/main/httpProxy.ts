/**
 * RL-097 T7 — main-process HTTP proxy (SSRF-guarded).
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
 * Residual risk (documented, not yet mitigated): DNS rebinding TOCTOU. The
 * guard resolves the hostname, then `fetch` resolves it again independently,
 * so a hostile resolver could return a public address to the guard and a
 * private one to `fetch`. Closing this requires pinning the resolved IP into
 * a custom undici dispatcher; tracked as a follow-up. The guard still blocks
 * the overwhelming majority of real-world SSRF (literal private URLs,
 * redirect-to-private, and static DNS pointing at private space).
 *
 * This engine never throws — it always settles to an `HttpResponseV1`, with
 * blocked / failed outcomes surfaced through the `kind` + `errorMessage`
 * fields, exactly like the renderer client.
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  MAX_REQUEST_BODY_BYTES,
  MAX_REQUEST_TIMEOUT_MS,
  MAX_RESPONSE_BODY_BYTES,
  composeRequestHeaders,
  isHeaderSensitive,
  utf8ByteLength,
  type HttpRequestV1,
  type HttpResponseHeader,
  type HttpResponseKind,
  type HttpResponseV1,
} from '../shared/httpWorkspace';

/** Max redirect hops the proxy follows before giving up. */
export const MAX_REDIRECTS = 10;

/**
 * Credential-bearing request headers browsers drop when a redirect crosses
 * origins (Fetch §"HTTP-redirect fetch"). The renderer client this engine
 * replaces gets this for free from the browser; the main-process proxy must
 * mirror it so a public→public redirect cannot forward the user's
 * `Authorization` / `Cookie` to an unintended host. Lower-cased for
 * `Headers.delete` (case-insensitive, but keep the list canonical).
 */
const CROSS_ORIGIN_STRIP_HEADERS = [
  'authorization',
  'cookie',
  'proxy-authorization',
] as const;

/** Node's `dns.lookup` result shape (subset we consume). */
interface LookupAddress {
  address: string;
  family: number;
}

/** Test seam: the DNS lookup used by the SSRF guard. */
export type LookupImpl = (
  hostname: string
) => Promise<LookupAddress[]>;

export interface HttpProxyOptions {
  /** Additive Settings allowlist merged with the baseline sensitive names. */
  userSensitiveHeaders?: readonly string[];
  /**
   * When true, the SSRF guard is bypassed for private / loopback / link-local
   * targets. Wired to a desktop-only Settings toggle (off by default). The
   * scheme allowlist still applies.
   */
  allowPrivateHosts?: boolean;
  /** Caller-supplied abort signal (e.g. user-driven cancel). */
  signal?: AbortSignal;
  /** Test seam: override the global `fetch`. Production passes undefined. */
  fetchImpl?: typeof fetch;
  /** Test seam: override the DNS lookup. Production passes undefined. */
  lookupImpl?: LookupImpl;
  /** Test seam: override the response body cap. */
  maxResponseBodyBytes?: number;
  /** Test seam: override the redirect cap. */
  maxRedirects?: number;
}

/**
 * Thrown internally when the SSRF guard rejects a hop. Caught in the top-level
 * executor and mapped to a `network-error` response with the guard message.
 */
class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

// ---------------------------------------------------------------------------
// Private-address detection
// ---------------------------------------------------------------------------

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/u.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return true; // unparseable → treat as unsafe
  const inRange = (base: string, prefix: number): boolean => {
    const baseInt = ipv4ToInt(base);
    if (baseInt === null) return false;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (baseInt & mask);
  };
  return (
    inRange('0.0.0.0', 8) || // "this" network / unspecified
    inRange('10.0.0.0', 8) || // RFC 1918
    inRange('100.64.0.0', 10) || // CGNAT (RFC 6598)
    inRange('127.0.0.0', 8) || // loopback
    inRange('169.254.0.0', 16) || // link-local (incl. cloud metadata 169.254.169.254)
    inRange('172.16.0.0', 12) || // RFC 1918
    inRange('192.0.0.0', 24) || // IETF protocol assignments
    inRange('192.0.2.0', 24) || // TEST-NET-1
    inRange('192.168.0.0', 16) || // RFC 1918
    inRange('198.18.0.0', 15) || // benchmarking
    inRange('198.51.100.0', 24) || // TEST-NET-2
    inRange('203.0.113.0', 24) || // TEST-NET-3
    inRange('224.0.0.0', 4) || // multicast
    inRange('240.0.0.0', 4) // reserved / broadcast
  );
}

/**
 * Expand an IPv6 literal (zone already stripped, lower-cased) to its eight
 * 16-bit hextets, or `null` if it does not parse. Handles `::` compression and
 * a trailing dotted-quad tail (`::ffff:1.2.3.4`). Parsing to numbers — rather
 * than string-matching one textual form — is what lets the SSRF guard classify
 * IPv4-mapped loopback written in ANY form (`::ffff:127.0.0.1`, `::ffff:7f00:1`,
 * or fully expanded) by the embedded IPv4 the socket actually dials.
 */
function ipv6Hextets(addr: string): number[] | null {
  let s = addr;
  const dotted = s.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/u);
  if (dotted && dotted.index !== undefined) {
    const v = ipv4ToInt(dotted[1]!);
    if (v === null) return null;
    s = `${s.slice(0, dotted.index)}${((v >>> 16) & 0xffff).toString(16)}:${(v & 0xffff).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const toParts = (part: string): number[] =>
    part === '' ? [] : part.split(':').map((h) => parseInt(h, 16));
  const head = toParts(halves[0] ?? '');
  const tail = halves.length === 2 ? toParts(halves[1] ?? '') : null;
  let hextets: number[];
  if (tail === null) {
    hextets = head;
  } else {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    hextets = [...head, ...Array<number>(fill).fill(0), ...tail];
  }
  if (hextets.length !== 8) return null;
  if (hextets.some((h) => Number.isNaN(h) || h < 0 || h > 0xffff)) return null;
  return hextets;
}

function embeddedIPv4(hextets: number[]): string {
  const hi = hextets[6]!;
  const lo = hextets[7]!;
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().split('%')[0] ?? ip.toLowerCase(); // strip zone id
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  const hextets = ipv6Hextets(lower);
  if (!hextets) return true; // unparseable → treat as unsafe
  // IPv4-mapped (::ffff:0:0/96) in ANY textual form — the low 32 bits are the
  // IPv4 target the socket connects to, so classify by that embedded address.
  if (hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff) {
    return isPrivateIPv4(embeddedIPv4(hextets));
  }
  // IPv4-compatible (::a.b.c.d, deprecated but still routable) — same embed.
  if (hextets.slice(0, 6).every((h) => h === 0)) {
    return isPrivateIPv4(embeddedIPv4(hextets));
  }
  const head = hextets[0]!;
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((head & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/**
 * True when `ip` (a literal, already validated by `isIP`) falls in a range the
 * proxy must not reach without explicit opt-in.
 */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true; // not a valid IP literal → unsafe
}

/**
 * Resolve `hostname` and reject if ANY resolved address is private. An IP
 * literal is checked directly (no DNS round-trip). Throws `SsrfBlockedError`
 * on rejection; resolves silently when the target is public (or opted in).
 */
async function assertHostAllowed(
  rawHostname: string,
  allowPrivateHosts: boolean,
  lookupImpl: LookupImpl
): Promise<void> {
  if (allowPrivateHosts) return;

  // WHATWG `URL` keeps the square brackets on an IPv6 host (`[::1]`), and
  // `isIP('[::1]')` is 0 — so without stripping them the literal is misread as a
  // DNS name and never reaches the IPv6 private-range check (the guard would
  // then rely on DNS accidentally failing). Strip once, up front.
  const hostname =
    rawHostname.startsWith('[') && rawHostname.endsWith(']')
      ? rawHostname.slice(1, -1)
      : rawHostname;

  const literalFamily = isIP(hostname);
  if (literalFamily !== 0) {
    if (isPrivateAddress(hostname)) {
      throw new SsrfBlockedError(
        `Blocked request to private address ${hostname}`
      );
    }
    return;
  }

  // `localhost` and friends may resolve to loopback via /etc/hosts; the DNS
  // resolution below catches those, but we also fast-path the obvious name.
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new SsrfBlockedError('Blocked request to localhost');
  }

  let addresses: LookupAddress[];
  try {
    addresses = await lookupImpl(hostname);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new SsrfBlockedError(`DNS resolution failed for ${hostname}: ${message}`);
  }
  if (addresses.length === 0) {
    throw new SsrfBlockedError(`DNS resolution returned no addresses for ${hostname}`);
  }
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new SsrfBlockedError(
        `Blocked request to ${hostname} — resolves to private address ${address}`
      );
    }
  }
}

/** Validate scheme + run the SSRF guard for a single URL. */
async function guardUrl(
  rawUrl: string,
  allowPrivateHosts: boolean,
  lookupImpl: LookupImpl
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfBlockedError(`Unsupported URL scheme: ${url.protocol}`);
  }
  await assertHostAllowed(url.hostname, allowPrivateHosts, lookupImpl);
  return url;
}

// ---------------------------------------------------------------------------
// Body / header helpers (mirror src/renderer/runtime/httpClient.ts)
// ---------------------------------------------------------------------------

async function readBodyWithCap(
  response: Response,
  cap: number
): Promise<{ text: string; size: number; tooLarge: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    const encoded = new TextEncoder().encode(text);
    const bytes = encoded.byteLength;
    if (bytes > cap) {
      const trimmed = new TextDecoder('utf-8', { fatal: false }).decode(
        encoded.subarray(0, cap)
      );
      return { text: trimmed, size: bytes, tooLarge: true };
    }
    return { text, size: bytes, tooLarge: false };
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let tooLarge = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      totalBytes += value.byteLength;
      if (totalBytes > cap) {
        const overshoot = totalBytes - cap;
        chunks.push(value.subarray(0, value.byteLength - overshoot));
        tooLarge = true;
        try {
          await reader.cancel();
        } catch {
          /* stream already finalised */
        }
        break;
      }
      chunks.push(value);
    }
  }
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
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const lookupImpl: LookupImpl =
    options.lookupImpl ??
    ((hostname) => dnsLookup(hostname, { all: true }));

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

  let currentUrl = request.url;
  // Method + body are mutable across hops: a redirect can downgrade them (see
  // the Fetch redirect rules applied below), so they must not be pinned to the
  // original request for every fetch.
  let currentMethod: string = request.method;
  let currentBody = requestBody.body;
  let response: Response;
  try {
    for (let hop = 0; ; hop += 1) {
      // Re-run the SSRF guard on every hop, including redirect targets.
      await guardUrl(currentUrl, allowPrivateHosts, lookupImpl);

      response = await fetchImpl(currentUrl, {
        method: currentMethod,
        headers: requestHeaders,
        body: currentBody,
        signal: controller.signal,
        redirect: 'manual',
      });

      if (!isRedirectStatus(response.status)) break;

      const location = response.headers.get('location');
      if (!location) break; // redirect status without a target — treat as final
      if (hop >= maxRedirects) {
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
      // user's Authorization / Cookie. Deleted in place, so once dropped they
      // stay dropped for every subsequent hop.
      if (nextUrl.origin !== new URL(currentUrl).origin) {
        for (const name of CROSS_ORIGIN_STRIP_HEADERS) requestHeaders.delete(name);
      }
      currentUrl = nextUrl.toString();
      // Drain the redirect body so the socket can be reused.
      try {
        await response.body?.cancel();
      } catch {
        /* already finalised */
      }
    }
  } catch (err) {
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
    bodyResult = await readBodyWithCap(response, bodyCap);
  } catch (err) {
    cleanup();
    if (controller.signal.aborted && controller.signal.reason === 'timeout') {
      return failure(request, 'timeout', 'Request timed out', start, recordedAt);
    }
    const message = err instanceof Error ? err.message : String(err ?? 'read failed');
    return failure(request, 'network-error', message, start, recordedAt);
  }

  cleanup();

  const { headers, redactedHeaders } = buildRedactedHeaders(response.headers, allowlist);
  const contentType = response.headers.get('content-type') ?? '';
  const kind: HttpResponseKind = bodyResult.tooLarge
    ? 'too-large'
    : classifyResponseKind(response.status);

  return {
    version: 1,
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
  };
}
