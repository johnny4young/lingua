/**
 * RL-097 Slice 3a — HTTP environments + `{{variable}}` interpolation
 * with secret-aware redaction.
 *
 * An HTTP environment is a named bag of `{{key}}` → value bindings the
 * user can swap (dev / staging / prod) without rewriting every request.
 * On send, the active environment is interpolated into the request's
 * URL, header values, and body content. Some bindings are flagged
 * `secret: true` — those are the privacy-critical part of this module.
 *
 * Privacy posture (READ THIS BEFORE TOUCHING ANY MASK FUNCTION):
 *
 *   - The OUTBOUND request (`interpolateRequest`) resolves ALL vars,
 *     secret and non-secret alike — the secret value must reach the
 *     wire or the request would not authenticate. This is the ONLY
 *     surface that ever carries a resolved secret.
 *   - Every PERSISTED / SHARED / DISPLAYED surface (capsule source,
 *     copy-as-cURL, the editor resolution preview, telemetry, the
 *     recorded response) must NEVER carry a resolved secret value.
 *     `maskSecretsForCapsule` keeps secret tokens as their literal
 *     `{{key}}` placeholder; `maskSecretValuesInResponse` scrubs any
 *     secret value a server happened to echo back into the response.
 *   - A leaked secret is the worst failure mode for this slice. When in
 *     doubt, mask. The resolved secret lives only inside the single
 *     `fetch` call and nowhere else.
 *
 * All functions in this module are pure data transforms — no IPC, no
 * side effects, no stateful module-level regex. `parseHttpEnvironment`
 * is the defense-in-depth boundary at the localStorage rehydrate edge,
 * mirroring `parseHttpRequest` in `httpWorkspace.ts`.
 */

import type { HttpRequestV1 } from './httpWorkspace';
import type { HttpResponseV1 } from './httpWorkspace';

/**
 * One variable binding in an environment.
 *
 *   - `key`    — the token name (matches `VARIABLE_TOKEN`'s charset
 *     `[A-Za-z0-9_.-]+`). Looked up against `{{key}}` tokens.
 *   - `value`  — the substitution string. May be empty (an empty value
 *     counts as "no value" for `findUnresolvedVariables`).
 *   - `secret` — when true, the value is NEVER surfaced on a persisted /
 *     shared / displayed surface (see the file-header privacy posture).
 *     It is still resolved on the outbound request.
 */
export interface HttpEnvVariableV1 {
  key: string;
  value: string;
  secret: boolean;
}

/**
 * A named environment: an ordered list of variable bindings plus
 * identity + timestamps. `version` is hard-pinned to `1`;
 * `parseHttpEnvironment` rejects any other value at the rehydrate
 * boundary. Invariant: `id` is a non-empty stable UUID that survives
 * edits (`updateEnvironment` re-pins it).
 */
export interface HttpEnvironmentV1 {
  /** Hard-coded `1`. `parseHttpEnvironment` rejects any other value. */
  version: 1;
  /** UUIDv4 from `crypto.randomUUID()`. */
  id: string;
  /** User-editable label shown in the selector + manager. */
  name: string;
  /** Ordered variable bindings. May contain rows with an empty value. */
  variables: HttpEnvVariableV1[];
  /** ISO timestamp (millisecond precision). */
  createdAt: string;
  updatedAt: string;
}

/**
 * Source regex for a `{{ key }}` token. Inner whitespace around the key
 * is optional and ignored; the key charset is `[A-Za-z0-9_.-]+` (the
 * same safe-token shape used for header / env names elsewhere).
 *
 * IMPORTANT: this is the SOURCE pattern, declared WITHOUT the `g` flag,
 * so it carries no `lastIndex` state. Never `.exec()` / `.test()` this
 * object across calls — a stateful global regex shared between calls
 * silently skips matches. Use `variableTokenMatcher()` for a fresh
 * `g`-flagged clone per scan (or pass it straight to `String#matchAll`,
 * which requires the `g` flag).
 */
export const VARIABLE_TOKEN = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/;

/**
 * Return a FRESH global-flagged clone of `VARIABLE_TOKEN`, safe to feed
 * to `String#matchAll` / a `replace` callback. A new object per call
 * means no `lastIndex` leaks between scans.
 */
