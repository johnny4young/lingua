import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTelemetry } from '../../src/renderer/hooks/useTelemetry';
import { trackEvent } from '../../src/renderer/utils/telemetry';

vi.mock('../../src/renderer/utils/telemetry', () => ({
  trackEvent: vi.fn().mockResolvedValue(undefined),
}));

describe('useTelemetry', () => {
  beforeEach(() => {
    vi.mocked(trackEvent).mockClear();
  });

  it('forwards the event and properties without changing their shape', () => {
    const { result } = renderHook(() => useTelemetry());

    act(() => {
      result.current.track('overlay.opened', { overlayId: 'palette' });
    });

    expect(trackEvent).toHaveBeenCalledOnce();
    expect(trackEvent).toHaveBeenCalledWith('overlay.opened', {
      overlayId: 'palette',
    });
  });

  it('uses an empty properties object when the caller omits it', () => {
    const { result } = renderHook(() => useTelemetry());

    act(() => {
      result.current.track('onboarding.first_snippet_saved');
    });

    expect(trackEvent).toHaveBeenCalledWith(
      'onboarding.first_snippet_saved',
      {}
    );
  });

  it('keeps the tracker and track function stable across rerenders', () => {
    const { result, rerender } = renderHook(() => useTelemetry());
    const firstTracker = result.current;
    const firstTrack = result.current.track;

    rerender();

    expect(result.current).toBe(firstTracker);
    expect(result.current.track).toBe(firstTrack);
  });
});
