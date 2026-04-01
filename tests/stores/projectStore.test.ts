import { describe, it, expect } from 'vitest';
import {
  setNodeChildren,
  toggleExpanded,
  removeNode,
  renameNode,
  addNodeToParent,
  type FileTreeNode,
} from '@/stores/projectStore';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDir(name: string, path: string, children?: FileTreeNode[]): FileTreeNode {
  return { name, path, isDirectory: true, isExpanded: false, children };
}

function makeFile(name: string, path: string): FileTreeNode {
  return { name, path, isDirectory: false };
}

// ---------------------------------------------------------------------------
// setNodeChildren
// ---------------------------------------------------------------------------

describe('setNodeChildren', () => {
  it('sets children on a top-level directory node by path', () => {
    const nodes = [makeDir('src', '/proj/src')];
    const children = [makeFile('main.ts', '/proj/src/main.ts')];
    const result = setNodeChildren(nodes, '/proj/src', children, true);
    expect(result[0].children).toEqual(children);
  });

  it('sets children recursively on a nested directory node', () => {
    const inner = makeDir('utils', '/proj/src/utils');
    const outer = makeDir('src', '/proj/src', [inner]);
    const nodes = [outer];
    const children = [makeFile('helpers.ts', '/proj/src/utils/helpers.ts')];
    const result = setNodeChildren(nodes, '/proj/src/utils', children, true);
    expect(result[0].children![0].children).toEqual(children);
  });

  it('marks node as expanded=true when expanded arg is true', () => {
    const nodes = [makeDir('src', '/proj/src')];
    const result = setNodeChildren(nodes, '/proj/src', [], true);
    expect(result[0].isExpanded).toBe(true);
  });

  it('marks node as expanded=false when expanded arg is false', () => {
    const nodes = [{ ...makeDir('src', '/proj/src'), isExpanded: true }];
    const result = setNodeChildren(nodes, '/proj/src', [], false);
    expect(result[0].isExpanded).toBe(false);
  });

  it('does not affect non-matching nodes', () => {
    const nodes = [makeDir('src', '/proj/src'), makeDir('lib', '/proj/lib')];
    const result = setNodeChildren(nodes, '/proj/src', [], true);
    expect(result[1].isExpanded).toBe(false);
    expect(result[1].children).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// toggleExpanded
// ---------------------------------------------------------------------------

describe('toggleExpanded', () => {
  it('sets isExpanded=true on a matching directory', () => {
    const nodes = [makeDir('src', '/proj/src')];
    const result = toggleExpanded(nodes, '/proj/src', true);
    expect(result[0].isExpanded).toBe(true);
  });

  it('sets isExpanded=false on a matching directory', () => {
    const nodes = [{ ...makeDir('src', '/proj/src'), isExpanded: true }];
    const result = toggleExpanded(nodes, '/proj/src', false);
    expect(result[0].isExpanded).toBe(false);
  });

  it('recurses into nested trees to find the target', () => {
    const inner = makeDir('utils', '/proj/src/utils');
    const outer = makeDir('src', '/proj/src', [inner]);
    const nodes = [outer];
    const result = toggleExpanded(nodes, '/proj/src/utils', true);
    expect(result[0].children![0].isExpanded).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// removeNode
// ---------------------------------------------------------------------------

describe('removeNode', () => {
  it('removes a top-level node by path', () => {
    const nodes = [makeFile('a.ts', '/proj/a.ts'), makeFile('b.ts', '/proj/b.ts')];
    const result = removeNode(nodes, '/proj/a.ts');
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('/proj/b.ts');
  });

  it('removes a nested node by path', () => {
    const file = makeFile('index.ts', '/proj/src/index.ts');
    const dir = makeDir('src', '/proj/src', [file]);
    const nodes = [dir];
    const result = removeNode(nodes, '/proj/src/index.ts');
    expect(result[0].children).toHaveLength(0);
  });

  it('returns the same tree if path not found', () => {
    const nodes = [makeFile('a.ts', '/proj/a.ts')];
    const result = removeNode(nodes, '/proj/nonexistent.ts');
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('/proj/a.ts');
  });
});

// ---------------------------------------------------------------------------
// renameNode
// ---------------------------------------------------------------------------

describe('renameNode', () => {
  it('updates path and name of a matching node', () => {
    const nodes = [makeFile('old.ts', '/proj/old.ts')];
    const result = renameNode(nodes, '/proj/old.ts', '/proj/new.ts', 'new.ts');
    expect(result[0].path).toBe('/proj/new.ts');
    expect(result[0].name).toBe('new.ts');
  });

  it('recurses into nested trees', () => {
    const file = makeFile('old.ts', '/proj/src/old.ts');
    const dir = makeDir('src', '/proj/src', [file]);
    const nodes = [dir];
    const result = renameNode(nodes, '/proj/src/old.ts', '/proj/src/new.ts', 'new.ts');
    expect(result[0].children![0].path).toBe('/proj/src/new.ts');
    expect(result[0].children![0].name).toBe('new.ts');
  });
});

// ---------------------------------------------------------------------------
// addNodeToParent
// ---------------------------------------------------------------------------

describe('addNodeToParent', () => {
  it('adds a child to an expanded directory with children array', () => {
    const parent = { ...makeDir('src', '/proj/src', []), isExpanded: true };
    const nodes = [parent];
    const newFile = makeFile('index.ts', '/proj/src/index.ts');
    const result = addNodeToParent(nodes, '/proj/src', newFile);
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children![0].path).toBe('/proj/src/index.ts');
  });

  it('sorts directories before files', () => {
    const existingFile = makeFile('a.ts', '/proj/src/a.ts');
    const parent = { ...makeDir('src', '/proj/src', [existingFile]), isExpanded: true };
    const nodes = [parent];
    const newDir = makeDir('utils', '/proj/src/utils', []);
    const result = addNodeToParent(nodes, '/proj/src', newDir);
    // Directory should come before file
    expect(result[0].children![0].isDirectory).toBe(true);
    expect(result[0].children![1].isDirectory).toBe(false);
  });

  it('does not add to a collapsed directory (isExpanded=false)', () => {
    // makeDir sets isExpanded: false by default
    const parent = makeDir('src', '/proj/src', []);
    const nodes = [parent];
    const newFile = makeFile('index.ts', '/proj/src/index.ts');
    const result = addNodeToParent(nodes, '/proj/src', newFile);
    expect(result[0].children).toHaveLength(0);
  });

  it('does not add to a non-matching parent', () => {
    const parent = { ...makeDir('src', '/proj/src', []), isExpanded: true };
    const nodes = [parent];
    const newFile = makeFile('index.ts', '/proj/lib/index.ts');
    const result = addNodeToParent(nodes, '/proj/lib', newFile);
    // /proj/lib doesn't exist in the tree, so nothing changes
    expect(result[0].children).toHaveLength(0);
  });
});
