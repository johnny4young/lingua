/**
 * regression guard — file/folder delete confirmation.
 *
 * The FileTree must confirm web deletes through the shared ConfirmDialog.
 * Desktop keeps the final confirmation inside main-process IPC, so the
 * renderer does not double-confirm there.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';

const mockDeleteEntry = vi.fn().mockResolvedValue(true);
const mockOpenFile = vi.fn();

const node = {
  name: 'doomed.ts',
  path: 'doomed.ts',
  isDirectory: false,
  language: 'typescript' as const,
};

const projectState = {
  currentProject: {
    id: 'proj',
    name: 'project',
    rootId: 'root-proj',
    rootPath: '/project',
    lastOpenedAt: 0,
  },
  recentProjects: [],
  nodes: [node],
  createProject: vi.fn(),
  openProject: vi.fn(),
  refreshTree: vi.fn(),
  createFile: vi.fn(),
  createDirectory: vi.fn(),
  deleteEntry: mockDeleteEntry,
  collapseAllDirectories: vi.fn(),
  expandDirectory: vi.fn(),
};

vi.mock('../../src/renderer/stores/projectStore', () => {
  const useProjectStore = ((selector?: (state: unknown) => unknown) =>
    selector ? selector(projectState) : projectState) as ((
    selector?: unknown
  ) => unknown) & { getState: () => typeof projectState };
  useProjectStore.getState = () => projectState;
  return { useProjectStore };
});

vi.mock('../../src/renderer/stores/editorStore', () => {
  function editorState() {
    return { tabs: [], activeTabId: null, openFile: mockOpenFile };
  }
  const useEditorStore = ((selector?: (state: unknown) => unknown) =>
    selector ? selector(editorState()) : editorState()) as ((
    selector?: unknown
  ) => unknown) & { getState: () => ReturnType<typeof editorState> };
  useEditorStore.getState = editorState;
  return {
    useEditorStore,
    getActiveTab: () => null,
  };
});

vi.mock('../../src/renderer/hooks/useDirtyTabPaths', () => ({
  useDirtyTabPaths: () => new Set<string>(),
  dirtyTabKey: (rootId: string, rel: string) => `${rootId}::${rel}`,
}));

vi.mock('../../src/renderer/hooks/useProjectBundle', () => ({
  useProjectBundle: () => ({ exportProjectBundle: vi.fn() }),
}));

import { FileTree } from '../../src/renderer/components/FileTree/FileTree';

describe('FileTree delete confirmation', () => {
  beforeEach(async () => {
    mockDeleteEntry.mockClear();
    Object.defineProperty(window, 'lingua', {
      value: { platform: 'web' },
      configurable: true,
      writable: true,
    });
    await i18next.changeLanguage('en');
  });

  async function clickDelete() {
    render(<FileTree />);
    // The per-row action buttons only mount on hover; reveal them with a
    // raw mouseEnter, then click via fireEvent so userEvent's pointer
    // movement does not fire onMouseLeave and unmount the button first.
    const label = screen.getByText('doomed.ts');
    const row = label.closest('div')!;
    fireEvent.mouseEnter(row);
    const deleteButton = await screen.findByRole('button', { name: 'Delete' });
    fireEvent.click(deleteButton);
  }

  it('shows a confirm dialog and does NOT delete until confirmed', async () => {
    await clickDelete();

    expect(
      screen.getByRole('alertdialog', { name: 'Delete this item?' })
    ).toBeTruthy();
    // No mutation has happened yet.
    expect(mockDeleteEntry).not.toHaveBeenCalled();
  });

  it('Cancel aborts with no mutation', async () => {
    const user = userEvent.setup();
    await clickDelete();
    await user.click(screen.getByTestId('file-tree-delete-confirm-cancel'));

    expect(mockDeleteEntry).not.toHaveBeenCalled();
    expect(screen.queryByTestId('file-tree-delete-confirm')).toBeNull();
  });

  it('Confirm performs the delete with the right path', async () => {
    const user = userEvent.setup();
    await clickDelete();
    await user.click(screen.getByTestId('file-tree-delete-confirm-confirm'));

    await waitFor(() => expect(mockDeleteEntry).toHaveBeenCalledTimes(1));
    expect(mockDeleteEntry).toHaveBeenCalledWith('doomed.ts', false);
  });

  it('delegates desktop delete directly so main owns the native confirmation', async () => {
    Object.defineProperty(window, 'lingua', {
      value: { platform: 'darwin' },
      configurable: true,
      writable: true,
    });

    await clickDelete();

    expect(screen.queryByTestId('file-tree-delete-confirm')).toBeNull();
    await waitFor(() => expect(mockDeleteEntry).toHaveBeenCalledTimes(1));
    expect(mockDeleteEntry).toHaveBeenCalledWith('doomed.ts', false);
  });
});
