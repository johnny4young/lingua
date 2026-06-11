/**
 * RL-147 (AUDIT-27) — behavioral contract of the debounced session
 * auto-save. The §3.10 regression this locks: transient editor-store
 * mutations (pendingReveal, isDirty churn, per-run execution-state
 * flips) must neither schedule a save nor POSTPONE one already
 * pending; only save-relevant changes re-arm the 1 s window. Fold C
 * adds the flush-on-exit contract (pagehide / visibilitychange).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSessionAutoSave } from '@/hooks/useSessionAutoSave';
import { useEditorStore } from '@/stores/editorStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useSettingsStore } from '@/stores/settingsStore';

const initialSessionState = useSessionStore.getState();
const initialEditorState = useEditorStore.getState();
const initialSettingsState = useSettingsStore.getState();

const UNTITLED_TAB = {
  id: 'tab-1',
  name: 'untitled.ts',
  language: 'typescript' as const,
  content: 'const x = 1;',
  isDirty: false,
};

describe('useSessionAutoSave (RL-147)', () => {
  let saveSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    saveSpy = vi.fn();
    useEditorStore.setState({ tabs: [UNTITLED_TAB], activeTabId: 'tab-1' });
    useSessionStore.setState({ saveSession: saveSpy });
    useSettingsStore.setState({ restoreSession: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    useSessionStore.setState(initialSessionState, true);
    useEditorStore.setState(initialEditorState, true);
    useSettingsStore.setState(initialSettingsState, true);
  });

  function changeUntitledContent(content: string): void {
    useEditorStore.setState({ tabs: [{ ...UNTITLED_TAB, content }] });
  }

  function transientMutationBurst(): void {
    useEditorStore.setState({ pendingReveal: { tabId: 'tab-1', line: 1, column: 1 } });
    useEditorStore.setState({ tabs: [{ ...useEditorStore.getState().tabs[0]!, isDirty: true }] });
    useEditorStore.setState({ pendingReveal: null });
  }

  it('schedules exactly one save 1 s after an untitled content change', () => {
    renderHook(() => useSessionAutoSave(false));

    changeUntitledContent('const x = 2;');
    vi.advanceTimersByTime(999);
    expect(saveSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(saveSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('does not schedule a save for transient-only mutations', () => {
    renderHook(() => useSessionAutoSave(false));

    transientMutationBurst();
    vi.advanceTimersByTime(5000);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('a transient burst mid-window does not postpone the pending save (§3.10)', () => {
    renderHook(() => useSessionAutoSave(false));

    changeUntitledContent('const x = 2;');
    vi.advanceTimersByTime(500);
    transientMutationBurst();
    // Before RL-147 the burst re-armed the timer, so 500 ms later the
    // save had still not fired. Now it fires exactly at the original
    // 1 s mark.
    vi.advanceTimersByTime(500);
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('does not schedule for content edits on disk-backed tabs', () => {
    useEditorStore.setState({
      tabs: [{ ...UNTITLED_TAB, filePath: '/p/file.ts' }],
    });
    renderHook(() => useSessionAutoSave(false));

    useEditorStore.setState({
      tabs: [{ ...UNTITLED_TAB, filePath: '/p/file.ts', content: 'edited on disk tab' }],
    });
    vi.advanceTimersByTime(5000);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('stays inert when the restoreSession setting is off', () => {
    useSettingsStore.setState({ restoreSession: false });
    renderHook(() => useSessionAutoSave(false));

    changeUntitledContent('const x = 2;');
    vi.advanceTimersByTime(5000);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('stays inert under desktop smoke mode', () => {
    renderHook(() => useSessionAutoSave(true));

    changeUntitledContent('const x = 2;');
    vi.advanceTimersByTime(5000);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('unmount clears a pending save', () => {
    const { unmount } = renderHook(() => useSessionAutoSave(false));

    changeUntitledContent('const x = 2;');
    unmount();
    vi.advanceTimersByTime(5000);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  describe('flush-on-exit (fold C)', () => {
    function setVisibilityState(value: 'hidden' | 'visible'): void {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => value,
      });
    }

    afterEach(() => {
      setVisibilityState('visible');
    });

    it('visibilitychange to hidden flushes the pending save once', () => {
      renderHook(() => useSessionAutoSave(false));

      changeUntitledContent('const x = 2;');
      vi.advanceTimersByTime(300);
      setVisibilityState('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      expect(saveSpy).toHaveBeenCalledTimes(1);

      // The flushed timer must not fire again at the 1 s mark.
      vi.advanceTimersByTime(5000);
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });

    it('pagehide flushes the pending save', () => {
      renderHook(() => useSessionAutoSave(false));

      changeUntitledContent('const x = 2;');
      window.dispatchEvent(new Event('pagehide'));
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });

    it('flush is a no-op when no save is pending', () => {
      renderHook(() => useSessionAutoSave(false));

      setVisibilityState('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pagehide'));
      expect(saveSpy).not.toHaveBeenCalled();
    });
  });
});
