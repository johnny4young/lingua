/**
 * RL-065 Slice 5 — telemetry export endpoint.
 *
 * Accepts privacy-respecting events POSTed from the renderer (only
 * after the user has granted consent in Settings → Privacy). Every
 * payload is validated against the same allowlist + property
 * constraints the renderer redactor enforces in
 * `src/shared/telemetry.ts`, mirrored here verbatim for defense
 * in depth: a server that re-validates means a malicious or
 * misconfigured client cannot smuggle user-code through the wire.
 *
 * Persistence is Workers Observability `console.log` (already
 * `enabled = true` in `wrangler.toml`). Retention is ~3 days on
 * the standard plan; `docs/runbooks/telemetry-pipeline.md`
 * documents the promote-to-D1 follow-up when that becomes
 * load-bearing.
 *
 * Mirror discipline: when `TELEMETRY_EVENTS` or
 * `EVENT_PROPERTY_ALLOWLIST` change in `src/shared/telemetry.ts`,
 * update the copies below in the SAME commit. The parity test in
 * `test/telemetry.test.ts` enforces this at CI time — a forgotten
 * mirror fails the build.
 */

import { log } from './lib/observability';

// Mirror of TELEMETRY_EVENTS in src/shared/telemetry.ts. The parity
// test imports both arrays and asserts equality.
export const TELEMETRY_EVENT_NAMES = [
  'app.launched',
  'runner.executed',
  'overlay.opened',
  'feature.blocked',
  'update.checked',
  'utility.favorite.pinned',
  'utility.history.cleared',
  'utility.clipboard.applied',
  'debugger.attached',
  'debugger.paused',
  'debugger.detached',
  'runtime.mode_changed',
  'runtime.auto_run_gated',
  'runtime.workflow_mode_changed',
  'runtime.magic_comment_emitted',
  'runtime.history_replay',
  // RL-020 Slice 5 — mirror of `runtime.auto_log_enabled` /
  // `runtime.auto_log_emitted` in `src/shared/telemetry.ts`. The
  // parity test enforces both arrays stay aligned at CI time.
  'runtime.auto_log_enabled',
  'runtime.auto_log_emitted',
  // RL-020 Slice 6 — mirror of `runtime.stdin_used` in
  // `src/shared/telemetry.ts`. The parity test enforces drift.
  'runtime.stdin_used',
] as const;
export type TelemetryEventName = (typeof TELEMETRY_EVENT_NAMES)[number];

const EVENT_NAME_SET: ReadonlySet<string> = new Set(TELEMETRY_EVENT_NAMES);

// Mirror of EVENT_PROPERTY_ALLOWLIST in src/shared/telemetry.ts.
// Worker side ALWAYS drops unknown property keys silently; renderer
// side drops them in `redactForTelemetry`. The parity test asserts
// per-event key parity.
export const EVENT_PROPERTY_ALLOWLIST: Record<TelemetryEventName, readonly string[]> = {
  'app.launched': ['platform', 'build', 'locale'],
  'runner.executed': ['language', 'status', 'durationBucketMs'],
  'overlay.opened': ['overlayId'],
  'feature.blocked': ['entitlement', 'tier'],
  'update.checked': ['status'],
  'utility.favorite.pinned': ['utilityId', 'count'],
  'utility.history.cleared': ['utilityId', 'scope'],
  'utility.clipboard.applied': ['utilityId'],
  'debugger.attached': ['language', 'reasonBucket'],
  'debugger.paused': ['language', 'reasonBucket'],
  'debugger.detached': ['language', 'reasonBucket'],
  'runtime.mode_changed': ['mode', 'language'],
  'runtime.auto_run_gated': ['language', 'reason'],
  'runtime.workflow_mode_changed': ['language', 'from', 'to', 'trigger'],
  'runtime.magic_comment_emitted': ['language', 'hasArrow', 'hasWatch'],
  'runtime.history_replay': ['language', 'status', 'surface'],
  'runtime.auto_log_enabled': ['language', 'enabled'],
  'runtime.auto_log_emitted': ['language', 'countBucket'],
  'runtime.stdin_used': ['language'],
};

// (Fold A) Substring deny pass — mirror of `DENY_SUBSTRINGS` in
// `src/shared/telemetry.ts`. Defense in depth: even if the renderer
// redactor regressed and a sneaky key slipped through, the worker
// drops it on the wire. Mirror discipline matches the allowlist —
// changes go in the same commit and the parity test asserts both.
export const DENY_SUBSTRINGS = [
  'content',
  'code',
  'source',
  'snippet',
  'file',
  'path',
  'token',
  'password',
  'email',
  'name',
  'project',
] as const;

