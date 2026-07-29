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

vi.mock('../../../src/renderer/hooks/useActiveTab', () => ({
  useActiveTab: () => activeTabRef.current,
}));

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: ({
    original,
    modified,
  }: {
    original: string;
    modified: string;
  }) => (
    <div data-testid="mock-diff-editor">
      <span>{original}</span>
      <span>{modified}</span>
    </div>
  ),
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
  });
});
