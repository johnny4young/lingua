/**
 * RL-100 Slice 3 — Postman Collection v2.1 → HTTP requests importer.
 *
 * Parses a Postman Collection v2.1 JSON export (`{ info, item }`) into
 * a flat list of Lingua `HttpRequestV1`-shaped requests. Folders are
 * flattened depth-first and their names prefix the request label
 * (`Folder / Sub / Request`). The adapter is intentionally lossy —
 * Postman's scripting, auth helpers, unprovided environment/globals
 * variables, and non-text body modes have no HTTP-workspace equivalent, so
 * each is surfaced as a closed-enum `ImporterLossyWarning` rather than
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
  /**
   * RL-100 Slice 4 fold E — a display-only copy of `url` with values
   * sourced from a SENSITIVE-named environment/globals variable (token,
   * apiKey, secret, …) replaced by `<redacted>`. Present only when such a
   * substitution actually landed in the URL; the preview band renders
   * `displayUrl ?? url` while `url` (the real resolved value) round-trips
   * on confirm into the HTTP workspace.
   */
  readonly displayUrl?: string;
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
    /**
     * Distinct collection-level `{{variables}}` actually substituted
     * (Postman only; undefined for Bruno, which has no collection-var
     * concept in this slice). Surfaced by the preview chip + the
     * `import.postman_variables_resolved` telemetry bucket.
     */
    readonly variablesResolved?: number;
    /**
     * Distinct static `{{placeholders}}` left literal because no
     * matching collection variable was found (drives the narrowed
     * `postman-variable` warning). Dynamic `{{$...}}` tokens are NOT
     * counted here — they surface via `postman-dynamic-variable`.
     */
    readonly variablesUnresolved?: number;
    /**
     * RL-100 Slice 4 fold A — how many distinct provided environment /
     * globals keys contributed to resolved request values (including through
     * collection variables that reference env/globals keys). Drives the
     * "N from environment" preview chip. Undefined when no
     * environment/globals source was supplied.
     */
    readonly variablesResolvedFromEnv?: number;
  };
  /**
   * RL-100 Slice 4 fold D — the distinct `{{tokens}}` still unresolved
   * after the merge (collection + environment + globals), sorted and
   * capped for display. The preview lists these so the user knows exactly
   * which variables their environment is missing. Mirrors
   * `counts.variablesUnresolved` (the count) with the actual names.
   */
  readonly unresolvedVariableNames?: ReadonlyArray<string>;
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

// ---------------------------------------------------------------------------
// Collection variable resolution
// ---------------------------------------------------------------------------

/**
 * Matches a single `{{token}}` placeholder; the capture group is the
 * raw inner token. Whitespace is trimmed by the caller so `{{ id }}`
 * and `{{id}}` resolve to the same key. The class excludes `{`/`}` so
 * adjacent placeholders never merge into one match. Global, so
 * `String.replace` walks every placeholder in a value.
 */
const VARIABLE_TOKEN_PATTERN = /\{\{([^{}]+)\}\}/g;

/**
 * A Postman *dynamic* variable — `{{$guid}}`, `{{$timestamp}}`,
 * `{{$randomInt}}`, etc. Postman fills these at send time, NOT from the
 * collection `variable` array, so Lingua can never resolve them on
 * import. They are left literal and reported via the distinct
 * `postman-dynamic-variable` warning so the user knows they are
 * runtime placeholders, not a missing definition.
 */
function isDynamicVariableToken(token: string): boolean {
  return token.startsWith('$');
}

/**
 * Per-import variable-resolution state. Threaded through the item walk
 * so every substituted value contributes to the same DISTINCT key /
 * token sets — the preview chip + the fold-B telemetry buckets report
 * distinct counts, not raw substitution counts.
 */
