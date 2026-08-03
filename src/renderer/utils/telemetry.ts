import type { TelemetryEventName } from '../../shared/telemetry';
import { isTelemetryEnabled } from './telemetryPolicy';

export { _resetEndpointCacheForTesting, isTelemetryEnabled } from './telemetryPolicy';

/**
 * Startup-safe telemetry entry point.
 *
 * The policy check stays in the eager graph because it is small and prevents
 * builds without an endpoint, or users without consent, from downloading the
 * full event catalog, redactor, license base fields, and trust-ledger emitter.
 * Configured consenting sessions load that implementation on their first
 * event. The module loader caches the promise for every later call.
 */
export async function trackEvent(
  event: TelemetryEventName,
  properties: Record<string, string | number | boolean> = {}
): Promise<void> {
  if (!isTelemetryEnabled()) return;
  try {
    const { trackEvent: emit } = await import('./telemetryEmitter');
    await emit(event, properties);
  } catch {
    // Telemetry remains best-effort, including chunk-load failures.
  }
}

/**
 * Burst-throttled output-origin adoption signal.
 *
 * This tiny synchronous guard remains in the facade because callers need the
 * immediate `emitted` result, while the actual network emitter can stay lazy.
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
