import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDefaultOpenFileConsumer } from '../../src/renderer/hooks/useDefaultOpenFileConsumer';
import { useEditorStore } from '../../src/renderer/stores/editorStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';
import {
  _resetCommandBusForTesting,
  emitCommand,
  subscribeCommand,
  type OpenFileCommand,
} from '../../src/renderer/stores/commandBus';

describe('useDefaultOpenFileConsumer — RL-044 Slice 2b-β-α Fold H', () => {
  let pushSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    pushSpy = vi.spyOn(useUIStore.getState(), 'pushStatusNotice');
  });

  afterEach(() => {
    pushSpy.mockRestore();
    _resetCommandBusForTesting();
  });

  function dispatch(detail: unknown): void {
    emitCommand('file.open', detail as OpenFileCommand);
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
    // RL-044 Sub-slice G — empty `file` + `line > 0` is the
    // within-tab path; here it should be a no-op because no tab is
    // active in the editor store fixture by default. The push spy
    // stays at zero AND the editor reveal request stays null.
    const revealSpyClean = useEditorStore.getState().pendingReveal;
    expect(revealSpyClean).toBeNull();
    dispatch(null);
    expect(pushSpy).not.toHaveBeenCalled();
    unmount();
  });

  it('routes within-tab clicks (empty file + line > 0) through requestReveal — RL-044 Sub-slice G', () => {
    const requestRevealSpy = vi.spyOn(useEditorStore.getState(), 'requestReveal');
    // Seed the active tab so the consumer can move the cursor.
    useEditorStore.setState({
      activeTabId: 'tab-active',
      tabs: [
        {
          id: 'tab-active',
          name: 'scratch.js',
          language: 'javascript',
          content: '',
          workflowMode: 'scratchpad',
          runtimeMode: 'worker',
          autoLogEnabled: false,
        } as never,
      ],
    });
    const { unmount } = renderHook(() => useDefaultOpenFileConsumer());
    try {
      dispatch({ file: '', line: 7, column: 3 });
      expect(requestRevealSpy).toHaveBeenCalledWith({
        tabId: 'tab-active',
        line: 7,
        column: 3,
      });
      // The cross-file fallback notice should NOT fire for within-tab.
      expect(pushSpy).not.toHaveBeenCalled();
    } finally {
      requestRevealSpy.mockRestore();
      useEditorStore.setState({ activeTabId: null, tabs: [] });
      unmount();
    }
  });

  it('debounces within-tab clicks on the same active-tab line within 1500ms', () => {
    const requestRevealSpy = vi.spyOn(useEditorStore.getState(), 'requestReveal');
    useEditorStore.setState({
      activeTabId: 'tab-active',
      tabs: [
        {
          id: 'tab-active',
          name: 'scratch.js',
          language: 'javascript',
          content: '',
          workflowMode: 'scratchpad',
          runtimeMode: 'worker',
          autoLogEnabled: false,
        } as never,
      ],
    });
    const { unmount } = renderHook(() => useDefaultOpenFileConsumer());
    try {
      dispatch({ file: '', line: 7 });
      dispatch({ file: '', line: 7 });
      dispatch({ file: '', line: 7 });
      expect(requestRevealSpy).toHaveBeenCalledTimes(1);
    } finally {
      requestRevealSpy.mockRestore();
      useEditorStore.setState({ activeTabId: null, tabs: [] });
      unmount();
    }
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

  it('skips when a higher-priority consumer claims the command (RL-024 path)', () => {
    const unsubscribeClaimer = subscribeCommand(
      'file.open',
      (_payload, context) => context.markHandled(),
      { priority: 100 }
    );
    const { unmount } = renderHook(() => useDefaultOpenFileConsumer());
    try {
      dispatch({ file: 'src/claimed.ts', line: 42 });
      expect(pushSpy).not.toHaveBeenCalled();
    } finally {
      unsubscribeClaimer();
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
