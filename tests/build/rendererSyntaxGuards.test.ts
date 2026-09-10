/**
 * Two renderer architecture guards, previously enforced by ESLint's
 * `no-restricted-syntax`.
 *
 * oxlint does not implement that rule — the binary answers "Rule
 * 'no-restricted-syntax' not found in plugin 'eslint'" — so the two guards
 * that rode on it move here rather than disappearing with the linter swap.
 * That also matches how this repo already writes architectural guards:
 * `interpreterConsolidation`, `sharedNodeBuiltinBoundary` and
 * `codeEditorChunkBoundary` are all tests, not lint rules.
 *
 * Each guard below reproduces its original selector exactly, including scope:
 *
 *   1. Inline active-tab derivation — `tabs.find(… activeTabId)` anywhere in
 *      the renderer except the one canonical site. Original selectors:
 *        CallExpression[callee.property.name="find"][callee.object.name="tabs"]
 *          :has(Identifier[name="activeTabId"])
 *        CallExpression[callee.property.name="find"]
 *          [callee.object.property.name="tabs"]:has(Identifier[name="activeTabId"])
 *
 *   2. Selector-less store reads in components. Original selector:
 *        CallExpression[callee.name=/^use[A-Z]\w*Store$/][arguments.length=0]
 *
 * The `:has()` in the first pair means the identifier may appear anywhere
 * inside the call, which is why these walk the subtree rather than matching
 * the callee alone.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');

/** The one place allowed to derive the active tab inline. */
const ACTIVE_TAB_CANONICAL_SITE = 'src/renderer/stores/editorSelectors.ts';

interface Violation {
  file: string;
  line: number;
  text: string;
}

function sourceFilesUnder(relativeRoot: string): string[] {
  const found: string[] = [];
  const visit = (absolute: string): void => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = path.join(absolute, entry.name);
      if (entry.isDirectory()) {
        visit(child);
        continue;
      }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
      found.push(path.relative(repoRoot, child).split(path.sep).join('/'));
    }
  };
  visit(path.join(repoRoot, relativeRoot));
  return found.sort();
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(path.join(repoRoot, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

function locate(node: ts.Node, source: ts.SourceFile, file: string): Violation {
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return {
    file,
    line: line + 1,
    text: node.getText(source).replace(/\s+/gu, ' ').slice(0, 100),
  };
}

function walk(source: ts.SourceFile, visit: (node: ts.Node) => void): void {
  const step = (node: ts.Node): void => {
    visit(node);
    ts.forEachChild(node, step);
  };
  ts.forEachChild(source, step);
}

/** `:has(Identifier[name="activeTabId"])` — anywhere in the subtree. */
function subtreeReferences(node: ts.Node, identifier: string): boolean {
  let found = false;
  const step = (child: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(child) && child.text === identifier) {
      found = true;
      return;
    }
    ts.forEachChild(child, step);
  };
  ts.forEachChild(node, step);
  return found;
}

/**
 * `callee.object.name === 'tabs'` or `callee.object.property.name === 'tabs'`,
 * i.e. `tabs.find(…)` and `state.tabs.find(…)`.
 */
function isTabsFindCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (callee.name.text !== 'find') return false;
  const object = callee.expression;
  if (ts.isIdentifier(object)) return object.text === 'tabs';
  if (ts.isPropertyAccessExpression(object)) return object.name.text === 'tabs';
  return false;
}

/** `useXStore()` — the regex and the zero-argument condition, together. */
const STORE_HOOK = /^use[A-Z]\w*Store$/u;

function isSelectorLessStoreRead(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  if (node.arguments.length !== 0) return false;
  const callee = node.expression;
  return ts.isIdentifier(callee) && STORE_HOOK.test(callee.text);
}

function findViolations(files: string[], matches: (node: ts.Node) => boolean): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    const source = parse(file);
    walk(source, node => {
      if (matches(node)) violations.push(locate(node, source, file));
    });
  }
  return violations;
}