interface VariableResolution {
  /** Flattened `key -> value` map (disabled excluded, transitive expanded). */
  readonly map: ReadonlyMap<string, string>;
  /** Distinct collection keys actually substituted at least once. */
  readonly resolvedKeys: Set<string>;
  /** Distinct static placeholders left literal (no matching key). */
  readonly unresolvedTokens: Set<string>;
  /** Distinct dynamic `{{$...}}` placeholders left literal. */
  readonly dynamicTokens: Set<string>;
  /**
   * RL-100 Slice 4 — keys whose winning value came from a provided
   * environment / globals export (they override collection defaults).
   * Empty when no env/globals source was supplied.
   */
  readonly envKeys: ReadonlySet<string>;
  /** Subset of {@link envKeys} whose name is secret-like (fold E redaction). */
  readonly sensitiveEnvKeys: ReadonlySet<string>;
  /**
   * Display-only flattened map where sensitive env/globals values are replaced
   * before transitive expansion, so collection variables that reference a
   * secret env key do not leak that secret in the preview URL.
   */
  readonly displayMap: ReadonlyMap<string, string>;
  /**
   * For each merged variable key, the env/globals keys that contribute to its
   * flattened value. This keeps the fold-A count honest when a collection
   * variable references an environment value transitively.
   */
  readonly envDependencyMap: ReadonlyMap<string, ReadonlySet<string>>;
  /** Distinct env/globals keys that contributed to resolved request values. */
  readonly resolvedFromEnvKeys: Set<string>;
}

/**
 * Parse the collection root `variable` array into a `key -> value`
 * map. Entries are `{ key, value, disabled? }`; `disabled: true`
 * entries are skipped (Postman treats them as inactive), keys are
 * trimmed, and a later duplicate key wins (matches Postman's
 * last-write resolution). Non-string keys/values are ignored.
 */
function parseCollectionVariables(raw: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(raw)) return map;
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (e.disabled === true) continue;
    const key = typeof e.key === 'string' ? e.key.trim() : '';
    if (key.length === 0) continue;
    if (typeof e.value !== 'string') continue;
    map.set(key, e.value);
  }
  return map;
}

// ---------------------------------------------------------------------------
// RL-100 Slice 4 — environment / globals variable sources
// ---------------------------------------------------------------------------

/** Closed reject reasons for a provided environment / globals export. */
export type PostmanVariableExportReject =
  | 'not-json'
  | 'wrong-shape'
  | 'oversized'
  | 'is-collection';

/** A parsed Postman environment / globals export. */
export interface PostmanVariableExport {
  /** Enabled `key -> value` entries. */
  readonly map: ReadonlyMap<string, string>;
  /** Declared scope when present (`_postman_variable_scope`). */
  readonly scope: 'environment' | 'globals' | 'unknown';
  /** Distinct enabled keys parsed. */
  readonly count: number;
}

/** Discriminated outcome of {@link parsePostmanVariableExport}. */
export type PostmanVariableExportOutcome =
  | { readonly ok: true; readonly export: PostmanVariableExport }
  | { readonly ok: false; readonly reason: PostmanVariableExportReject };

/**
 * Heuristic: does a variable KEY name denote a secret? Used by fold E to
 * redact env-sourced values substituted into a request URL in the preview.
 * Name-based (the value is never inspected), mirroring the header-name
 * redaction precedent from the cURL importer.
 */
const SENSITIVE_VARIABLE_KEY_PATTERN =
  /(token|secret|password|passwd|api[_-]?key|apikey|auth|bearer|credential|private[_-]?key|access[_-]?key|client[_-]?secret)/i;

export function isSensitiveVariableKey(key: string): boolean {
  return SENSITIVE_VARIABLE_KEY_PATTERN.test(key);
}

/**
 * Parse a Postman environment / globals export. The shape is
 * `{ values: [{ key, value, enabled }], _postman_variable_scope?:
 * 'environment' | 'globals', name? }` — a `values` array and NO collection
 * `item`. Disabled entries (`enabled: false`) are skipped; keys are trimmed;
 * a later duplicate key wins. Detection is shape-based (file extension is not
 * trusted); a collection pasted into the variables slot rejects with
 * `is-collection` so the user gets a precise diagnostic instead of a silent
 * no-op.
 */
