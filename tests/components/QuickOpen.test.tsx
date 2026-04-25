import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('groups files by source with eyebrow headers when the search is empty', () => {
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
      ],
      lastIndexedAt: Date.now(),
      error: null,
    });

    render(<QuickOpen onClose={vi.fn()} />);

    // The Project section header is the only scope expected here:
    // there are no open tabs and no recents in this fixture, so the
    // other two sections are intentionally hidden — empty buckets stay
    // collapsed instead of leaving a labelled void.
    expect(screen.getByText('Project files')).toBeTruthy();
    expect(screen.queryByText('Open tabs')).toBeNull();
    expect(screen.queryByText('Recent files')).toBeNull();
  });

  it('flattens results without scope headers when the user types a query', async () => {
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
      ],
      lastIndexedAt: Date.now(),
      error: null,
    });

    const user = userEvent.setup();
    render(<QuickOpen onClose={vi.fn()} />);

    await user.type(screen.getByPlaceholderText('Go to file...'), 'main');

    // Search results stay flat — eyebrow headers only show on the
    // empty-query overview, since splitting a ranked search across
    // sections would push exact matches below near-misses from another
    // scope.
    expect(screen.queryByText('Project files')).toBeNull();
    expect(screen.queryByText('Open tabs')).toBeNull();
    expect(screen.getByText('/proj/src/main.ts')).toBeTruthy();
  });

  it('renders a hint alongside the empty no-match state', async () => {
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
      ],
      lastIndexedAt: Date.now(),
      error: null,
    });

    const user = userEvent.setup();
    render(<QuickOpen onClose={vi.fn()} />);

    await user.type(screen.getByPlaceholderText('Go to file...'), 'zzzzzzzz-no-match');

    expect(screen.getByText('No files match "zzzzzzzz-no-match"')).toBeTruthy();
    expect(
      screen.getByText('Clear the search or use the Command Palette to run an action.')
    ).toBeTruthy();
  });

  it('scrolls the highlighted file row instead of a grouped section header', async () => {
    const scrolledIndexes: string[] = [];
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(function scrollIntoView(this: HTMLElement) {
        scrolledIndexes.push(this.dataset.resultIndex ?? 'missing');
      }),
      configurable: true,
      writable: true,
    });
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
          name: 'helper.ts',
          path: '/proj/src/helper.ts',
          relativePath: 'src/helper.ts',
          language: 'typescript',
        },
      ],
      lastIndexedAt: Date.now(),
      error: null,
    });

    render(<QuickOpen onClose={vi.fn()} />);

    fireEvent.keyDown(screen.getByPlaceholderText('Go to file...'), { key: 'ArrowDown' });

    await waitFor(() => {
      expect(scrolledIndexes[scrolledIndexes.length - 1]).toBe('1');
    });
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
