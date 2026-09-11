/**
 * ESTree helpers shared by the build and architecture guards.
 *
 * These guards used to parse with the `typescript` package. TypeScript 7
 * ships native binaries whose only JavaScript entry point is `version`:
 * `createSourceFile` exists on neither the main export nor `./unstable/ast`,
 * which carries type guards, a scanner and the two JSDoc-tag walkers but no
 * standalone parse entry. Every guard that walked a TypeScript AST therefore
 * had to move to a parser that survives the bump.
 *
 * `oxc-parser` is that parser. Its output is ESTree-shaped — the same
 * vocabulary the removed ESLint selectors spoke — so the guards read closer
 * to their original intent than the compiler's own node model allowed.
 */

import { readFileSync } from 'node:fs';
import { parseSync, visitorKeys } from 'oxc-parser';
import type { ImportDeclaration, Node, Program, Statement } from 'oxc-parser';

export interface ParsedSource {
  /** Display name used in diagnostics — usually a repo-relative path. */
  readonly file: string;
  readonly source: string;
  readonly program: Program;
}

/**
 * `dts` matters: `.d.ts` files are parsed under different rules than `.ts`
 * (ambient declarations without bodies), and mislabelling them produces
 * spurious syntax errors.
 */
export function languageOf(file: string): 'dts' | 'ts' | 'tsx' {
  if (file.endsWith('.d.ts')) return 'dts';
  if (file.endsWith('.tsx')) return 'tsx';
  return 'ts';
}

/**
 * Parse `source`, throwing on any syntax error.
 *
 * Throwing is deliberate. Every caller here reports what it FINDS, so a file
 * the parser silently gave up on would be indistinguishable from a clean one
 * — the guard would go quiet exactly when something is wrong.
 */
export function parseSource(file: string, source: string): ParsedSource {
  const result = parseSync(file, source, { lang: languageOf(file) });
  if (result.errors.length > 0) {
    throw new Error(`${file} failed to parse: ${result.errors[0]?.message ?? 'unknown error'}`);
  }
  return { file, source, program: result.program };
}

export function parseSourceFile(absolutePath: string, displayName?: string): ParsedSource {
  return parseSource(displayName ?? absolutePath, readFileSync(absolutePath, 'utf8'));
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
 * A node type missing from that table would silently prune its whole subtree
 * — for a guard, that means a violation that stops being reported rather than
 * a test that goes red. Throw instead, so a parser upgrade that outgrows the
 * table fails loudly.
 */
export function walk(node: Node, visit: (node: Node) => void): void {
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

/** `walk`, minus the node itself — the `:has()` of the old ESLint selectors. */
export function walkDescendants(node: Node, visit: (node: Node) => void): void {
  walk(node, candidate => {
    if (candidate !== node) visit(candidate);
  });
}

/** 1-based line of a byte offset, for human-readable violation reports. */
export function lineOf(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

/** The exact source text a node spans — the ESTree counterpart of `getText`. */
export function textOf(parsed: ParsedSource, node: Node): string {
  return parsed.source.slice(node.start, node.end);
}

/**
 * A top-level statement with `export` unwrapped.
 *
 * The TypeScript compiler models `export interface Foo {}` as an
 * `InterfaceDeclaration` carrying an export modifier, so a scan of top-level
 * statements sees it. ESTree wraps it in an `ExportNamedDeclaration` instead,
 * and a naive port would stop seeing exported declarations without ever going
 * red. Unwrapping keeps the guards looking at what they always looked at.
 */
export function unwrapExport(statement: Statement): Node {
  if (statement.type === 'ExportNamedDeclaration' && statement.declaration != null) {
    return statement.declaration;
  }
  return statement;
}

/** Top-level `import … from '…'` declarations, in source order. */
export function topLevelImports(program: Program): ImportDeclaration[] {
  return program.body.filter(
    (statement): statement is ImportDeclaration => statement.type === 'ImportDeclaration'
  );
}
