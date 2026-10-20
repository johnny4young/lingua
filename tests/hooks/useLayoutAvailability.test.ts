/**
 * The dock gates: which tabs apply, whether the dock shows at all, and
 * whether its body is open.
 */
import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLayoutAvailability } from '@/hooks/useLayoutAvailability';
import { useEditorStore } from '@/stores/editorStore';
import { useResultStore } from '@/stores/resultStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';

function openTab(tab: Record<string, unknown>) {
  act(() => {
    useEditorStore
      .getState()
      .restoreTabs(
        [{ id: 't1', name: 'a.js', language: 'javascript', content: '', ...tab }] as never,
        't1'
      );
  });
}

beforeEach(() => {
  useEditorStore.getState().restoreTabs([], null);
  useResultStore.setState({ snapshotRing: [], scopeSnapshot: null });
  useSettingsStore.getState().setLayoutPreset('horizontal');
  useSettingsStore.setState({ variableInspectorSurface: 'bottom', showStdinPanel: true });
  useUIStore.getState().setConsoleVisible(true);
});

describe('useLayoutAvailability', () => {
  it('shows and expands the dock for a code tab', () => {
    openTab({});
    const { result } = renderHook(() => useLayoutAvailability());
    expect(result.current).toMatchObject({ dockShown: true, dockExpanded: true });
    expect(result.current.tabs.stdin).toBe(true);
    expect(result.current.tabs.compare).toBe(false);
  });

  it('keeps the tab row when the user hides the dock', () => {
    openTab({});
    act(() => useUIStore.getState().setConsoleVisible(false));
    const { result } = renderHook(() => useLayoutAvailability());
    expect(result.current).toMatchObject({ dockShown: true, dockExpanded: false });
  });

  it('lets a browser preview claim a hidden dock', () => {
    openTab({ runtimeMode: 'browser-preview' });
    act(() => useUIStore.getState().setConsoleVisible(false));
    const { result } = renderHook(() => useLayoutAvailability());
    expect(result.current.dockExpanded).toBe(true);
    expect(result.current.tabs['browser-preview']).toBe(true);
    expect(result.current.tabs.stdin).toBe(false);
  });

  it('removes the dock in the editor-only layout and on Utilities tabs', () => {
    openTab({});
    act(() => useSettingsStore.getState().setLayoutPreset('editor-only'));
    const { result, rerender } = renderHook(() => useLayoutAvailability());
    expect(result.current).toMatchObject({ dockShown: false, dockExpanded: false });

    act(() => useSettingsStore.getState().setLayoutPreset('horizontal'));
    openTab({ kind: 'utilities', name: 'Utilities', language: 'plaintext' });
    rerender();
    expect(result.current.dockShown).toBe(false);
  });

  it('offers Compare once a same-language snapshot exists', () => {
    openTab({});
    act(() => {
      useResultStore.setState({
        snapshotRing: [
          { language: 'javascript', capturedAt: 1, lineResults: [], fullOutput: '' },
        ] as never,
      });
    });
    const { result } = renderHook(() => useLayoutAvailability());
    expect(result.current.tabs.compare).toBe(true);
  });
});