export function parsePostmanVariableExport(
  raw: string
): PostmanVariableExportOutcome {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, reason: 'wrong-shape' };
  }
  if (utf8ByteLength(raw) > MAX_COLLECTION_BYTES) {
    return { ok: false, reason: 'oversized' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'not-json' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'wrong-shape' };
  }
  const root = parsed as Record<string, unknown>;
  // A collection (has `item`) is not a variable export — reject precisely.
  if (Array.isArray(root.item)) {
    return { ok: false, reason: 'is-collection' };
  }
  if (!Array.isArray(root.values)) {
    return { ok: false, reason: 'wrong-shape' };
  }
  const map = new Map<string, string>();
  for (const entry of root.values) {
    if (entry === null || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    // Postman environment entries mark inactive rows `enabled: false`.
    if (e.enabled === false) continue;
    const key = typeof e.key === 'string' ? e.key.trim() : '';
    if (key.length === 0) continue;
    if (typeof e.value !== 'string') continue;
    map.set(key, e.value);
  }
  const scopeRaw =
    typeof root._postman_variable_scope === 'string'
      ? root._postman_variable_scope
      : '';
  const scope: PostmanVariableExport['scope'] =
    scopeRaw === 'environment' || scopeRaw === 'globals' ? scopeRaw : 'unknown';
  return { ok: true, export: { map, scope, count: map.size } };
}

/**
 * Recursively expand `{{other}}` references inside a variable's value
 * so `fullUrl = {{base}}/v1` is fully resolved before substitution
 * into requests. `stack` carries the keys currently being expanded;
 * a token already on the stack is a cycle (`a -> {{b}}`, `b -> {{a}}`)
 * and is left literal, so expansion always terminates. Dynamic and
 * unknown tokens are also left literal.
 */
function expandValue(
  key: string,
  map: ReadonlyMap<string, string>,
  stack: ReadonlySet<string>
): string {
  const raw = map.get(key) ?? '';
  if (!raw.includes('{{')) return raw;
  return raw.replace(VARIABLE_TOKEN_PATTERN, (match, rawToken: string) => {
    const token = rawToken.trim();
    if (isDynamicVariableToken(token) || !map.has(token) || stack.has(token)) {
      return match;
    }
    const nextStack = new Set(stack);
    nextStack.add(token);
    return expandValue(token, map, nextStack);
  });
}

/**
 * Fold A — pre-expand transitive references so the request-level
 * resolver only does a single pass. Each key is expanded with itself
 * seeded on the cycle stack.
 */
function flattenVariableMap(map: Map<string, string>): Map<string, string> {
  const flat = new Map<string, string>();
  for (const key of map.keys()) {
    flat.set(key, expandValue(key, map, new Set([key])));
  }
  return flat;
}

/**
 * Fold A — discover which env/globals keys flow into each merged variable key,
 * including transitive collection references. Example:
 * `baseUrl = https://x?key={{apiKey}}` and env `apiKey = secret` means a
 * request using `{{baseUrl}}` was environment-assisted even though the direct
 * request token was collection-scoped.
 */
function collectEnvDependencies(
  key: string,
  map: ReadonlyMap<string, string>,
  envKeys: ReadonlySet<string>,
  stack: ReadonlySet<string>
): Set<string> {
  const deps = new Set<string>();
  if (envKeys.has(key)) deps.add(key);
  const raw = map.get(key);
  if (raw === undefined || !raw.includes('{{')) return deps;
  raw.replace(VARIABLE_TOKEN_PATTERN, (_match, rawToken: string) => {
    const token = rawToken.trim();
    if (isDynamicVariableToken(token) || !map.has(token) || stack.has(token)) {
      return _match;
    }
    const nextStack = new Set(stack);
    nextStack.add(token);
    for (const dep of collectEnvDependencies(token, map, envKeys, nextStack)) {
      deps.add(dep);
    }
    return _match;
  });
  return deps;
}

function buildEnvDependencyMap(
  map: ReadonlyMap<string, string>,
  envKeys: ReadonlySet<string>
): Map<string, ReadonlySet<string>> {
  const out = new Map<string, ReadonlySet<string>>();
  for (const key of map.keys()) {
    const deps = collectEnvDependencies(key, map, envKeys, new Set([key]));
    if (deps.size > 0) out.set(key, deps);
  }
  return out;
}

