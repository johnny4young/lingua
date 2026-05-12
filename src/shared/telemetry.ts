/**
 * Privacy-respecting telemetry payload shape + redactor (RL-065).
 *
 * The product is local-first; telemetry only fires when the user has
 * explicitly opted in and the build honors the `VITE_LINGUA_TELEMETRY_DISABLED=1`
 * kill switch. This module owns the TypeScript surface for telemetry events
 * and, critically, the `TELEMETRY_EVENTS` allowlist that prevents drift
 * into "just this one field" expansions that creep toward user code capture.
 *
 * `redactForTelemetry` is exported so both the renderer emitter and the
 * CI payload grep live on the same single redaction pass.
 */

export const TELEMETRY_EVENTS = [
  'app.launched',
  'runner.executed',
  'overlay.opened',
  'feature.blocked',
  'update.checked',
  // RL-069 Slice 3 — Developer Utilities productivity layer adoption.
  // Counts only; no content, no input/output payloads, no tool ids
  // beyond a fixed enum bucket already on the catalog.
  'utility.favorite.pinned',
  'utility.history.cleared',
  'utility.clipboard.applied',
  // RL-027 Slice 1.5 — debugger session lifecycle. Payload is locked to
  // `{ language, reasonBucket }` per DEBUGGER_ADR §4. No source, no code,
  // no expression content, no breakpoint coordinates.
  'debugger.attached',
  'debugger.paused',
  'debugger.detached',
] as const;
export type TelemetryEventName = (typeof TELEMETRY_EVENTS)[number];

export interface TelemetryBaseFields {
  appVersion: string;
  osBucket: string;
  /** `pro` / `free` / `grace` / `invalid` — never the raw token. */
  licenseStatus: string;
  /** Coarse session id generated per-launch — not a user identifier. */
  sessionId: string;
}

export interface TelemetryEvent extends TelemetryBaseFields {
  event: TelemetryEventName;
  /**
   * Allowed per-event properties. Keys listed here are the only ones that
   * survive the redactor. Any key not in this map is dropped, not sent.
   */
  properties: Record<string, string | number | boolean>;
  /** Milliseconds since epoch — rounded to the minute to reduce fingerprintability. */
  timestamp: number;
}

/**
 * Allowlist of properties we intentionally collect per event. Any other key
 * is dropped by the redactor. Keep this list short and reviewed — any
 * expansion should come with a matching copy block in the consent UI.
 */
const EVENT_PROPERTY_ALLOWLIST: Record<TelemetryEventName, readonly string[]> = {
  'app.launched': ['platform', 'build', 'locale'],
  'runner.executed': ['language', 'status', 'durationBucketMs'],
  'overlay.opened': ['overlayId'],
  'feature.blocked': ['entitlement', 'tier'],
  // RL-065 Slice 5 — `status` is a closed enum:
  //   `available`  → autoupdater reported an update is ready/downloading.
  //   `no-update`  → autoupdater reported the build is already current.
  //   `failure`    → autoupdater raised an error during the check.
  // No version strings, no release notes, no error messages — those
  // would be free-form text and risk leaking host detail. Fired by
  // `src/renderer/stores/updateStore.ts` on every transition out of
  // the `checking` state.
  'update.checked': ['status'],
  // RL-069 Slice 3 — `utilityId` is the catalog enum value (a fixed
  // string set, not user data). `count` is the post-action favorites
  // length so we can see adoption without tracking per-tool.
  'utility.favorite.pinned': ['utilityId', 'count'],
  'utility.history.cleared': ['utilityId', 'scope'],
  'utility.clipboard.applied': ['utilityId'],
  // RL-027 Slice 1.5 — `language` is the runtime adapter id (a closed
  // enum: `js` / `python` / `go` / `rust`). `reasonBucket` is a closed
  // set partitioned by event:
  //   `debugger.attached` → `attach` (the only valid value today; if a
  //     future slice adds a reattach path it MUST update this comment
  //     and the runbook in `docs/DEBUGGER_SLICE1.md`).
  //   `debugger.paused`   → `user-breakpoint` / `step` / `exception`.
  //   `debugger.detached` → `user-detach` / `run-complete` / `crash` / `stop`.
  // No expression content, no breakpoint line, no source snippet.
  'debugger.attached': ['language', 'reasonBucket'],
  'debugger.paused': ['language', 'reasonBucket'],
  'debugger.detached': ['language', 'reasonBucket'],
};

