/** Git marks, test tallies and the project rows of the explorer. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';

const mockExpandDirectory = vi.fn().mockResolvedValue(undefined);
const mockCollapseDirectory = vi.fn();
const mockRenameEntry = vi.fn().mockResolvedValue(undefined);
const mockOpenFile = vi.fn();

const nodes = [
  {
    name: 'src',
    path: 'src',
    isDirectory: true,
    isExpanded: true,
    children: [
      { name: 'cart.ts', path: 'src/cart.ts', isDirectory: false, language: 'typescript' as const },
      { name: 'cart.test.ts', path: 'src/cart.test.ts', isDirectory: false, language: 'typescript' as const },
      { name: 'shipping.test.ts', path: 'src/shipping.test.ts', isDirectory: false, language: 'typescript' as const },
    ],
  },
  { name: 'drafts', path: 'drafts', isDirectory: true, isExpanded: false },
  { name: 'readme.md', path: 'readme.md', isDirectory: false, language: 'markdown' as const },
];

const projectState = {
  currentProject: {
    id: 'proj',
    name: 'project',
    rootId: 'root-proj',
    rootPath: '/project',
    lastOpenedAt: 0,
  },
  recentProjects: [],
  nodes,
  createProject: vi.fn(),
  openProject: vi.fn(),
  refreshTree: vi.fn(),
  createFile: vi.fn(),
  createDirectory: vi.fn(),
  deleteEntry: vi.fn().mockResolvedValue(true),
  collapseAllDirectories: vi.fn(),
  expandDirectory: mockExpandDirectory,
  collapseDirectory: mockCollapseDirectory,
  renameEntry: mockRenameEntry,
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
  return { useEditorStore, getActiveTab: () => null };
});

vi.mock('../../src/renderer/hooks/useDirtyTabPaths', () => ({
  useDirtyTabPaths: () => new Set<string>(),
  dirtyTabKey: (rootId: string, rel: string) => `${rootId}::${rel}`,
}));

vi.mock('../../src/renderer/hooks/useProjectBundle', () => ({
  useProjectBundle: () => ({ exportProjectBundle: vi.fn() }),
}));

import { FileTree } from '../../src/renderer/components/FileTree/FileTree';
import { useGitStore } from '../../src/renderer/stores/gitStore';
import { useProjectTestStore } from '../../src/renderer/stores/projectTestStore';
import { useProjectTerminalStore } from '../../src/renderer/stores/projectTerminalStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';
import { subscribeCommand } from '../../src/renderer/stores/commandBus';
import type { ProjectTestCase } from '../../src/shared/projectTests';
import type { RootId } from '../../src/shared/fs/brandedIds';

const cases: ProjectTestCase[] = [
  { file: 'src/cart.test.ts', path: ['cart', 'adds'], status: 'passed' },
  { file: 'src/cart.test.ts', path: ['cart', 'ships'], status: 'failed' },
  { file: 'src/cart.test.ts', path: ['cart', 'later'], status: 'skipped' },
  { file: 'src/shipping.test.ts', path: ['shipping', 'charges'], status: 'passed' },
];

let changes: ReturnType<typeof vi.fn>;
let fsListener: ((event: { rootId: string }) => void) | null = null;
const originalLingua = window.lingua;

describe('FileTree marks and project rows', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
    fsListener = null;
    changes = vi.fn().mockResolvedValue({
      paths: [
        { path: 'src/cart.ts', status: 'modified' },
        { path: 'drafts/', status: 'untracked' },
      ],
      truncated: false,
    });
    window.lingua = {
      ...originalLingua,
      git: { changes } as unknown as NonNullable<typeof window.lingua.git>,
      fs: { ...originalLingua?.fs, onChanged: (handler: (event: { rootId: string }) => void) => { fsListener = handler; return () => { fsListener = null; }; } } as unknown as typeof window.lingua.fs,
      projectTests: {} as NonNullable<typeof window.lingua.projectTests>,
      projectTerminal: {} as NonNullable<typeof window.lingua.projectTerminal>,
    };
    useGitStore.setState({ posture: { available: true, repoRoot: '/', branch: 'main' }, lastDetectKey: '/project::root-proj' });
    useProjectTestStore.setState({ rootId: 'root-proj' as RootId, cases });
    useProjectTerminalStore.setState({ rootId: 'root-proj' as RootId, status: 'running', shellName: 'zsh' });
  });

  afterEach(() => {
    cleanup();
    window.lingua = originalLingua;
    useGitStore.getState().clear();
    useProjectTestStore.setState({ rootId: null, cases: null });
    useProjectTerminalStore.setState({ rootId: null, status: 'idle', shellName: null });
  });

  it('marks changed files and folders and sums the changes beside the branch', async () => {
    render(<FileTree />);
    expect(await screen.findByTestId('file-tree-git-summary')).toHaveProperty('textContent', 'main · 2 changed');
    expect(changes).toHaveBeenCalledWith('/', '/project');
    expect(screen.getByTestId('file-tree-git-src/cart.ts').textContent).toBe('M');
    expect(screen.getByTestId('file-tree-git-src/cart.ts').getAttribute('aria-label')).toBe('Modified');
    expect(screen.getByTestId('file-tree-git-drafts').textContent).toBe('U');
    expect(screen.queryByTestId('file-tree-git-readme.md')).toBeNull();
    expect(screen.queryByTestId('file-tree-file-count')).toBeNull();
  });

  it('asks Git again after a file in the project changes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<FileTree />);
      await waitFor(() => expect(changes).toHaveBeenCalledTimes(1));
      act(() => fsListener?.({ rootId: 'root-proj' }));
      act(() => fsListener?.({ rootId: 'other-root' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(changes).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for this project detect before asking Git', () => {
    useGitStore.setState({ lastDetectKey: '/previous::root-previous' });
    render(<FileTree />);
    expect(changes).not.toHaveBeenCalled();
    expect(screen.queryByTestId('file-tree-git-summary')).toBeNull();
  });

  it('stops following file changes after a failed query until focus', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      changes.mockResolvedValue(null);
      render(<FileTree />);
      await waitFor(() => expect(changes).toHaveBeenCalledTimes(1));
      act(() => fsListener?.({ rootId: 'root-proj' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(changes).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
        window.dispatchEvent(new Event('focus'));
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(changes).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the file count instead when Git is unavailable', () => {
    useGitStore.setState({ posture: { available: false } });
    render(<FileTree />);
    expect(screen.getByTestId('file-tree-file-count').textContent).toBe('4 files');
    expect(screen.queryByTestId('file-tree-git-summary')).toBeNull();
    expect(changes).not.toHaveBeenCalled();
  });

  it('shows each test file tally and the run total, ignoring skipped tests', () => {
    render(<FileTree />);
    const cart = screen.getByTestId('file-tree-tests-src/cart.test.ts');
    expect(cart.textContent).toBe('1 / 21 of 2 tests passed');
    expect(cart.getAttribute('data-tone')).toBe('failed');
    expect(screen.getByTestId('file-tree-tests-src/shipping.test.ts').getAttribute('data-tone')).toBe('passed');
    expect(screen.queryByTestId('file-tree-tests-src/cart.ts')).toBeNull();
    expect(screen.getByTestId('file-tree-footer-tests-tally').textContent).toBe('2 / 32 of 3 tests passed');
  });

  it('leaves another project results off the tree', () => {
    useProjectTestStore.setState({ rootId: 'root-other' as RootId });
    render(<FileTree />);
    expect(screen.queryByTestId('file-tree-tests-src/cart.test.ts')).toBeNull();
    expect(screen.queryByTestId('file-tree-footer-tests-tally')).toBeNull();
  });

  it('leaves a shell running for another project off the Terminal row', () => {
    useProjectTerminalStore.setState({ rootId: 'root-other' as RootId });
    render(<FileTree />);
    expect(screen.getByTestId('file-tree-footer-terminal')).toBeTruthy();
    expect(screen.queryByTestId('file-tree-footer-terminal-state')).toBeNull();
  });

  it('flags a run that failed before any test ran', () => {
    useProjectTestStore.setState({ cases: [{ file: 'src/cart.test.ts', path: [], status: 'failed', runnable: false }] });
    render(<FileTree />);
    expect(screen.getByTestId('file-tree-footer-tests-tally').getAttribute('data-tone')).toBe('failed');
  });

  it('opens search, the Tests tab and the terminal from the rows under the tree', () => {
    const search = vi.fn();
    const unsubscribe = subscribeCommand('overlay.openProjectSearch', search);
    try {
      render(<FileTree />);
      fireEvent.click(screen.getByTestId('file-tree-footer-search'));
      expect(search).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByTestId('file-tree-footer-tests'));
      expect(useUIStore.getState().activeBottomPanel).toBe('tests');
      fireEvent.click(screen.getByTestId('file-tree-footer-terminal'));
      expect(useUIStore.getState().activeBottomPanel).toBe('project-terminal');
      expect(screen.getByTestId('file-tree-footer-terminal-state').textContent).toBe('zsh · active');
    } finally {
      unsubscribe();
    }
  });

  it('hides the Tests and Terminal rows where the desktop bridges are absent', () => {
    window.lingua = { ...window.lingua, projectTests: undefined, projectTerminal: undefined };
    render(<FileTree />);
    expect(screen.getByTestId('file-tree-footer-search')).toBeTruthy();
    expect(screen.queryByTestId('file-tree-footer-tests')).toBeNull();
    expect(screen.queryByTestId('file-tree-footer-terminal')).toBeNull();
  });

  it('keeps the Spanish copy for the new rows', async () => {
    await i18next.changeLanguage('es');
    render(<FileTree />);
    expect(await screen.findByTestId('file-tree-git-summary')).toHaveProperty('textContent', 'main · 2 cambios');
    expect(screen.getByTestId('file-tree-footer-search').textContent).toContain('Buscar en archivos');
    expect(screen.getByTestId('file-tree-footer-terminal-state').textContent).toBe('zsh · activa');
  });
});
