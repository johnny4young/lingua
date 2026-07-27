import { describe, expect, it } from 'vitest';
import {
  filterSymbols,
  flattenNavigationTree,
  supportsSymbolNavigation,
  type NavigationTreeItem,
  type SymbolEntry,
} from '@/utils/symbolNavigation';

function navItem(
  partial: Partial<NavigationTreeItem> & Pick<NavigationTreeItem, 'text' | 'kind'>
): NavigationTreeItem {
  return {
    spans: [{ start: 0, length: 0 }],
    childItems: [],
    ...partial,
  };
}

function navTree(childItems: NavigationTreeItem[]): NavigationTreeItem {
  return navItem({ text: '<global>', kind: 'script', childItems });
}

// Position resolver that treats each item's `start` offset as a line number so
// assertions stay readable; real Monaco models compute this via
// `model.getPositionAt(offset)`.
function fakePositionResolver(offset: number) {
  return { lineNumber: offset, column: 1 };
}

describe('symbolNavigation', () => {
  describe('supportsSymbolNavigation', () => {
    it('accepts javascript and typescript, rejects everything else', () => {
      expect(supportsSymbolNavigation('javascript')).toBe(true);
      expect(supportsSymbolNavigation('typescript')).toBe(true);
      expect(supportsSymbolNavigation('go')).toBe(false);
      expect(supportsSymbolNavigation('')).toBe(false);
      expect(supportsSymbolNavigation(null)).toBe(false);
      expect(supportsSymbolNavigation(undefined)).toBe(false);
    });
  });

  describe('flattenNavigationTree', () => {
    it('skips the source-file root and surfaces children at the top level', () => {
      const tree = navTree([
        navItem({
          text: 'greet',
          kind: 'function',
          spans: [{ start: 1, length: 10 }],
        }),
        navItem({
          text: 'GREETING',
          kind: 'const',
          spans: [{ start: 2, length: 10 }],
        }),
      ]);

      const entries = flattenNavigationTree(tree, fakePositionResolver);
      expect(entries.map((entry) => entry.name)).toEqual(['greet', 'GREETING']);
      expect(entries[0]!.qualifiedName).toBe('greet');
    });

    it('qualifies nested symbols with their parent path', () => {
      const tree = navTree([
        navItem({
          text: 'FileTree',
          kind: 'class',
          spans: [{ start: 1, length: 10 }],
          childItems: [
            navItem({
              text: 'renderTree',
              kind: 'method',
              spans: [{ start: 5, length: 10 }],
            }),
            navItem({
              text: 'expanded',
              kind: 'property',
              spans: [{ start: 8, length: 10 }],
            }),
          ],
        }),
      ]);

      const entries = flattenNavigationTree(tree, fakePositionResolver);
      expect(entries).toEqual<SymbolEntry[]>([
        { name: 'FileTree', qualifiedName: 'FileTree', kind: 'class', line: 1, column: 1 },
        {
          name: 'renderTree',
          qualifiedName: 'FileTree.renderTree',
          kind: 'method',
          line: 5,
          column: 1,
        },
        {
          name: 'expanded',
          qualifiedName: 'FileTree.expanded',
          kind: 'property',
          line: 8,
          column: 1,
        },
      ]);
    });

    it('preserves declaration order when emitting flat entries', () => {
      const tree = navTree([
        navItem({ text: 'first', kind: 'var', spans: [{ start: 9, length: 1 }] }),
        navItem({ text: 'second', kind: 'var', spans: [{ start: 1, length: 1 }] }),
      ]);

      const names = flattenNavigationTree(tree, fakePositionResolver).map(
        (entry) => entry.name
      );
      expect(names).toEqual(['first', 'second']);
    });

    it('ignores items without spans instead of crashing', () => {
      const tree = navTree([
        navItem({ text: 'noSpan', kind: 'var', spans: [] }),
        navItem({ text: 'kept', kind: 'var', spans: [{ start: 3, length: 1 }] }),
      ]);

      const names = flattenNavigationTree(tree, fakePositionResolver).map(
        (entry) => entry.name
      );
      expect(names).toEqual(['kept']);
    });

    it('returns an empty list for a missing tree or a root without declarations', () => {
      expect(flattenNavigationTree(undefined, fakePositionResolver)).toEqual([]);
      expect(flattenNavigationTree(navTree([]), fakePositionResolver)).toEqual([]);
    });
  });

  describe('filterSymbols', () => {
    const corpus: SymbolEntry[] = [
      { name: 'renderTree', qualifiedName: 'FileTree.renderTree', kind: 'method', line: 5, column: 1 },
      { name: 'openFile', qualifiedName: 'openFile', kind: 'function', line: 9, column: 1 },
      { name: 'expanded', qualifiedName: 'FileTree.expanded', kind: 'property', line: 12, column: 1 },
    ];

    it('returns the full list when the query is empty or whitespace', () => {
      expect(filterSymbols(corpus, '')).toEqual(corpus);
      expect(filterSymbols(corpus, '   ')).toEqual(corpus);
    });

    it('matches against both the short and qualified names', () => {
      expect(filterSymbols(corpus, 'file').map((entry) => entry.name)).toEqual([
        'renderTree',
        'openFile',
        'expanded',
      ]);
      expect(filterSymbols(corpus, 'tree.').map((entry) => entry.name)).toEqual([
        'renderTree',
        'expanded',
      ]);
    });

    it('is case-insensitive', () => {
      expect(filterSymbols(corpus, 'RENDER').map((entry) => entry.name)).toEqual(['renderTree']);
    });
  });
});
