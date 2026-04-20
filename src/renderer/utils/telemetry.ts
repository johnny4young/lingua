import {
  type TelemetryEvent,
  type TelemetryEventName,
  redactForTelemetry,
} from '../../shared/telemetry';
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
