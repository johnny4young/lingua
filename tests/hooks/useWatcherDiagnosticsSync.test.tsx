import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useWatcherDiagnosticsSync } from '@/hooks/useWatcherDiagnosticsSync';
import { useUIStore } from '@/stores/uiStore';

function Harness() {
  useWatcherDiagnosticsSync();
  return null;
}

describe('useWatcherDiagnosticsSync', () => {
  const mockOnWatcherFailed =
    vi.fn<LinguaAPI['fs']['onWatcherFailed']>();
  const mockOnWatcherDegraded =
    vi.fn<LinguaAPI['fs']['onWatcherDegraded']>();
  let emitFailed: ((diagnostic: WatcherDiagnostic) => void) | null = null;
  let emitDegraded: ((diagnostic: WatcherDiagnostic) => void) | null = null;
  let unsubscribeFailed: ReturnType<typeof vi.fn>;
  let unsubscribeDegraded: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    emitFailed = null;
    emitDegraded = null;
    unsubscribeFailed = vi.fn();
    unsubscribeDegraded = vi.fn();
    mockOnWatcherFailed.mockImplementation((callback) => {
      emitFailed = callback;
      return unsubscribeFailed;
    });
    mockOnWatcherDegraded.mockImplementation((callback) => {
      emitDegraded = callback;
      return unsubscribeDegraded;
    });
    useUIStore.setState({ statusNotice: null });
    Object.defineProperty(globalThis, 'window', {
      value: {
        ...globalThis.window,
        lingua: {
          ...(globalThis.window?.lingua ?? {}),
          fs: {
            ...(globalThis.window?.lingua?.fs ?? {}),
            onWatcherFailed: mockOnWatcherFailed,
            onWatcherDegraded: mockOnWatcherDegraded,
          },
        },
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    useUIStore.setState({ statusNotice: null });
  });

  it('subscribes to both channels on mount and unsubscribes on unmount', () => {
    const { unmount } = render(<Harness />);
    expect(mockOnWatcherFailed).toHaveBeenCalledOnce();
    expect(mockOnWatcherDegraded).toHaveBeenCalledOnce();

    unmount();
    expect(unsubscribeFailed).toHaveBeenCalledOnce();
    expect(unsubscribeDegraded).toHaveBeenCalledOnce();
  });

  it('pushes a sticky error notice with the kind-specific key on failure', () => {
    render(<Harness />);
    emitFailed?.({
      kind: 'permission-denied',
      rootId: 'root-1',
      relativePath: '',
      errorMessage: 'EACCES',
    });

    const notice = useUIStore.getState().statusNotice;
    expect(notice).toMatchObject({
      tone: 'error',
      messageKey: 'explorer.watcher.failed.permission-denied',
    });
  });

  it.each([
    'permission-denied',
    'system-limit',
    'path-not-found',
    'unknown',
  ] as const)(
    'maps watcher kind %s to the matching messageKey',
    (kind) => {
      render(<Harness />);
      emitFailed?.({
        kind,
        rootId: 'root-1',
        relativePath: '',
        errorMessage: 'boom',
      });

      const notice = useUIStore.getState().statusNotice;
      expect(notice?.messageKey).toBe(`explorer.watcher.failed.${kind}`);
      expect(notice?.tone).toBe('error');
    }
  );

  it('falls back to the unknown copy for malformed watcher diagnostics', () => {
    render(<Harness />);
    emitFailed?.({
      kind: 'other-kind',
      rootId: 'root-1',
      relativePath: '',
      errorMessage: 'boom',
    } as unknown as WatcherDiagnostic);

    const notice = useUIStore.getState().statusNotice;
    expect(notice?.messageKey).toBe('explorer.watcher.failed.unknown');
    expect(notice?.tone).toBe('error');
  });

  it('does not crash when the watcher failure payload is null', () => {
    render(<Harness />);
    expect(() => emitFailed?.(null as unknown as WatcherDiagnostic)).not.toThrow();

    const notice = useUIStore.getState().statusNotice;
    expect(notice?.messageKey).toBe('explorer.watcher.failed.unknown');
    expect(notice?.tone).toBe('error');
  });

  it('pushes a warning notice on degraded events', () => {
    render(<Harness />);
    emitDegraded?.({
      kind: 'system-limit',
      rootId: 'root-1',
      relativePath: '',
      errorMessage: 'overflow',
    });

    const notice = useUIStore.getState().statusNotice;
    expect(notice).toMatchObject({
      tone: 'warning',
      messageKey: 'explorer.watcher.degraded',
    });
  });

  it('survives missing fs subscription methods (web stub fallback)', () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        ...globalThis.window,
        lingua: {
          ...(globalThis.window?.lingua ?? {}),
          fs: {
            ...(globalThis.window?.lingua?.fs ?? {}),
            onWatcherFailed: undefined,
            onWatcherDegraded: undefined,
          },
        },
      },
      writable: true,
      configurable: true,
    });

    expect(() => render(<Harness />).unmount()).not.toThrow();
  });
});