export function variableTokenMatcher(): RegExp {
  return new RegExp(VARIABLE_TOKEN.source, 'g');
}

// ---------------------------------------------------------------------------
// Parser — defense in depth at the localStorage rehydrate boundary.
// Mirrors `parseHttpRequest`'s null-on-hard-failure discipline.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Coerce one raw row into an `HttpEnvVariableV1`, or `null` if the row
 * is not a usable binding. Unlike the request parser (which rejects the
 * whole entry on a bad row), invalid variable rows are DROPPED by
 * `parseHttpEnvironment` so a single hand-corrupted row cannot brick an
 * otherwise-valid environment. `secret` defaults to `false` when absent
 * (forward-compat: an environment persisted before the secret flag
 * existed loads as all-non-secret).
 */
function parseEnvVariable(value: unknown): HttpEnvVariableV1 | null {
  if (!isRecord(value)) return null;
  const key = value.key;
  const varValue = value.value;
  if (typeof key !== 'string' || key.length === 0) return null;
  if (typeof varValue !== 'string') return null;
  const secret = value.secret === true;
  return { key, value: varValue, secret };
}

/**
 * Strict parser for a persisted environment. Returns `null` on a hard
 * top-level shape mismatch (wrong version, missing id/name/timestamps,
 * non-array `variables`). Invalid INDIVIDUAL variable rows are dropped
 * rather than failing the whole entry — better a partial environment
 * than a dropped one. Mirrors `parseHttpRequest`.
 */
