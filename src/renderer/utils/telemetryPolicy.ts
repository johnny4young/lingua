import { useSettingsStore } from '../stores/settingsStore';

const UNRESOLVED = Symbol('unresolved');
let cachedEndpoint: string | null | typeof UNRESOLVED = UNRESOLVED;
let cachedKillSwitch: boolean | typeof UNRESOLVED = UNRESOLVED;
let invalidEndpointWarned = false;

/**
 * Reset the cached endpoint, kill switch, and warning flag. Test-only; the
 * production policy resolves each build-time value once per renderer launch.
 */
export function _resetEndpointCacheForTesting(): void {
  cachedEndpoint = UNRESOLVED;
  cachedKillSwitch = UNRESOLVED;
  invalidEndpointWarned = false;
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

  const localhostHosts: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  if (parsed.protocol === 'http:' && !localhostHosts.has(parsed.hostname)) {
    warnInvalidEndpointOnce(raw, 'plaintext');
    return null;
  }
  return parsed.toString();
}

export function resolveTelemetryEndpoint(): string | null {
  if (cachedEndpoint !== UNRESOLVED) return cachedEndpoint;
  cachedEndpoint = parseEndpoint(import.meta.env?.VITE_LINGUA_TELEMETRY_URL);
  return cachedEndpoint;
}

function resolveKillSwitch(): boolean {
  if (cachedKillSwitch !== UNRESOLVED) return cachedKillSwitch;
  const raw = import.meta.env?.VITE_LINGUA_TELEMETRY_DISABLED;
  cachedKillSwitch = raw === '1' || raw === 'true';
  return cachedKillSwitch;
}

/**
 * Privacy-first preflight shared by the lightweight client and lazy emitter.
 *
 * Store access is optional because persistence migrations can emit while the
 * settings module is still initializing. An unavailable store means no
 * consent, so telemetry stays disabled and initialization cannot fail.
 */
export function isTelemetryEnabled(): boolean {
  if (resolveKillSwitch()) return false;
  if (!resolveTelemetryEndpoint()) return false;
  return useSettingsStore?.getState?.().telemetryConsent === 'granted';
}
