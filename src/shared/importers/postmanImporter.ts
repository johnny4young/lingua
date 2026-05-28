/**
 * RL-100 Slice 3 — Postman Collection v2.1 → HTTP requests importer.
 *
 * Parses a Postman Collection v2.1 JSON export (`{ info, item }`) into
 * a flat list of Lingua `HttpRequestV1`-shaped requests. Folders are
 * flattened depth-first and their names prefix the request label
 * (`Folder / Sub / Request`). The adapter is intentionally lossy —
 * Postman's scripting, auth helpers, environment variables, and
 * non-text body modes have no HTTP-workspace equivalent, so each is
 * surfaced as a closed-enum `ImporterLossyWarning` rather than
 * silently dropped.
 *
 * Design boundaries (per the 2026-05-28 plan):
 *
 *   - Pure parser. Renderer + shared only; NO IPC, NO network.
 *   - Closed-enum outcome with `POSTMAN_REJECT_REASONS` carried in the
 *     `detail` slot so the generic `IMPORTER_REJECT_REASONS` taxonomy
 *     stays uniform across importers.
 *   - Multiple requests per source — unlike cURL (1 request) and
 *     `.ipynb` (1 notebook). The shared `CollectionImporterPreview`
 *     shape is also produced by the Bruno adapter so the
 *     `useImportPreview` confirm path + `<ImportPreviewBody>` collection
 *     band handle both uniformly.
 *   - Sensitive header VALUES never reach the preview band — the
 *     collection list renders header COUNTS only (with a redaction
 *     badge), and the originals round-trip on confirm.
 *   - Caps: `MAX_IMPORT_REQUESTS` requests are imported; extras are
 *     truncated (NOT a reject — a partial import is still useful) and
 *     reported via `counts.truncated`.
 */

import {
  HTTP_METHODS,
  utf8ByteLength,
  type HttpMethod,
  type HttpRequestBody,
  type HttpRequestBodyKind,
  type HttpRequestHeader,
} from '../httpWorkspace';
import type {
  ImporterAdapter,
  ImporterLossyWarning,
  ImporterPreviewOutcome,
  PostmanRejectReason,
} from './types';

// ---------------------------------------------------------------------------
// Shared collection shapes (also produced by the Bruno adapter)
// ---------------------------------------------------------------------------

/**
 * One parsed request from a collection, in the same persistence-free
 * shape as `ParsedCurl`. The `useImportPreview` confirm path mints a
 * `HttpRequestV1` from each via `createBlankHttpRequest`. `headers`
 * carries the ORIGINAL (un-redacted) values — they round-trip on
 * confirm; the preview band only ever shows header COUNTS.
 */
export interface ParsedCollectionRequest {
  readonly name: string;
  readonly method: HttpMethod;
  readonly url: string;
  readonly headers: ReadonlyArray<HttpRequestHeader>;
  readonly body?: HttpRequestBody;
}

/** Source family — drives the preview badge + telemetry importer id. */
export type CollectionSource = 'postman' | 'bruno';

/**
 * Preview shape shared by the Postman + Bruno adapters. The
 * discriminator `kind: 'http-collection'` lets `<ImportPreviewBody>`
 * branch once for both; `source` picks the badge label. `requests`
 * carries the full parsed list (original header values) for the
 * confirm round-trip.
 */
export interface CollectionImporterPreview {
  readonly kind: 'http-collection';
  readonly source: CollectionSource;
  /** Collection title (from `info.name` / Bruno `meta.name`). */
  readonly title: string;
  /** Flattened request list, capped at `MAX_IMPORT_REQUESTS`. */
  readonly requests: ReadonlyArray<ParsedCollectionRequest>;
  /** Summary counts for the fold-B/D chip. */
  readonly counts: {
    /** Requests that will be imported (== `requests.length`). */
    readonly total: number;
    /** Distinct folders walked (Postman only; 0 for Bruno). */
    readonly folders: number;
    /** Requests dropped because the collection exceeded the cap. */
    readonly truncated: number;
  };
  readonly warnings: ReadonlyArray<ImporterLossyWarning>;
}

/** Commit shape — `import(preview)` hands this back to the caller. */
export interface CollectionImporterResult {
  readonly source: CollectionSource;
  readonly title: string;
  readonly requests: ReadonlyArray<ParsedCollectionRequest>;
}

