import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDownloadedUpdateNotice } from '@/hooks/useDownloadedUpdateNotice';
import { useUpdateStore } from '@/stores/updateStore';
import { useUIStore } from '@/stores/uiStore';

// Replace pushStatusNotice on the live store object so multiple tests
// in the same suite get fresh mocks without leaking call counts.
let pushSpy: ReturnType<typeof vi.fn>;
const initialUIState = useUIStore.getState();
const initialUpdateState = useUpdateStore.getState();

beforeEach(() => {
  pushSpy = vi.fn();
  useUIStore.setState({
    statusNotice: null,
    pushStatusNotice: pushSpy,
  });
  useUpdateStore.setState({
    status: 'idle',
    supported: true,
    enabled: true,
    message: '',
    releaseName: undefined,
    releaseNotes: undefined,
    updateURL: undefined,
    lastCheckedAt: undefined,
    initialized: true,
  });
});

afterEach(() => {
  useUIStore.setState(initialUIState, true);
  useUpdateStore.setState(initialUpdateState, true);
  vi.restoreAllMocks();
});

describe('useDownloadedUpdateNotice', () => {
  it('does not fire while status is anything other than downloaded', () => {
    renderHook(() => useDownloadedUpdateNotice());
    act(() => {
      useUpdateStore.setState({ status: 'available', releaseName: 'v0.4.0' });
    });
    act(() => {
      useUpdateStore.setState({ status: 'checking' });
    });
    act(() => {
      useUpdateStore.setState({ status: 'not-available' });
    });
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('fires exactly once when status transitions to downloaded', () => {
    const { rerender } = renderHook(() => useDownloadedUpdateNotice());
    act(() => {
      useUpdateStore.setState({ status: 'downloaded', releaseName: 'v0.4.0' });
    });
    rerender();
    rerender();

    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith({
      tone: 'success',
      messageKey: 'updates.notice.downloaded',
      values: { version: 'v0.4.0' },
    });
  });

  it('re-fires when a different release downloads in the same session', () => {
    const { rerender } = renderHook(() => useDownloadedUpdateNotice());

    act(() => {
      useUpdateStore.setState({ status: 'downloaded', releaseName: 'v0.4.0' });
    });
    rerender();
    expect(pushSpy).toHaveBeenCalledTimes(1);

    // User dismisses the toast and later a follow-up release lands.
    act(() => {
      useUpdateStore.setState({ status: 'checking', releaseName: undefined });
    });
    rerender();
    act(() => {
      useUpdateStore.setState({ status: 'downloaded', releaseName: 'v0.5.0' });
    });
    rerender();

    expect(pushSpy).toHaveBeenCalledTimes(2);
    expect(pushSpy).toHaveBeenLastCalledWith({
      tone: 'success',
      messageKey: 'updates.notice.downloaded',
      values: { version: 'v0.5.0' },
    });
  });

  it('falls back to generic copy when releaseName is missing', () => {
    renderHook(() => useDownloadedUpdateNotice());
    act(() => {
      useUpdateStore.setState({ status: 'downloaded', releaseName: undefined });
    });

    expect(pushSpy).toHaveBeenCalledWith({
      tone: 'success',
      messageKey: 'updates.notice.downloadedGeneric',
    });
  });
});