/**
 * Substitute every `{{token}}` in `text` against the resolution map,
 * recording each token as resolved / unresolved / dynamic on the
 * shared accumulator. Unresolved + dynamic tokens are left literal so
 * the user can still see (and fix) them in the imported request.
 */
function resolveVariables(text: string, resolution: VariableResolution): string {
  if (text.length === 0 || !text.includes('{{')) return text;
  return text.replace(VARIABLE_TOKEN_PATTERN, (match, rawToken: string) => {
    const token = rawToken.trim();
    if (isDynamicVariableToken(token)) {
      resolution.dynamicTokens.add(token);
      return match;
    }
    const value = resolution.map.get(token);
    if (value !== undefined) {
      resolution.resolvedKeys.add(token);
      const envDependencies = resolution.envDependencyMap.get(token);
      if (envDependencies) {
        for (const envKey of envDependencies) {
          resolution.resolvedFromEnvKeys.add(envKey);
        }
      }
      recordLiteralVariableTokens(value, resolution);
      return value;
    }
    resolution.unresolvedTokens.add(token);
    return match;
  });
}

/**
 * RL-100 Slice 4 fold E — display-only resolution: substitute `{{tokens}}`
 * as `resolveVariables` does, EXCEPT a token whose key is a sensitive
 * env/globals key resolves to `<redacted>` instead of its real value.
 * Pure — never mutates the resolution accumulator (it runs alongside the
 * real pass purely to build the redacted preview string).
 */
export const REDACTED_VARIABLE_PLACEHOLDER = '<redacted>';

function resolveTextForDisplay(
  text: string,
  resolution: VariableResolution
): string {
  if (text.length === 0 || !text.includes('{{')) return text;
  return text.replace(VARIABLE_TOKEN_PATTERN, (match, rawToken: string) => {
    const token = rawToken.trim();
    if (isDynamicVariableToken(token)) return match;
    if (resolution.sensitiveEnvKeys.has(token)) {
      return REDACTED_VARIABLE_PLACEHOLDER;
    }
    const value = resolution.displayMap.get(token);
    return value !== undefined ? value : match;
  });
}

/**
 * RL-100 Slice 4 — build the per-import variable resolution from the
 * collection's own `variable[]` plus optional environment / globals maps.
 * Precedence is Postman's: environment > globals > collection. `envKeys`
 * records which keys the env/globals layers supplied so fold A can count
 * env-sourced resolutions and fold E can target sensitive ones.
 */
function buildVariableResolution(
  collectionRaw: unknown,
  options?: {
    readonly environment?: ReadonlyMap<string, string>;
    readonly globals?: ReadonlyMap<string, string>;
  }
): VariableResolution {
  const collection = parseCollectionVariables(collectionRaw);
  const globals = options?.globals ?? new Map<string, string>();
  const environment = options?.environment ?? new Map<string, string>();
  // Later entries overwrite earlier → environment wins over globals wins
  // over collection defaults.
  const merged = new Map<string, string>([
    ...collection,
    ...globals,
    ...environment,
  ]);
  const envKeys = new Set<string>([...globals.keys(), ...environment.keys()]);
  const sensitiveEnvKeys = new Set<string>(
    [...envKeys].filter((key) => isSensitiveVariableKey(key))
  );
  const displaySeed = new Map<string, string>(merged);
  for (const key of sensitiveEnvKeys) {
    displaySeed.set(key, REDACTED_VARIABLE_PLACEHOLDER);
  }
  return {
    map: flattenVariableMap(merged),
    resolvedKeys: new Set<string>(),
    unresolvedTokens: new Set<string>(),
    dynamicTokens: new Set<string>(),
    envKeys,
    sensitiveEnvKeys,
    displayMap: flattenVariableMap(displaySeed),
    envDependencyMap: buildEnvDependencyMap(merged, envKeys),
    resolvedFromEnvKeys: new Set<string>(),
  };
}

