/**
 * ESTree parsing helpers for the repo's source-scanning gates.
 *
 * These scripts used to parse with the `typescript` package. TypeScript 7
 * ships native binaries whose only JavaScript entry point is `version` —
 * `createSourceFile` exists on neither the main export nor `./unstable/ast` —
 * so every gate that walked a TypeScript AST had to move to a parser that
 * survives the bump. `oxc-parser` is that parser; `tests/__fixtures__/
 * sourceAst.ts` is the same idea on the test side.
 */

import { parseSync, visitorKeys } from 'oxc-parser';

/** `.d.ts` parses under different rules; mislabelling it invents errors. */
export function languageOf(filePath) {
  if (filePath.endsWith('.d.ts')) return 'dts';
  if (filePath.endsWith('.tsx')) return 'tsx';
  return 'ts';
}

/**
 * Parse `sourceText`, throwing on any syntax error.
 *
 * Every caller reports what it FINDS, so a file the parser silently gave up
 * on would be indistinguishable from a clean one — the gate would go quiet
 * exactly when something is wrong.
 */
export function parseSourceText(filePath, sourceText) {
  const result = parseSync(filePath, sourceText, { lang: languageOf(filePath) });
  if (result.errors.length > 0) {
    throw new Error(`${filePath} failed to parse: ${result.errors[0]?.message ?? 'unknown'}`);
  }
  return result.program;
}

function isNode(value) {
  return value !== null && typeof value === 'object' && typeof value.type === 'string';
}

/**
 * Depth-first walk over `visitorKeys`, the parser's own child table.
 *
 * A node type missing from that table would silently prune its subtree, so a
 * gate would stop reporting rather than go red. Throw instead, so a parser
 * upgrade that outgrows the table fails loudly.
 */
export function walk(node, visit) {
  visit(node);
  const keys = visitorKeys[node.type];
  if (keys === undefined) {
    throw new Error(`oxc-parser reported node type ${node.type}, absent from visitorKeys`);
  }
  for (const key of keys) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) if (isNode(item)) walk(item, visit);
      continue;
    }
    if (isNode(child)) walk(child, visit);
  }
}

/** 1-based line and column of a byte offset, for gate diagnostics. */
export function lineAndColumn(sourceText, offset) {
  const before = sourceText.slice(0, offset);
  return { line: before.split('\n').length, column: offset - before.lastIndexOf('\n') };
}
