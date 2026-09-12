/**
 * Static runtime import graph guard.
 *
 * Type-only references are erased and dynamic imports are deliberate async
 * boundaries, so neither participates in this graph. Eager imports and
 * re-exports must remain acyclic: a cycle there makes initialization order
 * observable and can expose partially initialized Zustand stores.
 */

import { readdirSync } from 'node:fs';
import path from 'node:path';
import type { ExportAllDeclaration, ExportNamedDeclaration, ImportDeclaration } from 'oxc-parser';
import { describe, expect, it } from 'vitest';
import { parseSourceFile } from '../__fixtures__/sourceAst';

const repoRoot = path.resolve(__dirname, '../..');
const sourceRoot = path.join(repoRoot, 'src');
const sourceExtensions = ['.ts', '.tsx', '.mts', '.cts', '.d.ts'] as const;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolutePath);
    return sourceExtensions.some(extension => entry.name.endsWith(extension)) ? [absolutePath] : [];
  });
}

/**
 * `import './side-effect'` carries no specifiers and always runs. So does
 * `import {} from './x'`, which the TypeScript-based version of this guard
 * treated as type-only — the two are indistinguishable in ESTree, and the
 * runtime answer is the one this guard wants. No `src` file uses the empty
 * form today, so the difference is inert; it is recorded rather than hidden.
 */
function hasRuntimeImport(statement: ImportDeclaration): boolean {
  if (statement.importKind === 'type') return false;
  if (statement.specifiers.length === 0) return true;
  // Default and namespace specifiers carry no per-specifier kind: a
  // type-only one can only be spelled `import type`, caught above.
  return statement.specifiers.some(
    specifier => specifier.type !== 'ImportSpecifier' || specifier.importKind !== 'type'
  );
}

function hasRuntimeExport(statement: ExportAllDeclaration | ExportNamedDeclaration): boolean {
  if (statement.exportKind === 'type') return false;
  // `export * from` / `export * as ns from` re-export values wholesale.
  if (statement.type === 'ExportAllDeclaration') return true;
  return statement.specifiers.some(specifier => specifier.exportKind !== 'type');
}

function runtimeSpecifiers(filename: string): string[] {
  const parsed = parseSourceFile(filename, path.relative(repoRoot, filename));

  return parsed.program.body.flatMap(statement => {
    if (statement.type === 'ImportDeclaration') {
      return hasRuntimeImport(statement) ? [statement.source.value] : [];
    }
    if (statement.type === 'ExportAllDeclaration') {
      return hasRuntimeExport(statement) ? [statement.source.value] : [];
    }
    if (statement.type === 'ExportNamedDeclaration' && statement.source != null) {
      return hasRuntimeExport(statement) ? [statement.source.value] : [];
    }
    return [];
  });
}

function resolveSourceModule(
  from: string,
  specifier: string,
  knownFiles: ReadonlySet<string>
): string | null {
  let unresolved: string;
  if (specifier.startsWith('@/')) {
    unresolved = path.join(sourceRoot, 'renderer', specifier.slice(2));
  } else if (specifier.startsWith('#src/')) {
    unresolved = path.join(sourceRoot, specifier.slice(5));
  } else if (specifier.startsWith('.')) {
    unresolved = path.resolve(path.dirname(from), specifier);
  } else {
    return null;
  }

  const candidates = [
    unresolved,
    ...sourceExtensions.map(extension => `${unresolved}${extension}`),
    ...sourceExtensions.map(extension => path.join(unresolved, `index${extension}`)),
  ];
  return candidates.find(candidate => knownFiles.has(candidate)) ?? null;
}

function findCycle(graph: ReadonlyMap<string, readonly string[]>): string[] | null {
  const visited = new Set<string>();
  const active = new Set<string>();
  const pathStack: string[] = [];

  const visit = (module: string): string[] | null => {
    if (active.has(module)) {
      const start = pathStack.indexOf(module);
      return [...pathStack.slice(start), module];
    }
    if (visited.has(module)) return null;

    visited.add(module);
    active.add(module);
    pathStack.push(module);
    for (const dependency of graph.get(module) ?? []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    pathStack.pop();
    active.delete(module);
    return null;
  };

  for (const module of graph.keys()) {
    const cycle = visit(module);
    if (cycle) return cycle;
  }
  return null;
}

describe('static runtime import graph', () => {
  it('does not contain eager module cycles', () => {
    const files = sourceFiles(sourceRoot);
    const knownFiles = new Set(files);
    const graph = new Map(
      files.map(filename => [
        filename,
        runtimeSpecifiers(filename).flatMap(specifier => {
          const resolved = resolveSourceModule(filename, specifier, knownFiles);
          return resolved ? [resolved] : [];
        }),
      ])
    );
    const cycle = findCycle(graph);
    const readableCycle = cycle ? cycle.map(filename => path.relative(repoRoot, filename)) : null;

    expect(readableCycle, readableCycle?.join(' -> ')).toBeNull();
  });
});
