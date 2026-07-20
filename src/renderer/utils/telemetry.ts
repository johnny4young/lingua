import {
  bucketOs,
  createSessionId,
  redactForTelemetry,
  type TelemetryEvent,
  type TelemetryEventName,
} from '../../shared/telemetry';
import { useLicenseStore } from '../stores/licenseStore';
import { useSettingsStore } from '../stores/settingsStore';
import { recordTrustEventBestEffort } from '../stores/trustEventStore';

/**
 * Telemetry emitter. Never fires without:
 *   1. the user having explicitly granted consent via Settings
 *   2. the build honoring the `LINGUA_TELEMETRY_DISABLED=1` kill switch
 *   3. a configured endpoint via `VITE_LINGUA_TELEMETRY_URL`
 *
 * Every payload is redacted through the shared `redactForTelemetry` pass so
 * only allow-listed properties survive. Errors are swallowed — a failing
 * analytics beacon must never take the app down.
 */

// Lazy resolution: the endpoint + kill switch are read on first
// access, not at module-load. Two reasons:
//   1. Test ergonomics — `vi.stubEnv` + dynamic re-import need the
//      values to be readable AFTER the stub fires, not baked into
//      the module's top-level `const`.
//   2. Robustness — module-load reads happen before bundlers can
//      always guarantee the env is set (e.g. Forge spawning the
//      renderer with a deferred `process.env` injection). Lazy
//      read sidesteps that timing.
const UNRESOLVED = Symbol('unresolved');
let cachedEndpoint: string | null | typeof UNRESOLVED = UNRESOLVED;
let cachedKillSwitch: boolean | typeof UNRESOLVED = UNRESOLVED;
let invalidEndpointWarned = false;
// `var` is intentional here. Persistence migrations can emit telemetry during
// a circular import while this module is still initializing; `var` avoids a TDZ
// crash before `getSessionId()` gets its first lazy call.
// eslint-disable-next-line no-var
var cachedSessionId: string | null = null;

/**
 * Reset the cached endpoint + kill-switch + warning flag. Test-only —
 * the production module reads each lazily and never resets.
 */
export function _resetEndpointCacheForTesting(): void {
  cachedEndpoint = UNRESOLVED;
  cachedKillSwitch = UNRESOLVED;
  invalidEndpointWarned = false;
}

/**
 * implementation note — coalesce window for the `telemetry` trust event.
 * One record per minute is enough for the Privacy dashboard's "last call"
 * read while keeping the cap-200 trust log from filling with telemetry rows.
 */
export const TELEMETRY_TRUST_THROTTLE_MS = 60_000;
let lastTelemetryTrustRecordMs = Number.NEGATIVE_INFINITY;

/**
 * Record a coalesced `telemetry` trust event. Called from
 * `emitTelemetryEvent` only after the consent + endpoint guard passes, so
 * it fires exactly when telemetry actually leaves the app. Summary is
 * metadata only — never the event name or properties.
 */
function recordTelemetrySendTrustEvent(now: number = Date.now()): void {
  if (now - lastTelemetryTrustRecordMs < TELEMETRY_TRUST_THROTTLE_MS) return;
  lastTelemetryTrustRecordMs = now;
  recordTrustEventBestEffort({
    feature: 'telemetry',
    action: 'event_sent',
    sensitivity: 'low',
    summary: 'Telemetry event sent',
  });
}

/** Test-only: reset the telemetry trust-event coalesce window. */
export function _resetTelemetryTrustThrottleForTesting(): void {
  lastTelemetryTrustRecordMs = Number.NEGATIVE_INFINITY;
}

function warnInvalidEndpointOnce(raw: string, reason: 'parse' | 'scheme' | 'plaintext'): void {
  if (invalidEndpointWarned) return;
  invalidEndpointWarned = true;
  const labels: Record<typeof reason, string> = {
    parse: 'not a valid URL',
    scheme: 'unsupported scheme (use http: against localhost or https: elsewhere)',
    plaintext: 'http:// only allowed against localhost; use https:// for remote hosts',
  };
  console.warn(
    `[telemetry] VITE_LINGUA_TELEMETRY_URL ignored: ${labels[reason]} — got ${JSON.stringify(raw)}`
  );
}

