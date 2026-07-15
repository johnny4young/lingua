import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetBrowserPreviewAutoRefreshTelemetryForTesting,
  trackBrowserPreviewAutoRefreshOnce,
} from '@/hooks/browserPreviewRefreshTelemetry';

describe('Browser preview auto-refresh telemetry (RL-119 Slice 1)', () => {
  const track = vi.fn();

  beforeEach(() => {
    track.mockClear();
    _resetBrowserPreviewAutoRefreshTelemetryForTesting();
  });

  it('emits only the first actual refresh per renderer session', () => {
    trackBrowserPreviewAutoRefreshOnce(track, 'javascript', 300);
    trackBrowserPreviewAutoRefreshOnce(track, 'javascript', 300);
    trackBrowserPreviewAutoRefreshOnce(track, 'typescript', 1_000);

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('runtime.browser_preview_auto_refresh', {
      language: 'javascript',
      intervalMs: 300,
    });
  });
});
