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
 * The AST comes from `oxc-parser`, not from the `typescript` package, for two
 * reasons.
 *
 *   - It is ESTree-shaped, the same vocabulary the original selectors were
 *     written against, so each guard below is a transcription rather than a
 *     translation into the TypeScript compiler's separate node model.
 *   - It survives TypeScript 7. The `typescript@7` main export is a native
 *     binary shim that exposes `version` and little else; `createSourceFile`
 *     lives on neither it nor `./unstable/ast`, which ships type guards and a
 *     scanner but no standalone parse entry point. Every existing
 *     `import ts from 'typescript'` in this suite is therefore a rewrite the
 *     TS 7 bump will have to pay for. This guard does not need to join that
 *     queue to do its job.
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
import { parseSync, visitorKeys } from 'oxc-parser';
import type { Node, Program } from 'oxc-parser';
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

function languageOf(file: string): 'dts' | 'ts' | 'tsx' {
  if (file.endsWith('.d.ts')) return 'dts';
  if (file.endsWith('.tsx')) return 'tsx';
  return 'ts';
}

interface Parsed {
  program: Program;
  source: string;
  errors: string[];
}

function parse(file: string, source: string): Parsed {
  const result = parseSync(file, source, { lang: languageOf(file) });
  return {
    program: result.program,
    source,
    errors: result.errors.map(error => error.message),
  };
}

function parseFile(file: string): Parsed {
  return parse(file, readFileSync(path.join(repoRoot, file), 'utf8'));
}

function isNode(value: unknown): value is Node {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

/**
 * Depth-first walk over `visitorKeys`, the parser's own child table.
 *
 * A node type missing from that table would silently prune its whole subtree,
 * which for a guard means a violation that stops being reported rather than a
 * test that goes red. Throw instead, so a parser upgrade that outgrows the
 * table fails loudly.
 */
function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  const keys = visitorKeys[node.type];
  if (keys === undefined) {
    throw new Error(`oxc-parser reported node type ${node.type}, absent from visitorKeys`);
  }
  for (const key of keys) {
    const child = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (isNode(item)) walk(item, visit);
      }
      continue;
    }
    if (isNode(child)) walk(child, visit);
  }
}

function walkDescendants(node: Node, visit: (node: Node) => void): void {
  walk(node, candidate => {
    if (candidate !== node) visit(candidate);
  });
}

function locate(node: Node, parsed: Parsed, file: string): Violation {
  return {
    file,
    line: parsed.source.slice(0, node.start).split('\n').length,
    text: parsed.source.slice(node.start, node.end).replace(/\s+/gu, ' ').slice(0, 100),
  };
}

/** `:has(Identifier[name="activeTabId"])` — anywhere in the subtree. */
function subtreeReferences(node: Node, identifier: string): boolean {
  let found = false;
  walkDescendants(node, child => {
    if (child.type === 'Identifier' && child.name === identifier) found = true;
  });
  return found;
}

/** `foo.bar` with `bar` spelled as a plain identifier, as the selectors assumed. */
function staticProperty(node: Node): string | undefined {
  if (node.type !== 'MemberExpression') return undefined;
  if (node.computed) return undefined;
  return node.property.type === 'Identifier' ? node.property.name : undefined;
}

/**
 * `callee.object.name === 'tabs'` or `callee.object.property.name === 'tabs'`,
 * i.e. `tabs.find(…)` and `state.tabs.find(…)`.
 */
function isTabsFindCall(node: Node): boolean {
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (callee.type !== 'MemberExpression') return false;
  if (staticProperty(callee) !== 'find') return false;
  const object = callee.object;
  if (object.type === 'Identifier') return object.name === 'tabs';
  return staticProperty(object) === 'tabs';
}

/** `useXStore()` — the regex and the zero-argument condition, together. */
const STORE_HOOK = /^use[A-Z]\w*Store$/u;

function isSelectorLessStoreRead(node: Node): boolean {
  if (node.type !== 'CallExpression') return false;
  if (node.arguments.length !== 0) return false;
  const callee = node.callee;
  return callee.type === 'Identifier' && STORE_HOOK.test(callee.name);
}

function findViolations(files: string[], matches: (node: Node) => boolean): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    const parsed = parseFile(file);
    walk(parsed.program, node => {
      if (matches(node)) violations.push(locate(node, parsed, file));
    });
  }
  return violations;
}

function format(violations: Violation[]): string {
  return violations.map(v => `  ${v.file}:${v.line}  ${v.text}`).join('\n');
}

function hitLines(source: string, matches: (node: Node) => boolean): number[] {
  const parsed = parse('fixture.tsx', source);
  expect(parsed.errors).toEqual([]);
  const lines: number[] = [];
  walk(parsed.program, node => {
    if (matches(node)) lines.push(locate(node, parsed, 'fixture.tsx').line);
  });
  return lines;
}

describe('the renderer parses', () => {
  it('cleanly, so a guard below cannot pass by failing to read a file', () => {
    // Both guards report what they find, so a file the parser chokes on would
    // look exactly like a file with nothing to report.
    const unparseable = sourceFilesUnder('src/renderer')
      .map(file => ({ file, errors: parseFile(file).errors }))
      .filter(entry => entry.errors.length > 0)
      .map(entry => `${entry.file}: ${entry.errors[0]}`);

    expect(unparseable).toEqual([]);
  });
});

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
    const hits = hitLines(
      [
        'const a = tabs.find(tab => tab.id === activeTabId);',
        'const b = state.tabs.find(tab => tab.id === state.activeTabId);',
        'const c = tabs.find(tab => tab.id === someOtherId);',
        'const d = items.find(item => item.id === activeTabId);',
      ].join('\n'),
      node => isTabsFindCall(node) && subtreeReferences(node, 'activeTabId')
    );

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
    const hits = hitLines(
      [
        'const a = useSettingsStore();',
        'const b = useEditorStore(state => state.tabs);',
        'const c = useStore();',
        'const d = usesomethingStore();',
        'const e = useResultStore(useShallow(s => s));',
        // Imperative access is not a subscription, so it was always allowed.
        'const f = useSettingsStore.getState();',
      ].join('\n'),
      isSelectorLessStoreRead
    );

    // Only line 1: lines 2 and 5 pass a selector, line 3 has no capitalised
    // segment before `Store`, line 4 fails the leading `use[A-Z]`, and line 6
    // is `.getState()` — a member call, never a subscription.
    expect(hits).toEqual([1]);
  });
});