/**
 * Hard cap on requests imported from a single collection. A Postman
 * collection larger than this is truncated (the first N survive) with
 * a `counts.truncated` count surfaced to the UI — never a reject, so a
 * partial import of a huge collection is still useful.
 */
export const MAX_IMPORT_REQUESTS = 100;

/**
 * Defensive byte cap on the raw source before `JSON.parse`, so a
 * pathological multi-megabyte paste cannot stall the renderer. 4 MiB
 * comfortably fits any realistic collection export.
 */
export const MAX_COLLECTION_BYTES = 4 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Detect
// ---------------------------------------------------------------------------

/**
 * Probe: does this look like a Postman Collection v2.x JSON? Cheap
 * substring sniff over the first 4 KiB (whitespace-stripped) — must
 * start with `{` and mention BOTH `"info"` and `"item"`, which only
 * the collection schema pairs. File extension is not trusted.
 */
function detectPostman(source: string): boolean {
  if (typeof source !== 'string') return false;
  const probe = source.slice(0, 4096).replace(/\s+/g, '');
  if (!probe.startsWith('{')) return false;
  return probe.includes('"info"') && probe.includes('"item"');
}

// ---------------------------------------------------------------------------
// Reject helper
// ---------------------------------------------------------------------------

function rejectPostman(
  detail: PostmanRejectReason
): ImporterPreviewOutcome<CollectionImporterPreview> {
  const reason =
    detail === 'malformed-json' || detail === 'invalid-shape'
      ? 'malformed'
      : 'unsupported-feature';
  return { ok: false, reason, detail };
}

// ---------------------------------------------------------------------------
// Raw Postman shapes (defensive — every field is `unknown` until checked)
// ---------------------------------------------------------------------------

interface RawPostmanHeader {
  key?: unknown;
  value?: unknown;
  disabled?: unknown;
}

interface RawPostmanQueryParam {
  key?: unknown;
  value?: unknown;
  disabled?: unknown;
}

interface RawPostmanItem {
  name?: unknown;
  item?: unknown;
  request?: unknown;
  event?: unknown;
  auth?: unknown;
}

// ---------------------------------------------------------------------------
// URL reconstruction
// ---------------------------------------------------------------------------

/**
 * Postman stores `request.url` as EITHER a plain string OR an object
 * `{ raw, protocol, host[], path[], query[] }`. Prefer `raw` when
 * present; otherwise reconstruct from the parts.
 */
function reconstructUrl(rawUrl: unknown): string {
  if (typeof rawUrl === 'string') return rawUrl;
  if (rawUrl === null || typeof rawUrl !== 'object') return '';
  const obj = rawUrl as Record<string, unknown>;
  if (typeof obj.raw === 'string' && obj.raw.length > 0) return obj.raw;
  const protocol = typeof obj.protocol === 'string' ? obj.protocol : 'https';
  const host = Array.isArray(obj.host)
    ? obj.host.filter((h): h is string => typeof h === 'string').join('.')
    : typeof obj.host === 'string'
      ? obj.host
      : '';
  const path = Array.isArray(obj.path)
    ? obj.path.filter((p): p is string => typeof p === 'string').join('/')
    : typeof obj.path === 'string'
      ? obj.path
      : '';
  const query = Array.isArray(obj.query)
    ? obj.query
        .filter(
          (q): q is RawPostmanQueryParam =>
            q !== null && typeof q === 'object'
        )
        .filter((q) => q.disabled !== true)
        .map((q) => {
          const k = typeof q.key === 'string' ? q.key : '';
          const v = typeof q.value === 'string' ? q.value : '';
          return k.length > 0 ? `${k}=${v}` : '';
        })
        .filter((s) => s.length > 0)
        .join('&')
    : '';
  if (host.length === 0) return '';
  const base = `${protocol}://${host}${path.length > 0 ? `/${path}` : ''}`;
  return query.length > 0 ? `${base}?${query}` : base;
}

// ---------------------------------------------------------------------------
// Header + body + auth mapping
// ---------------------------------------------------------------------------