const SAFE_TOKEN_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const RUNNER_STATUS_VALUES = new Set(['ok', 'error']);
const DURATION_BUCKETS = new Set([0, 50, 250, 1000, 5000, 30_000, 60_000]);
const UPDATE_CHECKED_STATUS_VALUES = new Set([
  'available',
  'no-update',
  'failure',
]);
const HISTORY_CLEAR_SCOPES = new Set(['session', 'persisted', 'all']);
// RL-019 Slice 1 — closed enum mirroring `RuntimeMode` in
// `src/shared/runtimeModes.ts`. The parity test asserts the worker
// + renderer copies stay in sync.
const RUNTIME_MODE_VALUES = new Set(['worker', 'node', 'browser-preview']);
// RL-020 Slice 1 — closed enum mirror of `AUTO_RUN_GATE_REASONS` in
// `src/shared/telemetry.ts`. Locked to `'incomplete'` for Slice 1.
const AUTO_RUN_GATE_REASONS = new Set(['incomplete']);
// RL-020 Slice 2 — closed enum mirror of `WORKFLOW_MODE_VALUES` in
// `src/shared/telemetry.ts`. The parity test asserts the worker +
// renderer copies stay in sync.
const WORKFLOW_MODE_VALUES = new Set(['run', 'debug', 'scratchpad']);
// RL-020 Slice 2 — closed enum mirror of `WORKFLOW_MODE_CHANGE_TRIGGERS`
// in `src/shared/telemetry.ts`. Mirrors the trigger taxonomy so the
// worker drops events whose `trigger` field is unknown to either side.
const WORKFLOW_MODE_CHANGE_TRIGGERS = new Set([
  'toolbar',
  'language_change',
]);
// RL-020 Slice 4 — closed enum mirror of `HISTORY_REPLAY_SURFACES`
// in `src/shared/telemetry.ts`. Adding a new replay surface in the
// renderer must amend both this Set + the renderer copy in the same
// commit; the parity test enforces it at CI time.
const HISTORY_REPLAY_SURFACES = new Set([
  'tab_pill',
  'palette',
  'popover',
]);
// RL-020 Slice 5 fold A — closed enum mirror of
// `AUTO_LOG_COUNT_BUCKETS` in `src/shared/telemetry.ts`.
const AUTO_LOG_COUNT_BUCKETS = new Set([
  '1',
  '2-5',
  '6-20',
  '20-plus',
]);
const DEBUGGER_REASON_BUCKETS: Record<
  Extract<
    TelemetryEventName,
    'debugger.attached' | 'debugger.paused' | 'debugger.detached'
  >,
  ReadonlySet<string>
> = {
  'debugger.attached': new Set(['attach']),
  'debugger.paused': new Set(['user-breakpoint', 'step', 'exception']),
  'debugger.detached': new Set(['user-detach', 'run-complete', 'crash', 'stop']),
};

const MAX_PAYLOAD_BYTES = 8 * 1024;

// (Fold B) Per-IP rate limit. Renderer emits at most ~6 events per
// launch under normal use; a 5-req/sec ceiling caps a runaway tab
// without blocking legitimate traffic. CF Cache API is the only
// durable storage available without standing up KV/D1.
const RATE_LIMIT_PER_SECOND = 5;

const STANDARD_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
} as const;

export type ValidationResult =
  | {
      ok: true;
      event: TelemetryEventName;
      properties: Record<string, string | number | boolean>;
    }
  | {
      ok: false;
      reason: 'missing-event' | 'unknown-event' | 'invalid-properties';
    };

/**
 * Validate a parsed JSON body against the telemetry contract.
 *
 * Unknown property keys are silently dropped, NOT reflected as a
 * rejection. The privacy contract says we never signal "we saw your
 * sneaky key" — that signal alone is information leakage. Only the
 * structural violations the renderer would never produce surface as
 * 400s: missing/unknown event names, non-object property bag.
 */
export function validateTelemetryPayload(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object') {
    return { ok: false, reason: 'missing-event' };
  }
  const event = (body as { event?: unknown }).event;
  if (typeof event !== 'string' || event.length === 0) {
    return { ok: false, reason: 'missing-event' };
  }
  if (!EVENT_NAME_SET.has(event)) {
    return { ok: false, reason: 'unknown-event' };
  }
  const properties = (body as { properties?: unknown }).properties;
  if (properties === undefined) {
    return {
      ok: true,
      event: event as TelemetryEventName,
      properties: {},
    };
  }
  if (
    properties === null ||
    typeof properties !== 'object' ||
    Array.isArray(properties)
  ) {
    return { ok: false, reason: 'invalid-properties' };
  }
  const allowed = new Set(EVENT_PROPERTY_ALLOWLIST[event as TelemetryEventName]);
  const sanitized: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(
    properties as Record<string, unknown>
  )) {
    if (!allowed.has(key)) continue;
    if (keyLooksSensitive(key)) continue;
    if (!valueIsPrimitive(value)) continue;
    if (!isAllowedValue(event as TelemetryEventName, key, value)) continue;
    sanitized[key] = value as string | number | boolean;
  }
  return {
    ok: true,
    event: event as TelemetryEventName,
    properties: sanitized,
  };
}

