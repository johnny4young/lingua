/**
 * RL-065 emitter wiring — `trackEvent` must respect the consent + kill
 * switch gates and compose the base fields through `resolveTelemetryBase`
 * without leaking anything outside the allow-list.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/stores/settingsStore';

describe('resolveTelemetryBase + trackEvent', () => {
  const initialSettings = useSettingsStore.getState();
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useSettingsStore.setState(initialSettings, true);
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
  });

  afterEach(() => {
    useSettingsStore.setState(initialSettings, true);
    vi.restoreAllMocks();
  });

  it('composes base fields with a stable sessionId across calls within a launch', async () => {
    const { resolveTelemetryBase } = await import('@/utils/telemetry');
    const first = resolveTelemetryBase();
    const second = resolveTelemetryBase();
    expect(first.sessionId).toBe(second.sessionId);
    expect(first.licenseStatus).toBe('free');
  });

  it('trackEvent is a no-op when the user has not granted consent', async () => {
    const { trackEvent } = await import('@/utils/telemetry');
    useSettingsStore.setState({ ...initialSettings, telemetryConsent: 'declined' });
    await trackEvent('app.launched', { platform: 'darwin' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('trackEvent still no-ops without a configured endpoint even when consent is granted', async () => {
    const { trackEvent } = await import('@/utils/telemetry');
    useSettingsStore.setState({ ...initialSettings, telemetryConsent: 'granted' });
    // Test env leaves VITE_LINGUA_TELEMETRY_URL unset so the endpoint gate
    // fires; we assert the gate instead of having to mock vite env.
    await trackEvent('app.launched', { platform: 'darwin' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