function mapHeaders(rawHeaders: unknown): HttpRequestHeader[] {
  if (!Array.isArray(rawHeaders)) return [];
  const headers: HttpRequestHeader[] = [];
  for (const raw of rawHeaders) {
    if (raw === null || typeof raw !== 'object') continue;
    const h = raw as RawPostmanHeader;
    const name = typeof h.key === 'string' ? h.key.trim() : '';
    if (name.length === 0) continue;
    const value = typeof h.value === 'string' ? h.value : '';
    // Disabled headers are PRESERVED as `enabled: false` (the user can
    // re-enable them in the editor) rather than dropped — no loss, no
    // warning.
    headers.push({ name, value, enabled: h.disabled === true ? false : true });
  }
  return headers;
}

function isHttpMethod(value: string): value is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(value.toUpperCase());
}

/**
 * Map a Postman `request.body` block to a Lingua `HttpRequestBody`.
 * Lossy modes push a warning into `warningSink`.
 */
function mapBody(
  rawBody: unknown,
  warningSink: Set<ImporterLossyWarning>
): HttpRequestBody | undefined {
  if (rawBody === null || typeof rawBody !== 'object') return undefined;
  const body = rawBody as Record<string, unknown>;
  const mode = typeof body.mode === 'string' ? body.mode : '';
  if (mode === 'raw') {
    const content = typeof body.raw === 'string' ? body.raw : '';
    if (content.length === 0) return undefined;
    return { kind: detectRawBodyKind(content), content };
  }
  if (mode === 'urlencoded') {
    const content = serializeUrlEncoded(body.urlencoded);
    if (content.length === 0) return undefined;
    return { kind: 'form', content };
  }
  if (mode === 'graphql') {
    warningSink.add('postman-graphql-body');
    const gql =
      body.graphql !== null && typeof body.graphql === 'object'
        ? (body.graphql as Record<string, unknown>)
        : {};
    const query = typeof gql.query === 'string' ? gql.query : '';
    if (query.length === 0) return undefined;
    return { kind: 'text', content: query };
  }
  if (mode === 'formdata') {
    warningSink.add('postman-formdata-file');
    const content = serializeFormData(body.formdata, warningSink);
    if (content.length === 0) return undefined;
    return { kind: 'form', content };
  }
  if (mode === 'file') {
    // File-upload body — not importable. Warn + drop.
    warningSink.add('postman-formdata-file');
    return undefined;
  }
  return undefined;
}

function detectRawBodyKind(content: string): HttpRequestBodyKind {
  try {
    JSON.parse(content);
    return 'json';
  } catch {
    return 'text';
  }
}

function serializeUrlEncoded(raw: unknown): string {
  if (!Array.isArray(raw)) return '';
  return raw
    .filter((p): p is RawPostmanHeader => p !== null && typeof p === 'object')
    .filter((p) => p.disabled !== true)
    .map((p) => {
      const k = typeof p.key === 'string' ? p.key : '';
      const v = typeof p.value === 'string' ? p.value : '';
      if (k.length === 0) return '';
      return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
    })
    .filter((s) => s.length > 0)
    .join('&');
}

function serializeFormData(
  raw: unknown,
  warningSink: Set<ImporterLossyWarning>
): string {
  if (!Array.isArray(raw)) return '';
  const pairs: string[] = [];
  for (const part of raw) {
    if (part === null || typeof part !== 'object') continue;
    const p = part as RawPostmanHeader & { type?: unknown };
    if (p.disabled === true) continue;
    if (p.type === 'file') {
      warningSink.add('postman-formdata-file');
      continue;
    }
    const k = typeof p.key === 'string' ? p.key : '';
    const v = typeof p.value === 'string' ? p.value : '';
    if (k.length === 0) continue;
    pairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return pairs.join('&');
}

/**
 * Flatten a Postman `auth` block into a single header when we can
 * (bearer → `Authorization: Bearer <token>`). Anything else (basic
 * without both parts, apikey, oauth, etc.) is surfaced as a warning;
 * the user can add the header manually. Returns the header to append,
 * or `null`.
 */
function mapAuthToHeader(
  rawAuth: unknown,
  warningSink: Set<ImporterLossyWarning>
): HttpRequestHeader | null {
  if (rawAuth === null || typeof rawAuth !== 'object') return null;
  const auth = rawAuth as Record<string, unknown>;
  const type = typeof auth.type === 'string' ? auth.type : '';
  if (type === 'noauth' || type === '') return null;
  if (type === 'bearer') {
    const token = readAuthParam(auth.bearer, 'token');
    if (token !== null) {
      return {
        name: 'Authorization',
        value: `Bearer ${token}`,
        enabled: true,
      };
    }
  }
  if (type === 'apikey') {
    const key = readAuthParam(auth.apikey, 'key');
    const value = readAuthParam(auth.apikey, 'value');
    const addTo = readAuthParam(auth.apikey, 'in');
    if (key !== null && value !== null && addTo !== 'query') {
      return { name: key, value, enabled: true };
    }
  }
  // basic / oauth1 / oauth2 / digest / awsv4 / etc. — not flattenable
  // to a single deterministic header. Warn + leave to the user.
  warningSink.add('postman-auth-helper');
  return null;
}

/**
 * Postman stores auth params as an array of `{ key, value, type }` in
 * v2.1 (older exports use an object). Read a named param from either.
 */
function readAuthParam(raw: unknown, name: string): string | null {
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (entry === null || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      if (e.key === name && typeof e.value === 'string') return e.value;
    }
    return null;
  }
  if (raw !== null && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    return typeof obj[name] === 'string' ? (obj[name] as string) : null;
  }
  return null;
}