const DENY_SUBSTRINGS = [
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
];

const SAFE_TOKEN_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const RUNNER_STATUS_VALUES = new Set(['ok', 'error']);
const DURATION_BUCKETS = new Set([0, 50, 250, 1000, 5000, 30_000, 60_000]);
const UPDATE_CHECKED_STATUS_VALUES = new Set([
  'available',
  'no-update',
  'failure',
]);
const HISTORY_CLEAR_SCOPES = new Set(['session', 'persisted', 'all']);
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

function keyLooksSensitive(key: string): boolean {
  const lower = key.toLowerCase();
  return DENY_SUBSTRINGS.some((deny) => lower.includes(deny));
}

function valueLooksSensitive(value: unknown): boolean {
  // Everything except primitives is stripped — we never transmit objects,
  // arrays, buffers, or anything that could structurally carry user data.
  if (value === null) return false;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return false;
  return true;
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
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export interface RedactionResult {
  event: TelemetryEvent;
  droppedKeys: string[];
}

/**
 * Strip everything not in the per-event allowlist, then defensively drop
 * anything whose key or value shape looks like user data slipped through.
 * The returned event is safe to send — the caller must still honor the
 * consent flag before calling this.
 */
export function redactForTelemetry(event: TelemetryEvent): RedactionResult {
  const allowed = EVENT_PROPERTY_ALLOWLIST[event.event];
  const allowedSet = new Set(allowed);
  const droppedKeys: string[] = [];
  const properties: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(event.properties)) {
    if (!allowedSet.has(key)) {
      droppedKeys.push(key);
      continue;
    }
    if (keyLooksSensitive(key) || valueLooksSensitive(value)) {
      droppedKeys.push(key);
      continue;
    }
    if (!isAllowedValue(event.event, key, value)) {
      droppedKeys.push(key);
      continue;
    }
    properties[key] = value as string | number | boolean;
  }

  return {
    event: {
      ...event,
      properties,
      // Round to the minute so nothing fingerprintable sneaks through the
      // timestamp field (helpful for users on small populations).
      timestamp: Math.floor(event.timestamp / 60_000) * 60_000,
    },
    droppedKeys,
  };
}

/** Bucket an OS version string into a coarse "platform/major" form. */
export function bucketOs(platform: string, version: string): string {
  if (!platform) return 'unknown';
  const major = version.match(/^\d+/u)?.[0] ?? 'unknown';
  return `${platform}/${major}`;
}

/**
 * Generate a coarse, non-persistent session id (32 hex chars). Used as a
 * fingerprint-resistant grouping key for events inside a single launch.
 * Deliberately module-agnostic so renderer + tests + any future main
 * emitter call through the same helper.
 */
export function createSessionId(): string {
  const source =
    typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'
      ? crypto
      : globalThis.crypto;
  if (!source || typeof source.getRandomValues !== 'function') {
    // Worst case (no Web Crypto): return a time-based fallback. Still
    // single-launch scoped — it never leaves memory and is only used to
    // group events, never to identify a user.
    return `t${Date.now().toString(16)}${Math.floor(Math.random() * 0xffffff).toString(16)}`.padEnd(32, '0');
  }
  const bytes = new Uint8Array(16);
  source.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Simple duration bucketer so we never transmit raw run times. */
export function bucketDurationMs(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  if (ms < 50) return 50;
  if (ms < 250) return 250;
  if (ms < 1000) return 1000;
  if (ms < 5000) return 5000;
  if (ms < 30_000) return 30_000;
  return 60_000;
}
