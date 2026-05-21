/**
 * RL-024 Slice 1 — file tree dirty dot.
 *
 * The dot appears next to a file's name iff there is an open tab that
 * is dirty AND whose `{ rootId, relativePath }` matches the tree
 * node's `{ currentProject.rootId, node.path }`.
 *
 * Negative cases verified:
 *   - directories never carry the dot, even when an interior file is
 *     dirty
 *   - tabs from a different project root do not light up nodes in
 *     the currently-open project
 *   - clean tabs do not light up
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initI18n } from '@/i18n';
import { FileTreeNode } from '@/components/FileTree/FileTreeNode';
import type { FileTreeNode as ProjectFileTreeNode } from '@/stores/projectStore';
import { useProjectStore } from '@/stores/projectStore';
import { dirtyTabKey } from '@/hooks/useDirtyTabPaths';

const initialProject = useProjectStore.getState();
const originalLingua = window.lingua;

function makeFile(
  overrides: Partial<ProjectFileTreeNode>
): ProjectFileTreeNode {
  return {
    name: 'main.ts',
    path: 'src/main.ts',
    isDirectory: false,
    language: 'typescript',
    ...overrides,
  } as ProjectFileTreeNode;
}

function renderNode(
  node: ProjectFileTreeNode,
  dirtyTabPaths: ReadonlySet<string> = new Set()
) {
  return render(
    <FileTreeNode
      node={node}
      depth={0}
      creating={null}
      dirtyTabPaths={dirtyTabPaths}
      onCreateConfirm={() => {}}
      onCancelCreate={() => {}}
      onFileClick={() => {}}
      onDelete={() => {}}
    />
  );
}

function setProject(rootId: string, rootPath: string): void {
  useProjectStore.setState({
    currentProject: {
      id: rootPath,
      name: 'proj',
      rootId,
      rootPath,
      openedAt: Date.now(),
    },
    nodes: [],
    watchId: null,
    recentProjects: [],
  });
}

describe('FileTreeNode — dirty dot', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState(initialProject, true);
    Object.defineProperty(window, 'lingua', {
      configurable: true,
      writable: true,
      value: originalLingua,
    });
  });

  it('renders the dirty dot for a file whose matching tab is dirty', () => {
    setProject('root-proj', '/proj');
    const dirty = new Set([dirtyTabKey('root-proj', 'src/main.ts')]);

    renderNode(makeFile({ path: 'src/main.ts' }), dirty);

    const dot = screen.getByTestId('file-tree-dirty-src/main.ts');
    expect(dot).toBeTruthy();
    expect(dot.getAttribute('aria-label')).toBe('Unsaved changes');
  });

  it('hides the dot when the matching tab is clean', () => {
    setProject('root-proj', '/proj');
    renderNode(makeFile({ path: 'src/main.ts' }), new Set());

    expect(screen.queryByTestId('file-tree-dirty-src/main.ts')).toBeNull();
  });

  it('hides the dot when the only dirty tab belongs to a different project', () => {
    setProject('root-proj', '/proj');
    const dirty = new Set([dirtyTabKey('root-other', 'src/main.ts')]);

    renderNode(makeFile({ path: 'src/main.ts' }), dirty);

    expect(screen.queryByTestId('file-tree-dirty-src/main.ts')).toBeNull();
  });

  it('hides the dot for directories even when an interior file is dirty', () => {
    setProject('root-proj', '/proj');
    const dirty = new Set([dirtyTabKey('root-proj', 'src/main.ts')]);

    renderNode(
      makeFile({ path: 'src', isDirectory: true, language: undefined }),
      dirty
    );

    expect(screen.queryByTestId('file-tree-dirty-src')).toBeNull();
  });

  it('localizes the aria-label in Spanish', async () => {
    await i18next.changeLanguage('es');
    setProject('root-proj', '/proj');
    const dirty = new Set([dirtyTabKey('root-proj', 'src/main.ts')]);

    renderNode(makeFile({ path: 'src/main.ts' }), dirty);

    expect(
      screen.getByTestId('file-tree-dirty-src/main.ts').getAttribute('aria-label')
    ).toBe('Cambios sin guardar');
  });

  it('opens the reveal context menu from the keyboard and invokes the desktop IPC', async () => {
    const user = userEvent.setup();
    const revealInFinder = vi.fn().mockResolvedValue(true);
    Object.defineProperty(window, 'lingua', {
      configurable: true,
      writable: true,
      value: {
        ...(originalLingua ?? {}),
        platform: 'darwin',
        fs: {
          ...(originalLingua?.fs ?? {}),
          revealInFinder,
        },
      },
    });
    setProject('root-proj', '/proj');

    renderNode(makeFile({ path: 'src/main.ts' }));

    const nameButton = screen.getByRole('button', { name: 'main.ts' });
    nameButton.focus();
    fireEvent.keyDown(nameButton, { key: 'F10', shiftKey: true });

    const menu = screen.getByTestId('file-tree-context-menu');
    expect(menu).toBeTruthy();

    await user.click(screen.getByRole('menuitem', { name: 'Reveal in Finder' }));

    expect(revealInFinder).toHaveBeenCalledWith('root-proj', 'src/main.ts');
  });
});
