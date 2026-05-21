import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDefaultOpenFileConsumer } from '../../src/renderer/hooks/useDefaultOpenFileConsumer';
import { useUIStore } from '../../src/renderer/stores/uiStore';

describe('useDefaultOpenFileConsumer — RL-044 Slice 2b-β-α Fold H', () => {
  let pushSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    pushSpy = vi.spyOn(useUIStore.getState(), 'pushStatusNotice');
  });

  afterEach(() => {
    pushSpy.mockRestore();
  });

  function dispatch(detail: unknown): void {
    window.dispatchEvent(new CustomEvent('lingua-open-file', { detail }));
  }

  it('pushes a fallback status notice when no RL-024 consumer is registered', () => {
    const { unmount } = renderHook(() => useDefaultOpenFileConsumer());
    dispatch({ file: 'src/example.ts', line: 12, column: 5 });
    expect(pushSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: 'info',
        messageKey: 'openFile.toast.unavailable',
        values: { file: 'src/example.ts', line: 12 },
      })
    );
    unmount();
  });

  it('ignores events without a clickable file/line pair', () => {
    const { unmount } = renderHook(() => useDefaultOpenFileConsumer());
    dispatch({ file: '', line: 0 });
    dispatch({ file: 'src/x.ts' });
    dispatch({ line: 5 });
    dispatch(null);
    expect(pushSpy).not.toHaveBeenCalled();
    unmount();
  });

  it('debounces duplicate file:line within 1500ms', () => {
    const { unmount } = renderHook(() => useDefaultOpenFileConsumer());
    dispatch({ file: 'src/example.ts', line: 12 });
    dispatch({ file: 'src/example.ts', line: 12 });
    dispatch({ file: 'src/example.ts', line: 12 });
    expect(pushSpy).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('routes distinct file:line pairs through independently', () => {
    const { unmount } = renderHook(() => useDefaultOpenFileConsumer());
    dispatch({ file: 'src/a.ts', line: 1 });
    dispatch({ file: 'src/b.ts', line: 2 });
    expect(pushSpy).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('skips when a higher-priority consumer called preventDefault (RL-024 path)', () => {
    // Register the higher-priority consumer BEFORE the hook mounts so
    // it runs first in document order. By the time the hook's handler
    // sees the event, `defaultPrevented` is already true.
    const claimer = (event: Event) => event.preventDefault();
    window.addEventListener('lingua-open-file', claimer);
    const { unmount } = renderHook(() => useDefaultOpenFileConsumer());
    try {
      // cancelable: true is required so preventDefault actually marks
      // the event as defaultPrevented (matches the RichValueError
      // dispatch site).
      window.dispatchEvent(
        new CustomEvent('lingua-open-file', {
          detail: { file: 'src/claimed.ts', line: 42 },
          cancelable: true,
        })
      );
      expect(pushSpy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('lingua-open-file', claimer);
      unmount();
    }
  });

  it('keeps the debounce cache bounded during distinct click bursts', () => {
    const { unmount } = renderHook(() => useDefaultOpenFileConsumer());
    for (let i = 0; i < 33; i += 1) {
      dispatch({ file: `src/${i}.ts`, line: i + 1 });
    }
    expect(pushSpy).toHaveBeenCalledTimes(33);

    dispatch({ file: 'src/0.ts', line: 1 });
    expect(pushSpy).toHaveBeenCalledTimes(34);
    unmount();
  });

  it('detaches the listener on unmount', () => {
    const { unmount } = renderHook(() => useDefaultOpenFileConsumer());
    unmount();
    dispatch({ file: 'src/post-unmount.ts', line: 1 });
    expect(pushSpy).not.toHaveBeenCalled();
  });
});
