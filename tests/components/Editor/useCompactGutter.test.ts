import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useCompactGutter } from '@/components/Editor/useCompactGutter';

function fakeEditor(width: number) {
  const listeners = new Set<(info: { width: number }) => void>();
  return {
    getLayoutInfo: () => ({ width }),
    onDidLayoutChange: (listener: (info: { width: number }) => void) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    resize: (next: number) => listeners.forEach(listener => listener({ width: next })),
    listenerCount: () => listeners.size,
  };
}

describe('useCompactGutter', () => {
  it('follows the editor width across the compact threshold and stops listening on unmount', () => {
    const editor = fakeEditor(375);
    const { result, unmount } = renderHook(() =>
      useCompactGutter(editor as unknown as Parameters<typeof useCompactGutter>[0])
    );
    expect(result.current).toBe(true);

    act(() => editor.resize(768));
    expect(result.current).toBe(false);
    act(() => editor.resize(479));
    expect(result.current).toBe(true);
    act(() => editor.resize(480));
    expect(result.current).toBe(false);
    // A hidden editor lays out at 0 and keeps its last answer.
    act(() => editor.resize(375));
    act(() => editor.resize(0));
    expect(result.current).toBe(true);

    unmount();
    expect(editor.listenerCount()).toBe(0);
  });

  it('stays wide before Monaco mounts or lays out', () => {
    expect(renderHook(() => useCompactGutter(null)).result.current).toBe(false);
    const hidden = fakeEditor(0);
    expect(
      renderHook(() => useCompactGutter(hidden as unknown as Parameters<typeof useCompactGutter>[0])).result.current
    ).toBe(false);
  });
});