/**
 * Resolve the configured telemetry endpoint from the build-time
 * `VITE_LINGUA_TELEMETRY_URL` define. Returns `null` when the value
 * is missing, empty, malformed (rejected by the `URL` constructor),
 * or uses a non-https scheme — telemetry never flies over plaintext
 * to a misconfigured host.
 *
 * implementation note — a build-time typo (`http:/telemetry`)
 * used to silently swallow events because the emitter accepted any
 * non-empty string. The misconfigured-build warning above is fired
 * once per launch so a developer running the web bundle locally can
 * spot the error without it spamming the console.
 */
function resolveEndpoint(): string | null {
  if (cachedEndpoint !== UNRESOLVED) return cachedEndpoint;
  const raw = import.meta.env?.VITE_LINGUA_TELEMETRY_URL;
  cachedEndpoint = parseEndpoint(raw);
  return cachedEndpoint;
}

function parseEndpoint(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    warnInvalidEndpointOnce(raw, 'parse');
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    warnInvalidEndpointOnce(raw, 'scheme');
    return null;
  }
  // Plaintext is only allowed against the loopback host (`wrangler
  // dev` binds `localhost` on macOS/Linux and `127.0.0.1` on some
  // Windows configurations; both should diagnose as valid). A
  // production-looking host on http:// is almost certainly a typo
  // for https://.
  const LOCALHOST_HOSTS: ReadonlySet<string> = new Set([
    'localhost',
    '127.0.0.1',
    '[::1]',
    '::1',
  ]);
  if (parsed.protocol === 'http:' && !LOCALHOST_HOSTS.has(parsed.hostname)) {
    warnInvalidEndpointOnce(raw, 'plaintext');
    return null;
  }
  return parsed.toString();
}

function resolveKillSwitch(): boolean {
  if (cachedKillSwitch !== UNRESOLVED) return cachedKillSwitch;
  const raw = import.meta.env?.VITE_LINGUA_TELEMETRY_DISABLED;
  cachedKillSwitch = raw === '1' || raw === 'true';
  return cachedKillSwitch;
}

export function isTelemetryEnabled(): boolean {
  if (resolveKillSwitch()) return false;
  if (!resolveEndpoint()) return false;
  // `useSettingsStore` can be undefined here if telemetry fires during the
  // settings store's own persist migrate — `reportMigration`
  // calls `trackEvent` inside `createMigrate`, before the module binding is
  // assigned (a call-time import cycle). Treat an unavailable store as
  // no-consent: privacy-safe (defaults to NOT sending) and crash-free, which
  // honors this function's documented "never affects rehydration" contract.
  return useSettingsStore?.getState?.().telemetryConsent === 'granted';
}

export async function emitTelemetryEvent(
  event: TelemetryEventName,
  properties: Record<string, string | number | boolean> = {},
  base: Partial<
    Pick<TelemetryEvent, 'appVersion' | 'osBucket' | 'licenseStatus' | 'sessionId'>
  > = {}
): Promise<void> {
  // `isTelemetryEnabled` already guards on the endpoint, the kill switch,
  // and user consent. Keeping the single guard here means there is only one
  // place to audit when the privacy contract changes.
  const endpoint = resolveEndpoint();
  if (!isTelemetryEnabled() || !endpoint) return;

  // implementation note — mirror the outbound telemetry into the local
  // trust log so the Privacy dashboard's `telemetry` row shows a real last
  // call. Coalesced (<=1 / TELEMETRY_TRUST_THROTTLE_MS) because telemetry is
  // high-frequency and would otherwise churn the cap-200 trust log. `record`
  // is a local store write (no network, no telemetry) so there is no
  // recursion back into this function.
  recordTelemetrySendTrustEvent();

  const payload: TelemetryEvent = {
    event,
    appVersion: base.appVersion ?? 'unknown',
    osBucket: base.osBucket ?? 'unknown',
    licenseStatus: base.licenseStatus ?? 'free',
    sessionId: base.sessionId ?? 'unknown',
    properties,
    timestamp: Date.now(),
  };

  const { event: redacted } = redactForTelemetry(payload);

  try {
    await fetch(endpoint, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(redacted),
    });
  } catch {
    // Silent — telemetry is best-effort.
  }
}