export function parseHttpEnvironment(value: unknown): HttpEnvironmentV1 | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (typeof value.name !== 'string') return null;
  if (!Array.isArray(value.variables)) return null;
  if (typeof value.createdAt !== 'string') return null;
  if (typeof value.updatedAt !== 'string') return null;
  const variables: HttpEnvVariableV1[] = [];
  for (const raw of value.variables) {
    const parsed = parseEnvVariable(raw);
    if (parsed !== null) variables.push(parsed);
  }
  return {
    version: 1,
    id: value.id,
    name: value.name,
    variables,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

/**
 * Build a fresh blank environment with sensible defaults. Used by the
 * "Add environment" affordance in the manager.
 */
export function createBlankHttpEnvironment(options: {
  id: string;
  name?: string;
  now?: string;
}): HttpEnvironmentV1 {
  const now = options.now ?? new Date().toISOString();
  return {
    version: 1,
    id: options.id,
    name: options.name ?? '',
    variables: [],
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Interpolation core.
// ---------------------------------------------------------------------------

/**
 * Single-pass token substitution. Each `{{key}}` token whose key is
 * present in `lookup` is replaced by the looked-up value; an unknown
 * token is left VERBATIM so `findUnresolvedVariables` can later flag it.
 *
 * SINGLE PASS is a hard requirement: a looked-up value that itself
 * contains `{{other}}` is NOT re-scanned. We use one `replace` over a
 * fresh global matcher (no recursion) so substitution can never loop or
 * expand a value's own braces. This also keeps a secret value that
 * happens to contain brace-like text from being treated as a token.
 */
export function interpolateString(
  input: string,
  lookup: Map<string, string>
): string {
  if (input.length === 0) return input;
  return input.replace(variableTokenMatcher(), (match, key: string) => {
    const resolved = lookup.get(key);
    // `undefined` → unknown token → leave the original `{{ ... }}` text.
    return resolved !== undefined ? resolved : match;
  });
}

/**
 * Collapse duplicate variable rows to the final effective binding per key.
 * This is the canonical last-edit-wins view shared by outbound resolution,
 * masking, and response scrubbing.
 */
function buildFinalVariableMap(
  env: HttpEnvironmentV1 | null
): Map<string, HttpEnvVariableV1> {
  const variables = new Map<string, HttpEnvVariableV1>();
  if (!env) return variables;
  for (const variable of env.variables) {
    variables.set(variable.key, variable);
  }
  return variables;
}

function buildLookupFromFinalVariables(
  variables: Map<string, HttpEnvVariableV1>,
  includeSecret: boolean
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const [key, variable] of variables) {
    if (!includeSecret && variable.secret) continue;
    lookup.set(key, variable.value);
  }
  return lookup;
}

/**
 * Build a `key → value` lookup over EVERY variable in the environment
 * (secret + non-secret). A later row with the same key wins (matches
 * the manager's last-edit-wins ordering). Returns an empty Map for a
 * null env.
 */
function buildFullLookup(env: HttpEnvironmentV1 | null): Map<string, string> {
  return buildLookupFromFinalVariables(buildFinalVariableMap(env), true);
}

/**
 * Build a lookup over ONLY final non-secret variables. Secret keys are
 * intentionally absent so `interpolateString` leaves their `{{key}}`
 * tokens verbatim — the masking primitive for capsule / cURL / preview.
 * Duplicate rows follow the same last-edit-wins rule as the outbound
 * lookup; if the final row for a key is secret, no older non-secret row
 * may resolve that token on a displayed / persisted surface.
 */
function buildNonSecretLookup(
  env: HttpEnvironmentV1 | null
): Map<string, string> {
  return buildLookupFromFinalVariables(buildFinalVariableMap(env), false);
}

/**
 * Apply a lookup across the interpolatable surfaces of a request (url,
 * every header value, body.content) and return a NEW request. The
 * `version`/`id` pins are preserved. Shared by the outbound + masked
 * paths — the only difference between them is which lookup they pass.
 */
function mapRequestStrings(
  request: HttpRequestV1,
  lookup: Map<string, string>
): HttpRequestV1 {
  const next: HttpRequestV1 = {
    ...request,
    version: 1,
    id: request.id,
    url: interpolateString(request.url, lookup),
    headers: request.headers.map((header) => ({
      ...header,
      value: interpolateString(header.value, lookup),
    })),
  };
  if (request.body && request.body.kind !== 'none' && request.body.content) {
    next.body = {
      ...request.body,
      content: interpolateString(request.body.content, lookup),
    };
  }
  return next;
}

/**
 * The OUTBOUND request: resolve ALL variables (secret + non-secret) in
 * the url, header values, and body content, returning a NEW request.
 * When `env` is null the request is returned structurally cloned
 * (unchanged content). This is the one and only surface that carries a
 * resolved secret value — it feeds straight into `executeHttpRequest`
 * and must NOT be persisted, recorded, or copied.
 */
export function interpolateRequest(
  request: HttpRequestV1,
  env: HttpEnvironmentV1 | null
): HttpRequestV1 {
  return mapRequestStrings(request, buildFullLookup(env));
}

/**
 * Mask for any persisted / shared / displayed surface (capsule source,
 * cURL clipboard, editor preview): resolve NON-secret variables for
 * replay fidelity, but leave SECRET tokens as their literal `{{key}}`
 * placeholder so the resolved secret never lands on disk / clipboard /
 * screen. Unknown tokens are also left verbatim. `env` null → request
 * returned unchanged (structurally cloned).
 */
export function maskSecretsForCapsule(
  request: HttpRequestV1,
  env: HttpEnvironmentV1 | null
): HttpRequestV1 {
  return mapRequestStrings(request, buildNonSecretLookup(env));
}

/**
 * Collect every distinct `{{token}}` key that appears in the request's
 * url, ENABLED header values, or body.content but is NOT defined in the
 * environment (when `env` is null, ALL referenced tokens count as
 * unresolved). First-seen order, deduped. Drives the pre-send block +
 * the "unresolved" chips in the editor preview.
 *
 * Note: a variable defined with an EMPTY value is treated as resolved
 * here — the user has bound the key, the binding is just blank. (Empty
 * values are a deliberate "send nothing" affordance, not an error.)
 */
export function findUnresolvedVariables(
  request: HttpRequestV1,
  env: HttpEnvironmentV1 | null
): string[] {
  const known = new Set<string>();
  if (env) {
    for (const variable of env.variables) known.add(variable.key);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  const scan = (input: string): void => {
    for (const match of input.matchAll(variableTokenMatcher())) {
      const key = match[1];
      if (key === undefined) continue;
      if (known.has(key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
  };
  scan(request.url);
  for (const header of request.headers) {
    if (!header.enabled) continue;
    scan(header.value);
  }
  if (request.body && request.body.kind !== 'none' && request.body.content) {
    scan(request.body.content);
  }
  return out;
}

/**
 * Collect every distinct `{{token}}` key referenced in the request's
 * url, ENABLED header values, or body.content that IS defined in the
 * environment. First-seen order, deduped. Used to bucket the
 * resolved-variable count for telemetry (fold D) and to drive the
 * resolution-preview chips.
 */
export function findResolvedVariables(
  request: HttpRequestV1,
  env: HttpEnvironmentV1 | null
): string[] {
  if (!env) return [];
  const known = new Set(env.variables.map((variable) => variable.key));
  const seen = new Set<string>();
  const out: string[] = [];
  const scan = (input: string): void => {
    for (const match of input.matchAll(variableTokenMatcher())) {
      const key = match[1];
      if (key === undefined) continue;
      if (!known.has(key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
  };
  scan(request.url);
  for (const header of request.headers) {
    if (!header.enabled) continue;
    scan(header.value);
  }
  if (request.body && request.body.kind !== 'none' && request.body.content) {
    scan(request.body.content);
  }
  return out;
}

/**
 * The resolved `value`s of every SECRET variable with a non-empty
 * value. These are the literal strings to scrub from a response (a
 * server can echo a secret back into the body / a header / the final
 * URL). Empty-valued secrets are skipped — scrubbing the empty string
 * would replace everything.
 */
export function collectSecretResolvedValues(
  env: HttpEnvironmentV1 | null
): string[] {
  if (!env) return [];
  const seenValues = new Set<string>();
  const out: string[] = [];
  for (const variable of buildFinalVariableMap(env).values()) {
    if (!variable.secret) continue;
    if (variable.value.length === 0) continue;
    if (seenValues.has(variable.value)) continue;
    seenValues.add(variable.value);
    out.push(variable.value);
  }
  return out;
}

/** Literal global replace of `needle` with `replacement` (no regex semantics). */
function replaceAllLiteral(
  haystack: string,
  needle: string,
  replacement: string
): string {
  if (needle.length === 0) return haystack;
  // split/join is a literal, global, non-regex replace — safe for
  // arbitrary secret bytes (no metacharacter interpretation).
  return haystack.split(needle).join(replacement);
}

/** The sentinel a scrubbed secret value is replaced with. */
const REDACTED_SENTINEL = '<redacted>';

/**
 * Scrub every occurrence of each secret value out of a response,
 * returning a NEW response. Covers EVERY server- or request-derived
 * free-text string field a secret could ride on:
 *
 *   - `body` — a server echoing the value back (httpbin-style).
 *   - `url` — the ORIGINAL request URL, which is the resolved outbound
 *     URL, so a secret in a query param (`?token=…`) lands here verbatim.
 *   - `finalUrl` — same, after redirects.
 *   - `statusText` + `errorMessage` — server-/runtime-controlled text
 *     that can reflect the URL (a network error message often embeds it).
 *   - every `headers[].value`.
 *
 * A NO-OP (returns the SAME reference) when `secretValues` is empty, so
 * the common no-secret path allocates nothing.
 *
 * This is the last line of defense behind `recordResponse`: the recorded
 * response is persisted to localStorage + drives the preview/history, and
 * its body feeds the capsule's `result.stdout`. `url` was the leak the
 * live smoke caught — the unit test mocked a clean `url`, so scrub EVERY
 * URL-bearing field, not just `finalUrl`.
 */
export function maskSecretValuesInResponse(
  response: HttpResponseV1,
  secretValues: readonly string[]
): HttpResponseV1 {
  if (secretValues.length === 0) return response;
  const scrub = (input: string): string => {
    let out = input;
    for (const secret of secretValues) {
      out = replaceAllLiteral(out, secret, REDACTED_SENTINEL);
    }
    return out;
  };
  return {
    ...response,
    body: scrub(response.body),
    url: scrub(response.url),
    finalUrl: scrub(response.finalUrl),
    statusText: scrub(response.statusText),
    headers: response.headers.map((header) => ({
      ...header,
      value: scrub(header.value),
    })),
    ...(response.errorMessage !== undefined
      ? { errorMessage: scrub(response.errorMessage) }
      : {}),
  };
}
