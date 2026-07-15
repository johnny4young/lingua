import type { BrowserPreviewRefreshInterval } from '../../shared/browserPreviewRefresh';
import type { TelemetryTrack } from './useTelemetry';

let emittedThisSession = false;

/**
 * RL-119 Slice 1 — record adoption once per renderer session, never per
 * keystroke or refresh. Off cannot reach this helper because no run starts.
 */
export function trackBrowserPreviewAutoRefreshOnce(
  track: TelemetryTrack,
  language: string,
  intervalMs: Exclude<BrowserPreviewRefreshInterval, 0>
): void {
  if (emittedThisSession) return;
  emittedThisSession = true;
  track('runtime.browser_preview_auto_refresh', {
    language,
    intervalMs,
  });
}

/** Test-only: model a fresh renderer session. */
export function _resetBrowserPreviewAutoRefreshTelemetryForTesting(): void {
  emittedThisSession = false;
}
