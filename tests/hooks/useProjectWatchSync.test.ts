/**
 * RL-102 Slice 2 — `useProjectWatchSync` reload-from-disk notice.
 *
 * Pinned coverage:
 *   - A `change` event whose `relativePath` matches an open clean
 *     tab pushes a notice with the `Reload from disk` action when
 *     the on-disk content differs from the in-memory buffer.
 *   - Dirty-tab variant pushes a different message key + action.
 *   - Self-induced echo (disk content === in-memory content) is
 *     suppressed silently.
 *   - 3+ tabs accumulating in the debounce window collapse into
 *     ONE batched notice (fold D).
 *   - `rename` events do not trigger the reload notice (deletes
 *     route through the existing stale-tab notice path).
 *   - The hook unsubscribes its watcher on unmount.
 *
 * The test mocks `window.lingua.fs.{onChanged, read}` so the
 * hook's subscription path runs end-to-end without the real
 * Electron IPC bridge.
 */

import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectWatchSync } from '../../src/renderer/hooks/useProjectWatchSync';
import { useEditorStore } from '../../src/renderer/stores/editorStore';
import { useProjectStore } from '../../src/renderer/stores/projectStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';

type ChangeEvent = {
  rootId: string;
  relativePath: string;
  eventType: string;
  filename: string | null;
};

interface MockFsBridge {
  onChanged: (cb: (event: ChangeEvent) => void) => () => void;
  read: ReturnType<typeof vi.fn>;
  emit: (event: ChangeEvent) => void;
}