const VARIABLE_PATTERN = /\{\{[^}]+\}\}/;

function mentionsVariable(text: string): boolean {
  return VARIABLE_PATTERN.test(text);
}

// ---------------------------------------------------------------------------
// Item walk (folders + requests, depth-first)
// ---------------------------------------------------------------------------

interface WalkState {
  readonly requests: ParsedCollectionRequest[];
  folders: number;
  truncated: number;
  readonly warnings: Set<ImporterLossyWarning>;
}

function walkItems(
  items: ReadonlyArray<unknown>,
  pathPrefix: string,
  state: WalkState,
  inheritedAuth: unknown
): void {
  for (const rawItem of items) {
    if (rawItem === null || typeof rawItem !== 'object') continue;
    const item = rawItem as RawPostmanItem;
    const name = typeof item.name === 'string' ? item.name : '';
    const itemAuth = item.auth !== undefined ? item.auth : inheritedAuth;
    if (Array.isArray(item.item)) {
      scanItemScripts(item.event, state.warnings);
      // Folder — recurse with the name prefixed.
      state.folders += 1;
      const nextPrefix =
        name.length > 0
          ? pathPrefix.length > 0
            ? `${pathPrefix} / ${name}`
            : name
          : pathPrefix;
      walkItems(item.item, nextPrefix, state, itemAuth);
      continue;
    }
    if (item.request === undefined) continue;
    // Leaf request.
    if (state.requests.length >= MAX_IMPORT_REQUESTS) {
      state.truncated += 1;
      continue;
    }
    const parsed = mapRequestItem(
      item,
      name,
      pathPrefix,
      state.warnings,
      itemAuth
    );
    if (parsed !== null) state.requests.push(parsed);
  }
}

function mapRequestItem(
  item: RawPostmanItem,
  name: string,
  pathPrefix: string,
  warningSink: Set<ImporterLossyWarning>,
  inheritedAuth: unknown
): ParsedCollectionRequest | null {
  // `request` is usually an object; a bare string is a GET URL shorthand.
  const rawRequest = item.request;
  let method: HttpMethod = 'GET';
  let url: string;
  let headers: HttpRequestHeader[] = [];
  let body: HttpRequestBody | undefined;
  let authSource = inheritedAuth;

  if (typeof rawRequest === 'string') {
    url = rawRequest;
  } else if (rawRequest !== null && typeof rawRequest === 'object') {
    const req = rawRequest as Record<string, unknown>;
    const rawMethod = typeof req.method === 'string' ? req.method : 'GET';
    method = isHttpMethod(rawMethod) ? (rawMethod.toUpperCase() as HttpMethod) : 'GET';
    url = reconstructUrl(req.url);
    headers = mapHeaders(req.header);
    body = mapBody(req.body, warningSink);
    authSource = req.auth !== undefined ? req.auth : inheritedAuth;
  } else {
    return null;
  }

  if (url.length === 0) return null;

  const authHeader = mapAuthToHeader(authSource, warningSink);
  if (
    authHeader !== null &&
    !headers.some((h) => h.name.toLowerCase() === authHeader.name.toLowerCase())
  ) {
    headers.push(authHeader);
  }

  // Variable + script lossy-warning scan.
  if (
    mentionsVariable(url) ||
    headers.some((h) => mentionsVariable(h.value) || mentionsVariable(h.name)) ||
    (body?.content !== undefined && mentionsVariable(body.content))
  ) {
    warningSink.add('postman-variable');
  }
  scanItemScripts(item.event, warningSink);

  const label =
    pathPrefix.length > 0
      ? `${pathPrefix} / ${name.length > 0 ? name : method}`
      : name.length > 0
        ? name
        : `${method} ${url}`;

  return {
    name: label.slice(0, 120),
    method,
    url,
    headers,
    ...(body ? { body } : {}),
  };
}

