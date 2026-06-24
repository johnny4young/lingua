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
    vi.unstubAllEnvs();
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

  it('trackOutputOriginClicked emits the first click at time zero and throttles per bucket', async () => {
    vi.stubEnv('VITE_LINGUA_TELEMETRY_URL', 'http://localhost:8787/telemetry');
    const {
      _resetEndpointCacheForTesting,
      OUTPUT_ORIGIN_THROTTLE_MS,
      resetOutputOriginThrottleForTests,
      trackOutputOriginClicked,
    } = await import('@/utils/telemetry');
    _resetEndpointCacheForTesting();
    resetOutputOriginThrottleForTests();
    useSettingsStore.setState({ ...initialSettings, telemetryConsent: 'granted' });

    expect(trackOutputOriginClicked('javascript', 'badge', () => 0)).toEqual({
      emitted: true,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    expect(
      trackOutputOriginClicked('javascript', 'badge', () => OUTPUT_ORIGIN_THROTTLE_MS - 1)
    ).toEqual({ emitted: false });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    expect(
      trackOutputOriginClicked('javascript', 'badge', () => OUTPUT_ORIGIN_THROTTLE_MS)
    ).toEqual({ emitted: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(firstBody.event).toBe('runtime.output_origin_clicked');
    expect(firstBody.properties).toEqual({ language: 'javascript', surface: 'badge' });
  });
});

/**
 * RL-065 Slice 5 fold F — endpoint URL validation. A typo like
 * `http:/telemetry` used to silently swallow every event because the
 * emitter accepted any non-empty string. The module-load probe now
 * runs the value through `new URL()` and an https-or-localhost
 * scheme check; misconfigured values warn once and resolve to null
 * so `isTelemetryEnabled()` stays false.
 *
 * `readEndpoint` is module-local, so the tests here exercise the
 * behaviour through `vi.resetModules()` plus `vi.stubEnv` for the
 * vite import.meta.env value. Each test re-imports the module to
 * pick up a fresh endpoint resolution.
 */
describe('readEndpoint URL validation (fold F)', () => {
  const initialSettings = useSettingsStore.getState();
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    useSettingsStore.setState(initialSettings, true);
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    const { _resetEndpointCacheForTesting } = await import('@/utils/telemetry');
    _resetEndpointCacheForTesting();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    useSettingsStore.setState(initialSettings, true);
    const { _resetEndpointCacheForTesting } = await import('@/utils/telemetry');
    _resetEndpointCacheForTesting();
    vi.restoreAllMocks();
  });

  it('rejects a malformed endpoint and stays disabled', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('VITE_LINGUA_TELEMETRY_URL', 'http:/telemetry'); // missing slash
    const { isTelemetryEnabled } = await import('@/utils/telemetry');
    useSettingsStore.setState({ ...initialSettings, telemetryConsent: 'granted' });
    expect(isTelemetryEnabled()).toBe(false);
    // Warning fires once for the misconfigured value so a developer
    // hitting this in `pnpm run preview:web` can diagnose without it
    // spamming the console.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('telemetry');
  });

  it('rejects an ftp:// scheme and stays disabled', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('VITE_LINGUA_TELEMETRY_URL', 'ftp://example.com/telemetry');
    const { isTelemetryEnabled } = await import('@/utils/telemetry');
    useSettingsStore.setState({ ...initialSettings, telemetryConsent: 'granted' });
    expect(isTelemetryEnabled()).toBe(false);
  });

  it('rejects http:// against a non-localhost host', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('VITE_LINGUA_TELEMETRY_URL', 'http://example.com/telemetry');
    const { isTelemetryEnabled } = await import('@/utils/telemetry');
    useSettingsStore.setState({ ...initialSettings, telemetryConsent: 'granted' });
    expect(isTelemetryEnabled()).toBe(false);
  });

  it('accepts http://localhost for `wrangler dev` against a worker', async () => {
    vi.stubEnv('VITE_LINGUA_TELEMETRY_URL', 'http://localhost:8787/telemetry');
    const { isTelemetryEnabled } = await import('@/utils/telemetry');
    useSettingsStore.setState({ ...initialSettings, telemetryConsent: 'granted' });
    expect(isTelemetryEnabled()).toBe(true);
  });

  it('also accepts http://127.0.0.1 — wrangler dev binds the loopback IP on some platforms', async () => {
    vi.stubEnv('VITE_LINGUA_TELEMETRY_URL', 'http://127.0.0.1:8787/telemetry');
    const { isTelemetryEnabled } = await import('@/utils/telemetry');
    useSettingsStore.setState({ ...initialSettings, telemetryConsent: 'granted' });
    expect(isTelemetryEnabled()).toBe(true);
  });

  it('accepts a valid https endpoint and reports enabled when consent is granted', async () => {
    vi.stubEnv('VITE_LINGUA_TELEMETRY_URL', 'https://updates.linguacode.dev/telemetry');
    const { isTelemetryEnabled } = await import('@/utils/telemetry');
    useSettingsStore.setState({ ...initialSettings, telemetryConsent: 'granted' });
    expect(isTelemetryEnabled()).toBe(true);
  });

  it('warns at most once across multiple trackEvent calls in a single launch', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('VITE_LINGUA_TELEMETRY_URL', 'http:/telemetry');
    const { trackEvent } = await import('@/utils/telemetry');
    useSettingsStore.setState({ ...initialSettings, telemetryConsent: 'granted' });
    await trackEvent('app.launched', { platform: 'darwin' });
    await trackEvent('overlay.opened', { overlayId: 'whats-new' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  // RL-096 Slice 2 fold B — coalesced telemetry trust capture.
  it('records a coalesced telemetry trust event when telemetry actually sends', async () => {
    vi.stubEnv('VITE_LINGUA_TELEMETRY_URL', 'http://localhost:8787/telemetry');
    const {
      trackEvent,
      _resetEndpointCacheForTesting,
      _resetTelemetryTrustThrottleForTesting,
    } = await import('@/utils/telemetry');
    const { useTrustEventStore, _resetTrustEventCounterForTesting } = await import(
      '@/stores/trustEventStore'
    );
    _resetEndpointCacheForTesting();
    _resetTelemetryTrustThrottleForTesting();
    _resetTrustEventCounterForTesting();
    useTrustEventStore.getState().clear();
    useSettingsStore.setState({ ...initialSettings, telemetryConsent: 'granted' });

    const telemetryEvents = () =>
      useTrustEventStore.getState().events.filter((e) => e.feature === 'telemetry');

    await trackEvent('app.launched', { platform: 'darwin' });
    await trackEvent('overlay.opened', { overlayId: 'whats-new' });
    // Two sends inside the coalesce window → exactly one trust event.
    expect(telemetryEvents()).toHaveLength(1);
    expect(telemetryEvents()[0]).toMatchObject({
      feature: 'telemetry',
      action: 'event_sent',
      sensitivity: 'low',
    });

    // Simulate the coalesce window elapsing → the next send records again.
    _resetTelemetryTrustThrottleForTesting();
    await trackEvent('app.launched', { platform: 'darwin' });
    expect(telemetryEvents()).toHaveLength(2);
  });

  it('records no telemetry trust event when telemetry is gated off', async () => {
    const { trackEvent, _resetTelemetryTrustThrottleForTesting } = await import(
      '@/utils/telemetry'
    );
    const { useTrustEventStore } = await import('@/stores/trustEventStore');
    _resetTelemetryTrustThrottleForTesting();
    useTrustEventStore.getState().clear();
    useSettingsStore.setState({ ...initialSettings, telemetryConsent: 'declined' });
    await trackEvent('app.launched', { platform: 'darwin' });
    expect(
      useTrustEventStore.getState().events.filter((e) => e.feature === 'telemetry')
    ).toHaveLength(0);
  });

  it('still sends telemetry when local trust capture storage fails', async () => {
    vi.stubEnv('VITE_LINGUA_TELEMETRY_URL', 'http://localhost:8787/telemetry');
    const {
      trackEvent,
      _resetEndpointCacheForTesting,
      _resetTelemetryTrustThrottleForTesting,
    } = await import('@/utils/telemetry');
    const { useTrustEventStore } = await import('@/stores/trustEventStore');
    _resetEndpointCacheForTesting();
    _resetTelemetryTrustThrottleForTesting();
    vi.spyOn(useTrustEventStore.getState(), 'record').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    useSettingsStore.setState({ ...initialSettings, telemetryConsent: 'granted' });

    await trackEvent('app.launched', { platform: 'darwin' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
