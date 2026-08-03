import { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileTreeHost } from '@/components/FileTree/FileTreeHost';
import type { FileTreeProps } from '@/components/FileTree/FileTree';
import { initI18n } from '@/i18n';

const mocks = vi.hoisted(() => ({
  loadTree: vi.fn(),
}));

vi.mock('@/components/FileTree/fileTreeLoader', () => ({
  loadFileTree: mocks.loadTree,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function TreeProbe({ onNavigate }: FileTreeProps) {
  return (
    <button type="button" data-testid="file-tree-probe" onClick={onNavigate}>
      Project files
    </button>
  );
}

describe('FileTreeHost', () => {
  beforeEach(() => {
    initI18n('en');
    mocks.loadTree.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows immediate feedback and renders the loaded tree under StrictMode', async () => {
    const pending = deferred<{ FileTree: typeof TreeProbe }>();
    const firstNavigate = vi.fn();
    const latestNavigate = vi.fn();
    mocks.loadTree.mockReturnValue(pending.promise);

    const { rerender } = render(
      <StrictMode>
        <FileTreeHost onNavigate={firstNavigate} />
      </StrictMode>
    );

    expect(screen.getByTestId('project-explorer-loading').textContent).toContain(
      'Loading project explorer'
    );
    rerender(
      <StrictMode>
        <FileTreeHost onNavigate={latestNavigate} />
      </StrictMode>
    );

    await act(async () => {
      pending.resolve({ FileTree: TreeProbe });
    });
    await userEvent.click(await screen.findByTestId('file-tree-probe'));

    expect(firstNavigate).not.toHaveBeenCalled();
    expect(latestNavigate).toHaveBeenCalledTimes(1);
  });

  it('surfaces a localized failure with an honest reload action', async () => {
    const error = new Error('project explorer chunk unavailable');
    mocks.loadTree.mockRejectedValue(error);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<FileTreeHost />);

    expect((await screen.findByTestId('project-explorer-load-failed')).textContent).toContain(
      'Project explorer could not load'
    );
    expect(consoleError).toHaveBeenCalledWith(
      '[project-explorer] failed to load the file tree',
      error
    );
    expect(screen.getByRole('button', { name: 'Reload Lingua' })).toBeTruthy();
    expect(mocks.loadTree).toHaveBeenCalledTimes(1);
  });

  it('ignores a late module result after the sidebar closes', async () => {
    const pending = deferred<{ FileTree: typeof TreeProbe }>();
    mocks.loadTree.mockReturnValue(pending.promise);
    const { unmount } = render(<FileTreeHost />);

    unmount();
    await act(async () => {
      pending.resolve({ FileTree: TreeProbe });
    });

    expect(screen.queryByTestId('file-tree-probe')).toBeNull();
  });
});
