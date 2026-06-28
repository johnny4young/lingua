/**
 * UX Sweep T7 — file-tree keyboard navigation + ARIA tree semantics.
 *
 * Asserts role=tree/treeitem + aria-level/aria-expanded, ArrowUp/Down
 * roving across the visible rows, ArrowLeft (collapse / move-to-parent),
 * and F2 inline rename.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
      { name: 'a.ts', path: 'src/a.ts', isDirectory: false, language: 'typescript' as const },
      { name: 'b.ts', path: 'src/b.ts', isDirectory: false, language: 'typescript' as const },
    ],
  },
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

const row = (name: string) => screen.getByRole('button', { name });

describe('FileTree keyboard navigation (UX Sweep T7)', () => {
  beforeEach(async () => {
    mockExpandDirectory.mockClear();
    mockCollapseDirectory.mockClear();
    mockRenameEntry.mockClear();
    await i18next.changeLanguage('en');
  });

  it('exposes role=tree + treeitem with aria-level and aria-expanded', () => {
    render(<FileTree />);
    expect(screen.getByRole('tree')).toBeTruthy();
    const treeitems = screen.getAllByRole('treeitem');
    // src (dir, expanded, level 1), a.ts + b.ts (level 2), readme.md (level 1).
    const src = treeitems.find((el) => el.textContent?.includes('src'))!;
    expect(src.getAttribute('aria-expanded')).toBe('true');
    expect(src.getAttribute('aria-level')).toBe('1');
    const aTs = treeitems.find((el) => el.getAttribute('aria-level') === '2');
    expect(aTs).toBeTruthy();
  });

  it('ArrowDown moves focus to the next visible row', async () => {
    render(<FileTree />);
    const src = row('src');
    src.focus();
    fireEvent.keyDown(src, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toBe(row('a.ts')));
  });

  it('ArrowLeft collapses an expanded directory', () => {
    render(<FileTree />);
    fireEvent.keyDown(row('src'), { key: 'ArrowLeft' });
    expect(mockCollapseDirectory).toHaveBeenCalledWith('src');
  });

  it('ArrowLeft on a child moves focus to its parent directory', async () => {
    render(<FileTree />);
    const child = row('a.ts');
    child.focus();
    fireEvent.keyDown(child, { key: 'ArrowLeft' });
    await waitFor(() => expect(document.activeElement).toBe(row('src')));
  });

  it('F2 starts an inline rename', () => {
    render(<FileTree />);
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.keyDown(row('a.ts'), { key: 'F2' });
    // The name button is replaced by the inline rename input (placeholder
    // seeded with the current name).
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.placeholder).toBe('a.ts');
  });
});
