import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/stores/settingsStore';

const emitter = vi.hoisted(() => ({
  loaded: vi.fn(),
  trackEvent: vi.fn<() => Promise<void>>(async () => {}),
}));

vi.mock('@/utils/telemetryEmitter', () => {
  emitter.loaded();
  return { trackEvent: emitter.trackEvent };
});

import { _resetEndpointCacheForTesting, trackEvent } from '@/utils/telemetry';

describe('startup-safe telemetry facade', () => {
  const initialSettings = useSettingsStore.getState();

  beforeEach(() => {
    emitter.loaded.mockClear();
    emitter.trackEvent.mockClear();
    emitter.trackEvent.mockResolvedValue();
    vi.unstubAllEnvs();
    useSettingsStore.setState(initialSettings, true);
    _resetEndpointCacheForTesting();
  });

  it('loads the emitter only after policy allows an event', async () => {
    vi.stubEnv('VITE_LINGUA_TELEMETRY_URL', 'http://localhost:8787/telemetry');
    _resetEndpointCacheForTesting();
    useSettingsStore.setState({ ...initialSettings, telemetryConsent: 'declined' });

    await trackEvent('app.launched', { platform: 'darwin' });
    expect(emitter.loaded).not.toHaveBeenCalled();
    expect(emitter.trackEvent).not.toHaveBeenCalled();

    useSettingsStore.setState({ ...initialSettings, telemetryConsent: 'granted' });
    await trackEvent('app.launched', { platform: 'darwin' });
    expect(emitter.loaded).toHaveBeenCalledTimes(1);
    expect(emitter.trackEvent).toHaveBeenCalledWith('app.launched', {
      platform: 'darwin',
    });
  });

  it('swallows emitter failures', async () => {
    vi.stubEnv('VITE_LINGUA_TELEMETRY_URL', 'http://localhost:8787/telemetry');
    _resetEndpointCacheForTesting();
    useSettingsStore.setState({ ...initialSettings, telemetryConsent: 'granted' });
    emitter.trackEvent.mockRejectedValueOnce(new Error('delivery failed'));

    await expect(trackEvent('overlay.opened', { overlayId: 'settings' })).resolves.toBeUndefined();
  });
});
