import {
  bucketOs,
  createSessionId,
  redactForTelemetry,
  type TelemetryEvent,
  type TelemetryEventName,
} from '../../shared/telemetry';
import { useLicenseStore } from '../stores/licenseStore';
import { recordTrustEventBestEffort } from '../stores/trustEventStore';
import { isTelemetryEnabled, resolveTelemetryEndpoint } from './telemetryPolicy';

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

// `var` is intentional here. Persistence migrations can emit telemetry during
// a circular import while this module is still initializing; `var` avoids a TDZ
// crash before `getSessionId()` gets its first lazy call.
// eslint-disable-next-line no-var
var cachedSessionId: string | null = null;

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
  const endpoint = resolveTelemetryEndpoint();
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
