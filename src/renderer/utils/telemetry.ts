import {
  bucketOs,
  createSessionId,
  redactForTelemetry,
  type TelemetryEvent,
  type TelemetryEventName,
} from '../../shared/telemetry';
import { useLicenseStore } from '../stores/licenseStore';
import { useSettingsStore } from '../stores/settingsStore';

/**
 * Telemetry emitter (RL-065). Never fires without:
 *   1. the user having explicitly granted consent via Settings
 *   2. the build honoring the `LINGUA_TELEMETRY_DISABLED=1` kill switch
 *   3. a configured endpoint via `VITE_LINGUA_TELEMETRY_URL`
 *
 * Every payload is redacted through the shared `redactForTelemetry` pass so
 * only allow-listed properties survive. Errors are swallowed — a failing
 * analytics beacon must never take the app down.
 */

const ENDPOINT: string | null = readEndpoint();
const KILL_SWITCH: boolean = readKillSwitch();

function readEndpoint(): string | null {
  const url = import.meta.env?.VITE_LINGUA_TELEMETRY_URL;
  return typeof url === 'string' && url.length > 0 ? url : null;
}

function readKillSwitch(): boolean {
  const raw = import.meta.env?.VITE_LINGUA_TELEMETRY_DISABLED;
  return raw === '1' || raw === 'true';
}

export function isTelemetryEnabled(): boolean {
  if (KILL_SWITCH) return false;
  if (!ENDPOINT) return false;
  return useSettingsStore.getState().telemetryConsent === 'granted';
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
  if (!isTelemetryEnabled() || !ENDPOINT) return;

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
    await fetch(ENDPOINT, {
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
 * Sessionid is generated once per renderer launch and never persisted.
 * We keep it at module scope so the same id tags every event fired in
 * this tab / window, and a fresh launch gets a fresh id automatically.
 */
const SESSION_ID = createSessionId();

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
    sessionId: SESSION_ID,
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
  await emitTelemetryEvent(event, properties, resolveTelemetryBase());
}
