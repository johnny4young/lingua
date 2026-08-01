/**
 * Static runtime import graph guard.
 *
 * Type-only references are erased and dynamic imports are deliberate async
 * boundaries, so neither participates in this graph. Eager imports and
 * re-exports must remain acyclic: a cycle there makes initialization order
 * observable and can expose partially initialized Zustand stores.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

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

function hasRuntimeImport(statement: ts.ImportDeclaration): boolean {
  const clause = statement.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name || !clause.namedBindings) return true;
  if (ts.isNamespaceImport(clause.namedBindings)) return true;
  return clause.namedBindings.elements.some(element => !element.isTypeOnly);
}

function hasRuntimeExport(statement: ts.ExportDeclaration): boolean {
  if (statement.isTypeOnly) return false;
  if (!statement.exportClause || ts.isNamespaceExport(statement.exportClause)) {
    return true;
  }
  return statement.exportClause.elements.some(element => !element.isTypeOnly);
}

function runtimeSpecifiers(filename: string): string[] {
  const sourceFile = ts.createSourceFile(
    filename,
    readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  return sourceFile.statements.flatMap(statement => {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      hasRuntimeImport(statement)
    ) {
      return [statement.moduleSpecifier.text];
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      hasRuntimeExport(statement)
    ) {
      return [statement.moduleSpecifier.text];
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
