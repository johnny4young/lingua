import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileTab } from '../../src/renderer/types';
import type { NavigationTreeItem } from '../../src/renderer/utils/symbolNavigation';

const loadNavigationTree = vi.hoisted(() => vi.fn());
const model = vi.hoisted(() => ({
  getLanguageId: vi.fn(() => 'typescript'),
  getPositionAt: vi.fn((offset: number) => ({ lineNumber: offset + 1, column: 1 })),
}));

vi.mock('monaco-editor/esm/vs/editor/editor.api.js', () => ({
  editor: {
    getEditors: () => [{ getModel: () => model }],
  },
}));

vi.mock('../../src/renderer/monaco', () => ({
  loadNavigationTree,
}));

import { useDocumentSymbols } from '../../src/renderer/hooks/useDocumentSymbols';

function tab(id: string, content: string): FileTab {
  return {
    id,
    name: `${id}.ts`,
    language: 'typescript',
    content,
    isDirty: true,
  };
}

function tree(name: string): NavigationTreeItem {
  return {
    text: '<global>',
    kind: 'script',
    spans: [],
    childItems: [
      {
        text: name,
        kind: 'function',
        spans: [{ start: 3, length: name.length }],
      },
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('useDocumentSymbols', () => {
  beforeEach(() => {
    loadNavigationTree.mockReset();
    model.getLanguageId.mockReturnValue('typescript');
    model.getPositionAt.mockImplementation((offset: number) => ({
      lineNumber: offset + 1,
      column: 1,
    }));
  });

  it('derives loading while retaining only same-document entries', async () => {
    loadNavigationTree.mockResolvedValueOnce(tree('first'));
    const initialTab = tab('one', 'function first() {}');
    const { result, rerender } = renderHook(
      ({ activeTab }) => useDocumentSymbols(activeTab, true),
      { initialProps: { activeTab: initialTab } }
    );

    expect(result.current).toEqual({ status: 'loading', entries: [] });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.entries.map((entry) => entry.name)).toEqual(['first']);

    const sameTabRefresh = deferred<NavigationTreeItem>();
    loadNavigationTree.mockReturnValueOnce(sameTabRefresh.promise);
    rerender({ activeTab: tab('one', 'function first() { return 1; }') });

    expect(result.current.status).toBe('loading');
    expect(result.current.entries.map((entry) => entry.name)).toEqual(['first']);
    await waitFor(() => {
      expect(loadNavigationTree).toHaveBeenCalledTimes(2);
    });

    const otherTabRefresh = deferred<NavigationTreeItem>();
    loadNavigationTree.mockReturnValueOnce(otherTabRefresh.promise);
    rerender({ activeTab: tab('two', 'function second() {}') });

    expect(result.current).toEqual({ status: 'loading', entries: [] });
    await waitFor(() => {
      expect(loadNavigationTree).toHaveBeenCalledTimes(3);
    });

    await act(async () => {
      otherTabRefresh.resolve(tree('second'));
      await otherTabRefresh.promise;
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.entries.map((entry) => entry.name)).toEqual(['second']);

    // Resolve the superseded same-tab request last; cancellation must keep it
    // from replacing the newer tab's symbol list.
    await act(async () => {
      sameTabRefresh.resolve(tree('stale'));
      await sameTabRefresh.promise;
    });
    expect(result.current.entries.map((entry) => entry.name)).toEqual(['second']);
  });
});
