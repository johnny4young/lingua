import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const activeTabRef = vi.hoisted(() => ({
  current: {
    id: 'tab-1',
    name: 'main.ts',
    language: 'typescript',
    content: 'const value = 2;',
    isDirty: true,
    filePath: '/tmp/repo/main.ts',
  },
}));
const transfer = vi.hoisted(() => ({
  onMount: null as null | ((editor: unknown, monaco: unknown) => void),
  register: vi.fn(() => vi.fn()),
  original: { side: 'HEAD' },
  modified: { side: 'working-tree' },
}));

vi.mock('../../../src/renderer/utils/selectionTransfer', () => ({
  registerSelectionTransferActions: transfer.register,
}));

vi.mock('../../../src/renderer/hooks/useActiveTab', () => ({
  useActiveTab: () => activeTabRef.current,
}));

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: ({
    original,
    modified,
    onMount,
  }: {
    original: string;
    modified: string;
    onMount?: (editor: unknown, monaco: unknown) => void;
  }) => {
    transfer.onMount = onMount ?? null;
    return (
      <div data-testid="mock-diff-editor">
        <span>{original}</span>
        <span>{modified}</span>
      </div>
    );
  },
}));

import { GitDiffPanel } from '../../../src/renderer/components/Editor/GitDiffPanel';
import { useGitStore } from '../../../src/renderer/stores/gitStore';
import { useUIStore } from '../../../src/renderer/stores/uiStore';

const REPO_ROOT = '/tmp/repo';
const FILE_PATH = '/tmp/repo/main.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('GitDiffPanel', () => {
  beforeEach(() => {
    activeTabRef.current = {
      id: 'tab-1', name: 'main.ts', language: 'typescript',
      content: 'const value = 2;', isDirty: true, filePath: FILE_PATH,
    };
    transfer.register.mockClear();
    transfer.onMount = null;
    useGitStore.getState().clear();
    useGitStore.getState().setPosture({
      available: true,
      repoRoot: REPO_ROOT,
      branch: 'main',
      commit: 'commit-1',
    });
    useGitStore.getState().setFileStatus(FILE_PATH, {
      status: 'modified',
      updatedAt: 1,
    });
    useUIStore.setState({ activeBottomPanel: 'console' });
  });

  afterEach(() => {
    act(() => {
      useGitStore.getState().clear();
    });
    delete (window as unknown as { lingua?: unknown }).lingua;
  });

  it('derives loading from the active request and ignores superseded responses', async () => {
    const first = deferred<GitFileDiff>();
    const second = deferred<GitFileDiff>();
    const diff = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    (window as unknown as { lingua: unknown }).lingua = {
      platform: 'desktop',
      git: { diff },
    };

    render(<GitDiffPanel />);

    expect(screen.getByText('Loading diff…')).toBeTruthy();
    expect(diff).toHaveBeenCalledWith(REPO_ROOT, FILE_PATH);

    act(() => {
      useGitStore.getState().setFileStatus(FILE_PATH, {
        status: 'modified',
        updatedAt: 2,
      });
    });
    expect(screen.getByText('Loading diff…')).toBeTruthy();
    expect(diff).toHaveBeenCalledTimes(2);

    await act(async () => {
      first.resolve({
        originalContent: 'stale original',
        modifiedContent: 'stale modified',
        truncated: false,
      });
      await first.promise;
    });
    expect(screen.queryByText('stale original')).toBeNull();
    expect(screen.getByText('Loading diff…')).toBeTruthy();

    await act(async () => {
      second.resolve({
        originalContent: 'current original',
        modifiedContent: 'current modified',
        truncated: false,
      });
      await second.promise;
    });

    await waitFor(() => {
      expect(screen.getByTestId('mock-diff-editor')).toBeTruthy();
    });
    expect(screen.getByText('current original')).toBeTruthy();
    expect(screen.getByText('current modified')).toBeTruthy();

    act(() => transfer.onMount?.({
      getOriginalEditor: () => transfer.original,
      getModifiedEditor: () => transfer.modified,
    }, {}));
    expect(transfer.register).toHaveBeenCalledWith(
      transfer.modified,
      expect.any(Function),
      expect.objectContaining({ reference: expect.any(String), context: expect.any(String) })
    );
    expect(transfer.register).not.toHaveBeenCalledWith(
      transfer.original,
      expect.anything(),
      expect.anything()
    );
    const dispose = transfer.register.mock.results[0]?.value;
    act(() => useGitStore.getState().clear());
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('unmounts the old diff and registers modified-side actions after switching files', async () => {
    const diff = vi.fn()
      .mockResolvedValueOnce({ originalContent: 'before a', modifiedContent: 'after a', truncated: false })
      .mockResolvedValueOnce({ originalContent: 'before b', modifiedContent: 'after b', truncated: false });
    (window as unknown as { lingua: unknown }).lingua = {
      platform: 'desktop', git: { diff },
    };
    const { rerender } = render(<GitDiffPanel />);
    await screen.findByText('after a');
    act(() => transfer.onMount?.({
      getOriginalEditor: () => transfer.original,
      getModifiedEditor: () => transfer.modified,
    }, {}));
    expect(transfer.register).toHaveBeenCalledTimes(1);

    const secondPath = '/tmp/repo/other.ts';
    act(() => {
      useGitStore.getState().setFileStatus(secondPath, { status: 'modified', updatedAt: 1 });
      activeTabRef.current = {
        ...activeTabRef.current, id: 'tab-2', name: 'other.ts', filePath: secondPath,
      };
      rerender(<GitDiffPanel />);
    });
    expect(screen.queryByTestId('mock-diff-editor')).toBeNull();
    expect(screen.getByText('Loading diff…')).toBeTruthy();
    await screen.findByText('after b');
    act(() => transfer.onMount?.({
      getOriginalEditor: () => transfer.original,
      getModifiedEditor: () => transfer.modified,
    }, {}));
    expect(transfer.register).toHaveBeenCalledTimes(2);
    expect(transfer.register.mock.results[0]?.value).toHaveBeenCalledOnce();
    expect(diff).toHaveBeenLastCalledWith(REPO_ROOT, secondPath);
  });
});