/**
 * Exported only for the fold-A unit test — the privacy contract
 * requires that `keyLooksSensitive` actually filters keys that pass
 * the allowlist, which is currently impossible to demonstrate
 * indirectly because every allowed property name is benign. The
 * test calls this helper directly to lock the substring guard
 * behavior so a future allowlist regression that ever permitted a
 * sensitive key would still see the substring guard strip it.
 */
export function keyLooksSensitive(key: string): boolean {
  const lower = key.toLowerCase();
  return DENY_SUBSTRINGS.some(deny => lower.includes(deny));
}

function valueIsPrimitive(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function isSafeToken(value: unknown): value is string {
  return typeof value === 'string' && SAFE_TOKEN_RE.test(value);
}

function isSafeCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 1000
  );
}

function isAllowedValue(
  event: TelemetryEventName,
  key: string,
  value: unknown
): value is string | number | boolean {
  switch (event) {
    case 'app.launched':
      return isSafeToken(value);
    case 'runner.executed':
      if (key === 'language') return isSafeToken(value);
      if (key === 'status') return typeof value === 'string' && RUNNER_STATUS_VALUES.has(value);
      if (key === 'durationBucketMs') return typeof value === 'number' && DURATION_BUCKETS.has(value);
      return false;
    case 'overlay.opened':
      return key === 'overlayId' && isSafeToken(value);
    case 'feature.blocked':
      return (key === 'entitlement' || key === 'tier') && isSafeToken(value);
    case 'update.checked':
      return typeof value === 'string' && UPDATE_CHECKED_STATUS_VALUES.has(value);
    case 'utility.favorite.pinned':
      if (key === 'utilityId') return isSafeToken(value);
      if (key === 'count') return isSafeCount(value);
      return false;
    case 'utility.history.cleared':
      if (key === 'utilityId') return isSafeToken(value);
      if (key === 'scope') return typeof value === 'string' && HISTORY_CLEAR_SCOPES.has(value);
      return false;
    case 'utility.clipboard.applied':
      return key === 'utilityId' && isSafeToken(value);
    case 'debugger.attached':
    case 'debugger.paused':
    case 'debugger.detached':
      if (key === 'language') return isSafeToken(value);
      return (
        key === 'reasonBucket' &&
        typeof value === 'string' &&
        DEBUGGER_REASON_BUCKETS[event].has(value)
      );
    case 'runtime.mode_changed':
      if (key === 'mode')
        return typeof value === 'string' && RUNTIME_MODE_VALUES.has(value);
      if (key === 'language') return isSafeToken(value);
      return false;
    case 'runtime.auto_run_gated':
      if (key === 'language') return isSafeToken(value);
      if (key === 'reason')
        return typeof value === 'string' && AUTO_RUN_GATE_REASONS.has(value);
      return false;
    case 'runtime.workflow_mode_changed':
      if (key === 'language') return isSafeToken(value);
      if (key === 'from' || key === 'to')
        return typeof value === 'string' && WORKFLOW_MODE_VALUES.has(value);
      if (key === 'trigger')
        return (
          typeof value === 'string' && WORKFLOW_MODE_CHANGE_TRIGGERS.has(value)
        );
      return false;
    case 'runtime.magic_comment_emitted':
      if (key === 'language') return isSafeToken(value);
      if (key === 'hasArrow' || key === 'hasWatch')
        return typeof value === 'boolean';
      return false;
    case 'runtime.history_replay':
      if (key === 'language') return isSafeToken(value);
      if (key === 'status')
        return typeof value === 'string' && RUNNER_STATUS_VALUES.has(value);
      if (key === 'surface')
        return typeof value === 'string' && HISTORY_REPLAY_SURFACES.has(value);
      return false;
    case 'runtime.auto_log_enabled':
      if (key === 'language') return isSafeToken(value);
      if (key === 'enabled') return typeof value === 'boolean';
      return false;
    case 'runtime.auto_log_emitted':
      if (key === 'language') return isSafeToken(value);
      if (key === 'countBucket')
        return typeof value === 'string' && AUTO_LOG_COUNT_BUCKETS.has(value);
      return false;
    case 'runtime.stdin_used':
      if (key === 'language') return isSafeToken(value);
      return false;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export interface RateLimitInput {
  ip: string;
  now: number; // seconds since epoch
  perSecond?: number;
}

/**
 * Per-IP rate limiter (fold B). Uses the CF Cache API as a poor-man
 * KV: a counter keyed on `(ip, now-second)` with a 1s TTL so the
 * bucket auto-expires. Race conditions are tolerated — under
 * contention the worst case is a near-doubling of the effective
 * ceiling, still well below the abuse threshold.
 *
 * Returns `true` for `ip === 'unknown'` without consuming any
 * budget. The unknown-IP case is reachable only in tests / non-CF
 * runtimes; pooling every such caller into a single shared bucket
 * would cause cross-request rate-limit interference in CI.
 *
 * The cache key uses a synthetic non-routable origin so the entry
 * is purely a key-value store; nothing is ever fetched against it.
 */
export async function checkRateLimit(input: RateLimitInput): Promise<boolean> {
  if (input.ip === 'unknown') return true;
  const ceiling = input.perSecond ?? RATE_LIMIT_PER_SECOND;
  const cache = caches.default;
  const cacheKey = new Request(
    `https://lingua-telemetry-rate-limit.internal/${encodeURIComponent(input.ip)}/${input.now}`
  );
  const cached = await cache.match(cacheKey);
  let count = 0;
  if (cached) {
    const body = await cached.text();
    const parsed = Number.parseInt(body, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      count = parsed;
    }
  }
  const next = count + 1;
  // Stop writing once we breach the ceiling — the cached value is
  // already at-or-over the limit so further reads will already
  // deny, and avoiding extra `cache.put` calls under abuse cuts
  // the per-request CF Worker cost.
  if (next <= ceiling) {
    await cache.put(
      cacheKey,
      new Response(String(next), {
        headers: { 'Cache-Control': 'max-age=1' },
      })
    );
    return true;
  }
  return false;
}

/**
 * Dispatch a request to the telemetry handler. Owns method
 * negotiation, CORS preflight, payload size cap, rate limit, JSON
 * parse, validation, and the persistence log line.
 */
export async function handleTelemetry(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: STANDARD_CORS_HEADERS,
    });
  }
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { ...STANDARD_CORS_HEADERS, Allow: 'POST, OPTIONS' },
    });
  }

  // Pre-read size guard — when Content-Length is present we can
  // reject without ever reading the body. Chunked POSTs fall through
  // to the post-read length check below.
  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader) {
    const declared = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declared) && declared > MAX_PAYLOAD_BYTES) {
      return new Response('Payload Too Large', {
        status: 413,
        headers: STANDARD_CORS_HEADERS,
      });
    }
  }

  const ip = resolveClientIp(request);
  const allowed = await checkRateLimit({
    ip,
    now: Math.floor(Date.now() / 1000),
  });
  if (!allowed) {
    log('telemetry.rate_limited', { ipBucket: ipBucket(ip) });
    return new Response('Too Many Requests', {
      status: 429,
      headers: { ...STANDARD_CORS_HEADERS, 'Retry-After': '1' },
    });
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return new Response('Bad Request', {
      status: 400,
      headers: STANDARD_CORS_HEADERS,
    });
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_PAYLOAD_BYTES) {
    return new Response('Payload Too Large', {
      status: 413,
      headers: STANDARD_CORS_HEADERS,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Response('Bad Request', {
      status: 400,
      headers: STANDARD_CORS_HEADERS,
    });
  }
  const result = validateTelemetryPayload(parsed);
  if (!result.ok) {
    return new Response('Bad Request', {
      status: 400,
      headers: STANDARD_CORS_HEADERS,
    });
  }

  // Persist via structured logging. Workers Observability picks up
  // `console.log` JSON lines automatically. Retention on the
  // standard plan is ~3 days — sufficient for launch-window
  // analytics. See `docs/runbooks/telemetry-pipeline.md` for the
  // promote-to-D1 plan.
  log('telemetry.event', {
    eventName: result.event,
    properties: result.properties,
  });

  return new Response(null, { status: 204, headers: STANDARD_CORS_HEADERS });
}

function resolveClientIp(request: Request): string {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp;
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

/**
 * Coarse IP bucket used only when we log a rate-limit event — the
 * last IPv4 octet (or trailing IPv6 hextets) is truncated so the
 * structured log line never contains a full address. We still need
 * an identifier coarse enough to spot patterns but not so fine that
 * it identifies a single user.
 */
export function ipBucket(ip: string): string {
  if (!ip || ip === 'unknown') return 'unknown';
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return `${parts.slice(0, 3).join(':')}::*`;
  }
  const parts = ip.split('.');
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.*`;
  return 'unknown';
}