function format(violations: Violation[]): string {
  return violations.map(v => `  ${v.file}:${v.line}  ${v.text}`).join('\n');
}

describe('inline active-tab derivation', () => {
  const files = sourceFilesUnder('src/renderer').filter(file => file !== ACTIVE_TAB_CANONICAL_SITE);

  it('stays out of the renderer, outside its one canonical site', () => {
    const violations = findViolations(
      files,
      node => isTabsFindCall(node) && subtreeReferences(node, 'activeTabId')
    );

    expect(
      violations,
      violations.length === 0
        ? ''
        : 'Use useActiveTab() / getActiveTab(state) instead of an inline ' +
            `tabs.find(... === activeTabId). The canonical derivation lives in ` +
            `${ACTIVE_TAB_CANONICAL_SITE}; a second one drifts and re-renders ` +
            `wider than it needs to.\n${format(violations)}`
    ).toEqual([]);
  });

  it('still recognises the pattern it bans', () => {
    // The guard is worthless if the matcher stopped matching. Prove it against
    // both shapes the original selectors covered, plus a near-miss.
    const fixture = ts.createSourceFile(
      'fixture.ts',
      [
        'const a = tabs.find(tab => tab.id === activeTabId);',
        'const b = state.tabs.find(tab => tab.id === state.activeTabId);',
        'const c = tabs.find(tab => tab.id === someOtherId);',
        'const d = items.find(item => item.id === activeTabId);',
      ].join('\n'),
      ts.ScriptTarget.Latest,
      true
    );
    const hits: number[] = [];
    walk(fixture, node => {
      if (isTabsFindCall(node) && subtreeReferences(node, 'activeTabId')) {
        hits.push(fixture.getLineAndCharacterOfPosition(node.getStart(fixture)).line + 1);
      }
    });

    // Lines 1 and 2 are the banned shapes; 3 uses a different id and 4 a
    // different collection, so neither is the pattern this guard owns.
    expect(hits).toEqual([1, 2]);
  });
});

describe('selector-less store reads', () => {
  const files = sourceFilesUnder('src/renderer/components');

  it('is scoped to components, as the original rule was', () => {
    // The store-read ban lived on `src/renderer/components/**` only; hooks and
    // stores read whole slices deliberately. Losing that scope would turn this
    // guard into a repo-wide ban it was never meant to be.
    expect(files.every(file => file.startsWith('src/renderer/components/'))).toBe(true);
    expect(files.length).toBeGreaterThan(0);
  });

  it('stay out of the components layer', () => {
    const violations = findViolations(files, isSelectorLessStoreRead);

    expect(
      violations,
      violations.length === 0
        ? ''
        : 'Select a store slice: useXStore(state => state.field) or ' +
            'useXStore(useShallow(state => ({ ... }))). A selector-less read ' +
            `re-renders on every store update.\n${format(violations)}`
    ).toEqual([]);
  });

  it('still recognises the pattern it bans', () => {
    const fixture = ts.createSourceFile(
      'fixture.tsx',
      [
        'const a = useSettingsStore();',
        'const b = useEditorStore(state => state.tabs);',
        'const c = useStore();',
        'const d = usesomethingStore();',
        'const e = useResultStore(useShallow(s => s));',
        // Imperative access is not a subscription, so it was always allowed.
        'const f = useSettingsStore.getState();',
      ].join('\n'),
      ts.ScriptTarget.Latest,
      true
    );
    const hits: number[] = [];
    walk(fixture, node => {
      if (isSelectorLessStoreRead(node)) {
        hits.push(fixture.getLineAndCharacterOfPosition(node.getStart(fixture)).line + 1);
      }
    });

    // Only line 1: lines 2 and 5 pass a selector, line 3 has no capitalised
    // segment before `Store`, line 4 fails the leading `use[A-Z]`, and line 6
    // is `.getState()` — a member call, never a subscription.
    expect(hits).toEqual([1]);
  });
});
