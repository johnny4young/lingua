/**
 * internal — coverage for the extracted layout-availability hook.
 * Locks the load-bearing invariant (editor-only layout forces every bottom-panel
 * gate off) and the hook's return shape, so the extraction from `AppLayout`
 * cannot silently drop or flip a gate.
 */
import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLayoutAvailability } from '@/hooks/useLayoutAvailability';
import { useEditorStore } from '@/stores/editorStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';

const GATE_KEYS = [
  'showConsole',
  'showDebuggerPanel',
  'showBrowserPreviewPanel',
  'showStdinTabBody',
  'showVariablesTabBody',
  'showRecipeTabBody',
] as const;

beforeEach(() => {
  useEditorStore.getState().restoreTabs([], null);
  useSettingsStore.getState().setLayoutPreset('horizontal');
  useUIStore.getState().setConsoleVisible(true);
});

describe('useLayoutAvailability', () => {
  it('returns exactly the six gate booleans', () => {
    const { result } = renderHook(() => useLayoutAvailability());
    expect(Object.keys(result.current).sort()).toEqual([...GATE_KEYS].sort());
    for (const key of GATE_KEYS) {
      expect(typeof result.current[key], key).toBe('boolean');
    }
  });

  it('forces every gate off under the editor-only layout', () => {
    act(() => {
      useEditorStore
        .getState()
        .restoreTabs(
          [{ id: 't1', name: 'a.js', language: 'javascript', content: '', runtimeMode: 'browser-preview' }],
          't1'
        );
      useUIStore.getState().setConsoleVisible(true);
      useSettingsStore.getState().setLayoutPreset('editor-only');
    });
    const { result } = renderHook(() => useLayoutAvailability());
    for (const key of GATE_KEYS) {
      expect(result.current[key], key).toBe(false);
    }
  });

  it('shows the console when visible and the layout is not editor-only', () => {
    act(() => {
      useEditorStore
        .getState()
        .restoreTabs([{ id: 't1', name: 'a.js', language: 'javascript', content: '' }], 't1');
      useUIStore.getState().setConsoleVisible(true);
      useSettingsStore.getState().setLayoutPreset('horizontal');
    });
    const { result } = renderHook(() => useLayoutAvailability());
    expect(result.current.showConsole).toBe(true);
  });
});
