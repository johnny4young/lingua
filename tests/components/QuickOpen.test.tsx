import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useProjectIndexStore } from '../../src/renderer/stores/projectIndexStore';

const mockOpenFile = vi.fn().mockResolvedValue(undefined);
const mockSetActiveTab = vi.fn();

vi.mock('../../src/renderer/stores/editorStore', () => ({
  useEditorStore: () => ({
    tabs: [],
    setActiveTab: mockSetActiveTab,
    openFile: mockOpenFile,
  }),
}));

// The legacy tree-walk fallback. Intentionally small so we can assert that
// Quick Open prefers the index over this when both are available.
vi.mock('../../src/renderer/stores/projectStore', () => ({
  useProjectStore: () => ({
    nodes: [
      {
        name: 'src',
        path: '/proj/src',
        isDirectory: true,
        isExpanded: true,
        children: [
          {
            name: 'tree-only.ts',
            path: '/proj/src/tree-only.ts',
            isDirectory: false,
            language: 'typescript',
          },
        ],
      },
    ],
  }),
}));

vi.mock('../../src/renderer/stores/recentFilesStore', () => ({
  useRecentFilesStore: () => ({ recentFiles: [] }),
}));

vi.mock('lucide-react', () => ({
  Search: () => <span>search</span>,
}));

import { QuickOpen } from '../../src/renderer/components/QuickOpen/QuickOpen';

describe('QuickOpen', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
    mockOpenFile.mockClear();
    mockSetActiveTab.mockClear();
    useProjectIndexStore.setState({
      rootPath: null,
      status: 'idle',
      entries: [],
      lastIndexedAt: null,
      error: null,
    });
  });

  it('lists files from the project-wide index when it is ready', () => {
    useProjectIndexStore.setState({
      rootPath: '/proj',
      status: 'ready',
      entries: [
        {
          name: 'main.ts',
          path: '/proj/src/main.ts',
          relativePath: 'src/main.ts',
          language: 'typescript',
        },
        {
          name: 'hidden-from-tree.py',
          path: '/proj/deep/hidden-from-tree.py',
          relativePath: 'deep/hidden-from-tree.py',
          language: 'python',
        },
      ],
      lastIndexedAt: Date.now(),
      error: null,
    });

    render(<QuickOpen onClose={vi.fn()} />);

    expect(screen.getByText('/proj/src/main.ts')).toBeTruthy();
    expect(screen.getByText('/proj/deep/hidden-from-tree.py')).toBeTruthy();
    // The tree-walk fallback file must NOT appear when the index is ready.
    expect(screen.queryByText('/proj/src/tree-only.ts')).toBeNull();
  });

  it('falls back to the project tree walk when the index is empty', () => {
    render(<QuickOpen onClose={vi.fn()} />);
    expect(screen.getByText('/proj/src/tree-only.ts')).toBeTruthy();
  });

  it('opens unknown-extension files in plaintext mode instead of silently ignoring them', async () => {
    useProjectIndexStore.setState({
      rootPath: '/proj',
      status: 'ready',
      entries: [
        {
          name: 'NOTES',
          path: '/proj/NOTES',
          relativePath: 'NOTES',
          language: undefined,
        },
      ],
      lastIndexedAt: Date.now(),
      error: null,
    });

    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<QuickOpen onClose={onClose} />);

    await user.click(screen.getByText('NOTES'));

    expect(mockOpenFile).toHaveBeenCalledWith('/proj/NOTES', 'NOTES', 'plaintext');
    expect(onClose).toHaveBeenCalled();
  });
});