/**
 * A flattened collection variable value can still contain literal
 * placeholders when it references an unknown env/global variable, a
 * dynamic Postman token, or a cycle. Record those leftover tokens so
 * the warning band/telemetry reflect what remains unresolved after
 * substitution instead of reporting a false clean import.
 */
function recordLiteralVariableTokens(
  text: string,
  resolution: VariableResolution
): void {
  if (!text.includes('{{')) return;
  text.replace(VARIABLE_TOKEN_PATTERN, (_match, rawToken: string) => {
    const token = rawToken.trim();
    if (isDynamicVariableToken(token)) resolution.dynamicTokens.add(token);
    else resolution.unresolvedTokens.add(token);
    return _match;
  });
}

// ---------------------------------------------------------------------------
// Item walk (folders + requests, depth-first)
// ---------------------------------------------------------------------------

interface WalkState {
  readonly requests: ParsedCollectionRequest[];
  folders: number;
  truncated: number;
  readonly warnings: Set<ImporterLossyWarning>;
  /** Collection-variable resolution accumulator (shared across the walk). */
  readonly variables: VariableResolution;
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
      // Folder — recurse with the name prefixed. Fold E: resolve
      // `{{var}}` in the folder name so request labels read cleanly.
      state.folders += 1;
      const folderName = resolveVariables(name, state.variables);
      const nextPrefix =
        folderName.length > 0
          ? pathPrefix.length > 0
            ? `${pathPrefix} / ${folderName}`
            : folderName
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
    const parsed = mapRequestItem(item, name, pathPrefix, state, itemAuth);
    if (parsed !== null) state.requests.push(parsed);
  }
}