function scanItemScripts(
  rawEvent: unknown,
  warningSink: Set<ImporterLossyWarning>
): void {
  if (!Array.isArray(rawEvent)) return;
  for (const entry of rawEvent) {
    if (entry === null || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const listen = typeof e.listen === 'string' ? e.listen : '';
    const script =
      e.script !== null && typeof e.script === 'object'
        ? (e.script as Record<string, unknown>)
        : {};
    const execLines = Array.isArray(script.exec)
      ? script.exec.filter((l): l is string => typeof l === 'string')
      : [];
    const hasScript = execLines.some((l) => l.trim().length > 0);
    if (!hasScript) continue;
    if (listen === 'prerequest') warningSink.add('postman-prerequest-script');
    else if (listen === 'test') warningSink.add('postman-test-script');
  }
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

function previewPostman(
  source: string
): ImporterPreviewOutcome<CollectionImporterPreview> {
  if (typeof source !== 'string' || source.trim().length === 0) {
    return { ok: false, reason: 'empty-input' };
  }
  if (utf8ByteLength(source) > MAX_COLLECTION_BYTES) {
    return rejectPostman('oversized');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return rejectPostman('malformed-json');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return rejectPostman('invalid-shape');
  }
  const root = parsed as Record<string, unknown>;

  const info =
    root.info !== null && typeof root.info === 'object'
      ? (root.info as Record<string, unknown>)
      : null;
  if (info === null) return rejectPostman('invalid-shape');

  // Version gate. v2.1 is the target; v2.0 is close enough to parse
  // best-effort; v1 (no `item`, has `requests`) is rejected.
  const schema = typeof info.schema === 'string' ? info.schema : '';
  if (schema.length > 0 && !schema.includes('v2.1') && !schema.includes('v2.0')) {
    return rejectPostman('wrong-version');
  }
  if (!Array.isArray(root.item)) {
    // A v1 collection has `requests` instead of `item`.
    return rejectPostman('wrong-version');
  }
  if (root.item.length === 0) {
    return rejectPostman('empty-collection');
  }

  const state: WalkState = {
    requests: [],
    folders: 0,
    truncated: 0,
    warnings: new Set<ImporterLossyWarning>(),
  };
  scanItemScripts(root.event, state.warnings);
  walkItems(root.item, '', state, root.auth);

  if (state.requests.length === 0) {
    return rejectPostman('empty-collection');
  }

  const title =
    typeof info.name === 'string' && info.name.trim().length > 0
      ? info.name.trim().slice(0, 120)
      : 'Imported collection';

  const preview: CollectionImporterPreview = {
    kind: 'http-collection',
    source: 'postman',
    title,
    requests: state.requests,
    counts: {
      total: state.requests.length,
      folders: state.folders,
      truncated: state.truncated,
    },
    warnings: [...state.warnings],
  };
  return { ok: true, preview, warnings: preview.warnings };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const postmanImporterAdapter: ImporterAdapter<
  CollectionImporterPreview,
  CollectionImporterResult
> = {
  id: 'postman-collection',
  titleKey: 'importPreview.importer.postmanCollection.title',
  descriptionKey: 'importPreview.importer.postmanCollection.description',
  detect: detectPostman,
  preview: previewPostman,
  import: (preview) => ({
    source: preview.source,
    title: preview.title,
    requests: preview.requests.map((r) => ({
      ...r,
      headers: r.headers.map((h) => ({ ...h })),
      ...(r.body ? { body: { ...r.body } } : {}),
    })),
  }),
};
