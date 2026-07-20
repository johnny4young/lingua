/**
 * implementation fifth increment — capability badge in the file tree.
 *
 * The badge appears next to file names when:
 *   - the file is a host-toolchain language (Go, Rust today),
 *   - AND the build is web (`window.lingua?.platform === 'web'`).
 *
 * On desktop or for self-contained runtimes, the badge is suppressed.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import i18next from 'i18next';
import { initI18n } from '@/i18n';
import { FileTreeNode } from '@/components/FileTree/FileTreeNode';
import type { FileTreeNode as ProjectFileTreeNode } from '@/stores/projectStore';

function makeNode(overrides: Partial<ProjectFileTreeNode>): ProjectFileTreeNode {
  return {
    name: 'main.go',
    path: '/tmp/main.go',
    isDirectory: false,
    language: 'go',
    ...overrides,
  } as ProjectFileTreeNode;
}

function renderNode(node: ProjectFileTreeNode) {
  return render(
    <FileTreeNode
      node={node}
      depth={0}
      creating={null}
      onCreateConfirm={() => {}}
      onCancelCreate={() => {}}
      onFileClick={() => {}}
      onDelete={() => {}}
    />
  );
}

function setPlatform(platform: 'web' | 'darwin'): () => void {
  const original = (window as unknown as { lingua?: unknown }).lingua;
  Object.defineProperty(window, 'lingua', {
    configurable: true,
    writable: true,
    value: { platform },
  });
  return () => {
    Object.defineProperty(window, 'lingua', {
      configurable: true,
      writable: true,
      value: original,
    });
  };
}

describe('FileTreeNode — capability badge', () => {
  let restore: () => void = () => {};

  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    restore();
  });

  it('renders the desktop-only badge for a Go file on the web build', () => {
    restore = setPlatform('web');
    const node = makeNode({ name: 'main.go', path: '/tmp/main.go', language: 'go' });
    renderNode(node);

    const badge = screen.getByTestId('file-tree-capability-/tmp/main.go');
    expect(badge.textContent).toContain('Desktop only');
  });

  it('renders the desktop-only badge for a Rust file on the web build', () => {
    restore = setPlatform('web');
    const node = makeNode({ name: 'main.rs', path: '/tmp/main.rs', language: 'rust' });
    renderNode(node);

    expect(screen.getByTestId('file-tree-capability-/tmp/main.rs')).toBeTruthy();
  });

  it('hides the badge for a Go file on the desktop build', () => {
    restore = setPlatform('darwin');
    const node = makeNode({ name: 'main.go', path: '/tmp/main.go', language: 'go' });
    renderNode(node);

    expect(screen.queryByTestId('file-tree-capability-/tmp/main.go')).toBeNull();
  });

  it('hides the badge for a self-contained runtime (JavaScript) even on the web build', () => {
    restore = setPlatform('web');
    const node = makeNode({ name: 'index.js', path: '/tmp/index.js', language: 'javascript' });
    renderNode(node);

    expect(screen.queryByTestId('file-tree-capability-/tmp/index.js')).toBeNull();
  });

  it('hides the badge for directories regardless of platform', () => {
    restore = setPlatform('web');
    const node = makeNode({
      name: 'src',
      path: '/tmp/src',
      isDirectory: true,
      language: undefined,
    });
    renderNode(node);

    expect(screen.queryByTestId('file-tree-capability-/tmp/src')).toBeNull();
  });

  it('localizes the badge in Spanish', async () => {
    restore = setPlatform('web');
    await i18next.changeLanguage('es');
    const node = makeNode({ name: 'main.rs', path: '/tmp/main.rs', language: 'rust' });
    renderNode(node);

    expect(screen.getByTestId('file-tree-capability-/tmp/main.rs').textContent).toContain(
      'Solo escritorio'
    );
  });
});