function mapRequestItem(
  item: RawPostmanItem,
  name: string,
  pathPrefix: string,
  state: WalkState,
  inheritedAuth: unknown
): ParsedCollectionRequest | null {
  const warningSink = state.warnings;
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

  scanItemScripts(item.event, warningSink);

  // Resolve `{{variables}}` across the request. The body KIND is kept
  // as detected pre-resolution (mapBody already classified raw vs
  // json); only the content string is substituted. Header names whose
  // resolved value collapses to empty are dropped (defensive — a
  // header keyed entirely on an unknown var is unusable).
  const resolution = state.variables;
  const resolvedUrl = resolveVariables(url, resolution);
  // Fold E — a display-only URL with sensitive env-sourced values redacted.
  const displayUrl = resolveTextForDisplay(url, resolution);
  const resolvedHeaders = headers
    .map((h) => ({
      ...h,
      name: resolveVariables(h.name, resolution),
      value: resolveVariables(h.value, resolution),
    }))
    .filter((h) => h.name.length > 0);
  const resolvedBody = body
    ? {
        ...body,
        ...(typeof body.content === 'string'
          ? { content: resolveVariables(body.content, resolution) }
          : {}),
      }
    : undefined;
  const resolvedName = resolveVariables(name, resolution);

  const label =
    pathPrefix.length > 0
      ? `${pathPrefix} / ${resolvedName.length > 0 ? resolvedName : method}`
      : resolvedName.length > 0
        ? resolvedName
        : `${method} ${resolvedUrl}`;

  return {
    name: label.slice(0, 120),
    method,
    url: resolvedUrl,
    // Only carry a redacted display URL when a sensitive env value actually
    // landed in it (so the common case stays a plain string).
    ...(displayUrl !== resolvedUrl ? { displayUrl } : {}),
    headers: resolvedHeaders,
    ...(resolvedBody ? { body: resolvedBody } : {}),
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

/**
 * RL-100 Slice 4 — optional environment / globals variable maps merged into
 * the collection's own variables. When present, fold A counts env-sourced
 * resolutions and fold E redacts sensitive env values in the preview URL.
 */
interface PostmanVariableOptions {
  readonly environment?: ReadonlyMap<string, string>;
  readonly globals?: ReadonlyMap<string, string>;
}

function previewPostman(
  source: string,
  variableOptions?: PostmanVariableOptions
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
    variables: buildVariableResolution(root.variable, variableOptions),
  };
  scanItemScripts(root.event, state.warnings);
  walkItems(root.item, '', state, root.auth);

  // Variable warnings fire only for what STAYED literal after
  // resolution: unresolved statics (env / globals files we don't read)
  // and dynamic `{{$...}}` runtime placeholders (fold D).
  if (state.variables.unresolvedTokens.size > 0) {
    state.warnings.add('postman-variable');
  }
  if (state.variables.dynamicTokens.size > 0) {
    state.warnings.add('postman-dynamic-variable');
  }

  if (state.requests.length === 0) {
    return rejectPostman('empty-collection');
  }

  const title =
    typeof info.name === 'string' && info.name.trim().length > 0
      ? info.name.trim().slice(0, 120)
      : 'Imported collection';

  // Fold D — the actual still-unresolved token names (sorted + capped).
  const unresolvedVariableNames = [...state.variables.unresolvedTokens]
    .sort()
    .slice(0, MAX_UNRESOLVED_VARIABLE_NAMES);

  const preview: CollectionImporterPreview = {
    kind: 'http-collection',
    source: 'postman',
    title,
    requests: state.requests,
    counts: {
      total: state.requests.length,
      folders: state.folders,
      truncated: state.truncated,
      variablesResolved: state.variables.resolvedKeys.size,
      variablesUnresolved: state.variables.unresolvedTokens.size,
      // Fold A — only meaningful once an env/globals source is supplied.
      ...(variableOptions !== undefined
        ? { variablesResolvedFromEnv: state.variables.resolvedFromEnvKeys.size }
        : {}),
    },
    ...(unresolvedVariableNames.length > 0 ? { unresolvedVariableNames } : {}),
    warnings: [...state.warnings],
  };
  return { ok: true, preview, warnings: preview.warnings };
}

/**
 * RL-100 Slice 4 fold D — cap on how many unresolved token names ride in the
 * preview (the count `variablesUnresolved` is always exact; this list is for
 * display). A pathological collection cannot bloat the preview payload.
 */
const MAX_UNRESOLVED_VARIABLE_NAMES = 30;

/**
 * Per-slot parse status for the optional variable sources, surfaced to the
 * overlay so each input can show an inline ok/error.
 */
export type PostmanVariableSlotStatus =
  | { readonly ok: true; readonly count: number; readonly scope: PostmanVariableExport['scope'] }
  | { readonly ok: false; readonly reason: PostmanVariableExportReject };

export interface PostmanVariableSourceStatus {
  readonly environment?: PostmanVariableSlotStatus;
  readonly globals?: PostmanVariableSlotStatus;
}

/**
 * RL-100 Slice 4 — preview a Postman collection WITH optional environment /
 * globals exports merged into variable resolution (precedence env > globals >
 * collection). Parses each provided slot, threads the maps into the core
 * preview, and returns the per-slot parse status alongside the outcome so the
 * overlay can show an inline ok/error per input. A slot that fails to parse is
 * simply omitted from the merge (the collection still imports).
 */
export function previewPostmanWithVariables(
  source: string,
  sources: { readonly environment?: string; readonly globals?: string }
): {
  readonly outcome: ImporterPreviewOutcome<CollectionImporterPreview>;
  readonly variableStatus: PostmanVariableSourceStatus;
} {
  const variableStatus: {
    environment?: PostmanVariableSlotStatus;
    globals?: PostmanVariableSlotStatus;
  } = {};
  const options: { environment?: ReadonlyMap<string, string>; globals?: ReadonlyMap<string, string> } =
    {};

  for (const slot of ['environment', 'globals'] as const) {
    const raw = sources[slot];
    if (raw === undefined || raw.trim().length === 0) continue;
    const parsed = parsePostmanVariableExport(raw);
    if (parsed.ok) {
      options[slot] = parsed.export.map;
      variableStatus[slot] = {
        ok: true,
        count: parsed.export.count,
        scope: parsed.export.scope,
      };
    } else {
      variableStatus[slot] = { ok: false, reason: parsed.reason };
    }
  }

  return { outcome: previewPostman(source, options), variableStatus };
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