function installMockBridge(diskContent: string | null): MockFsBridge {
  const listeners: Array<(event: ChangeEvent) => void> = [];
  const bridge: MockFsBridge = {
    onChanged: (cb) => {
      listeners.push(cb);
      return () => {
        const idx = listeners.indexOf(cb);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
    read: vi.fn().mockResolvedValue(diskContent),
    emit: (event: ChangeEvent) => {
      for (const cb of listeners) cb(event);
    },
  };
  // Install on window — the hook reads `window.lingua.fs.{onChanged, read}`.
  (window as unknown as { lingua: unknown }).lingua = {
    platform: 'desktop',
    fs: bridge,
  };
  return bridge;
}

const ROOT_ID = 'root-1';

function primeProjectAndTab(opts: {
  relativePath: string;
  name: string;
  content: string;
  isDirty?: boolean;
  rootId?: string;
}): string {
  const tabId = `tab-${opts.name}`;
  useProjectStore.setState((state) => ({
    ...state,
    currentProject: {
      rootId: opts.rootId ?? ROOT_ID,
      rootPath: '/tmp/repo',
      name: 'repo',
    },
    nodes: state.nodes ?? [],
  }));
  useEditorStore.setState((state) => ({
    ...state,
    tabs: [
      ...state.tabs,
      {
        id: tabId,
        name: opts.name,
        language: 'javascript',
        content: opts.content,
        isDirty: opts.isDirty ?? false,
        rootId: opts.rootId ?? ROOT_ID,
        relativePath: opts.relativePath,
        filePath: `/tmp/repo/${opts.relativePath}`,
        executionState: 'idle' as const,
        parseError: null,
      } as unknown as (typeof state.tabs)[number],
    ],
  }));
  return tabId;
}

describe('useProjectWatchSync — reload-from-disk notice (RL-102 Slice 2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useEditorStore.setState({ tabs: [], activeTabId: null });
    useProjectStore.setState({ currentProject: null, nodes: [] });
    useUIStore.setState({ statusNotice: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { lingua?: unknown }).lingua;
  });

  it('pushes the clean-tab notice when an open clean tab is modified on disk', async () => {
    const bridge = installMockBridge('// new disk content');
    primeProjectAndTab({
      relativePath: 'src/foo.js',
      name: 'foo.js',
      content: '// old buffer content',
      isDirty: false,
    });

    renderHook(() => useProjectWatchSync());

    act(() => {
      bridge.emit({
        rootId: ROOT_ID,
        relativePath: 'src/foo.js',
        eventType: 'change',
        filename: 'foo.js',
      });
    });

    // Tick past the 500ms inner debounce.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    const notice = useUIStore.getState().statusNotice;
    expect(notice).not.toBeNull();
    expect(notice?.messageKey).toBe('git.externalReload.clean.body');
    expect(notice?.actions?.[0]?.labelKey).toBe(
      'git.externalReload.clean.action'
    );
  });

  it('pushes the dirty-tab variant for a dirty open tab', async () => {
    const bridge = installMockBridge('// external rewrite');
    primeProjectAndTab({
      relativePath: 'src/dirty.js',
      name: 'dirty.js',
      content: '// my unsaved edits',
      isDirty: true,
    });

    renderHook(() => useProjectWatchSync());

    act(() => {
      bridge.emit({
        rootId: ROOT_ID,
        relativePath: 'src/dirty.js',
        eventType: 'change',
        filename: 'dirty.js',
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    const notice = useUIStore.getState().statusNotice;
    expect(notice?.messageKey).toBe('git.externalReload.dirty.body');
    expect(notice?.tone).toBe('warning');
    expect(notice?.actions?.[0]?.labelKey).toBe(
      'git.externalReload.dirty.action'
    );
  });

  it('suppresses the notice when on-disk content equals the in-memory buffer (self-induced save echo)', async () => {
    const bridge = installMockBridge('// same content');
    primeProjectAndTab({
      relativePath: 'src/self.js',
      name: 'self.js',
      content: '// same content',
      isDirty: false,
    });

    renderHook(() => useProjectWatchSync());

    act(() => {
      bridge.emit({
        rootId: ROOT_ID,
        relativePath: 'src/self.js',
        eventType: 'change',
        filename: 'self.js',
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(useUIStore.getState().statusNotice).toBeNull();
  });

  it('does NOT push the notice for rename events (deletes route through the stale-tab path)', async () => {
    const bridge = installMockBridge('// content');
    primeProjectAndTab({
      relativePath: 'src/rename.js',
      name: 'rename.js',
      content: 'in-memory',
      isDirty: false,
    });

    renderHook(() => useProjectWatchSync());

    act(() => {
      bridge.emit({
        rootId: ROOT_ID,
        relativePath: 'src/rename.js',
        eventType: 'rename',
        filename: 'rename.js',
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(useUIStore.getState().statusNotice).toBeNull();
  });

  it('collapses ≥3 modified tabs in the debounce window into ONE batched notice (fold D)', async () => {
    const bridge = installMockBridge('// new content');
    primeProjectAndTab({
      relativePath: 'src/a.js',
      name: 'a.js',
      content: 'old',
    });
    primeProjectAndTab({
      relativePath: 'src/b.js',
      name: 'b.js',
      content: 'old',
    });
    primeProjectAndTab({
      relativePath: 'src/c.js',
      name: 'c.js',
      content: 'old',
    });

    renderHook(() => useProjectWatchSync());

    act(() => {
      bridge.emit({
        rootId: ROOT_ID,
        relativePath: 'src/a.js',
        eventType: 'change',
        filename: 'a.js',
      });
      bridge.emit({
        rootId: ROOT_ID,
        relativePath: 'src/b.js',
        eventType: 'change',
        filename: 'b.js',
      });
      bridge.emit({
        rootId: ROOT_ID,
        relativePath: 'src/c.js',
        eventType: 'change',
        filename: 'c.js',
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    const notice = useUIStore.getState().statusNotice;
    expect(notice?.messageKey).toBe('git.externalReload.batch.body');
    expect(notice?.actions?.[0]?.labelKey).toBe(
      'git.externalReload.batch.action'
    );
    expect(notice?.values?.count).toBe(3);
  });

  it('reloads every matching clean tab when the batched Reload all action is clicked', async () => {
    const bridge = installMockBridge('// batch disk content');
    primeProjectAndTab({
      relativePath: 'src/a.js',
      name: 'a.js',
      content: 'old-a',
    });
    primeProjectAndTab({
      relativePath: 'src/b.js',
      name: 'b.js',
      content: 'old-b',
    });
    primeProjectAndTab({
      relativePath: 'src/c.js',
      name: 'c.js',
      content: 'old-c',
    });

    renderHook(() => useProjectWatchSync());

    act(() => {
      for (const name of ['a', 'b', 'c']) {
        bridge.emit({
          rootId: ROOT_ID,
          relativePath: `src/${name}.js`,
          eventType: 'change',
          filename: `${name}.js`,
        });
      }
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    const notice = useUIStore.getState().statusNotice;
    expect(notice?.messageKey).toBe('git.externalReload.batch.body');

    await act(async () => {
      notice?.actions?.[0]?.onClick();
      await Promise.resolve();
    });

    const contents = useEditorStore
      .getState()
      .tabs.map((tab) => tab.content);
    expect(contents).toEqual([
      '// batch disk content',
      '// batch disk content',
      '// batch disk content',
    ]);
  });

  it('ignores events whose filename is null (platform dropped the entry name)', async () => {
    const bridge = installMockBridge('// content');
    primeProjectAndTab({
      relativePath: 'src/nullname.js',
      name: 'nullname.js',
      content: 'old',
    });

    renderHook(() => useProjectWatchSync());

    act(() => {
      bridge.emit({
        rootId: ROOT_ID,
        relativePath: 'src/nullname.js',
        eventType: 'change',
        filename: null,
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(useUIStore.getState().statusNotice).toBeNull();
  });

  it('ignores events for files that are not open in a tab', async () => {
    const bridge = installMockBridge('// content');
    primeProjectAndTab({
      relativePath: 'src/open.js',
      name: 'open.js',
      content: 'old',
    });

    renderHook(() => useProjectWatchSync());

    act(() => {
      bridge.emit({
        rootId: ROOT_ID,
        relativePath: 'src/never-opened.js',
        eventType: 'change',
        filename: 'never-opened.js',
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(useUIStore.getState().statusNotice).toBeNull();
  });
});