/**
 * Session id is generated once per renderer launch and never persisted.
 * It is resolved lazily instead of as a top-level const because persist
 * migrations can fire telemetry while this module is still initializing.
 */
function getSessionId(): string {
  cachedSessionId ??= createSessionId();
  return cachedSessionId;
}

export function resolveTelemetryBase(): Pick<
  TelemetryEvent,
  'appVersion' | 'osBucket' | 'licenseStatus' | 'sessionId'
> {
  const platform =
    typeof navigator !== 'undefined' && typeof navigator.platform === 'string'
      ? navigator.platform.toLowerCase()
      : 'unknown';
  // We bucket the OS into "platform/major" — see
  // `src/shared/telemetry.ts` for the contract. The userAgent is not
  // inspected because it's fingerprint-heavy.
  const osBucket = bucketOs(platform.split(' ')[0] ?? 'unknown', '0');

  const licenseStatus = useLicenseStore.getState().status.kind;

  return {
    appVersion: import.meta.env?.VITE_LINGUA_APP_VERSION ?? '0.0.0',
    osBucket,
    licenseStatus,
    sessionId: getSessionId(),
  };
}

/**
 * Convenience wrapper that composes the base fields with the caller's
 * per-event properties. Returns a promise the caller can ignore — every
 * failure mode is already swallowed inside `emitTelemetryEvent`.
 */
export async function trackEvent(
  event: TelemetryEventName,
  properties: Record<string, string | number | boolean> = {}
): Promise<void> {
  try {
    await emitTelemetryEvent(event, properties, resolveTelemetryBase());
  } catch {
    // Best-effort means best-effort even during circular module initialization
    // (persist migrations can call this while telemetry caches are still in TDZ).
  }
}

/**
 * implementation Sub-slice G implementation note — burst-throttled emit for
 * `runtime.output_origin_clicked`. Users debugging a loop frequently
 * click 10-20 `<OutputLineBadge>` chips in a few seconds; without a
 * throttle the dashboard fills with noise indistinguishable from
 * a true adoption spike. Cap is 1 emit per OUTPUT_ORIGIN_THROTTLE_MS
 * per `(language, surface)` bucket so each combination still surfaces
 * separately.
 *
 * The throttle is renderer-local (Map at module scope) — survives
 * across React re-renders but resets on full reload, which is the
 * desired session boundary for adoption analytics.
 *
 * Pattern mirrors the debounce key Map in
 * `src/renderer/hooks/useDefaultOpenFileConsumer.ts`.
 */
export const OUTPUT_ORIGIN_THROTTLE_MS = 1000;
const outputOriginLastEmittedMs = new Map<string, number>();

export function trackOutputOriginClicked(
  language: string,
  surface: 'badge',
  now: () => number = () => Date.now()
): { emitted: boolean } {
  const key = `${language}::${surface}`;
  const current = now();
  const last = outputOriginLastEmittedMs.get(key) ?? Number.NEGATIVE_INFINITY;
  if (current - last < OUTPUT_ORIGIN_THROTTLE_MS) {
    return { emitted: false };
  }
  outputOriginLastEmittedMs.set(key, current);
  void trackEvent('runtime.output_origin_clicked', { language, surface });
  return { emitted: true };
}

/** Test-only: reset the throttle state so unit tests stay independent. */
export function resetOutputOriginThrottleForTests(): void {
  outputOriginLastEmittedMs.clear();
}
