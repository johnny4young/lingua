/**
 * Renderer type-boundary guard.
 *
 * The historical `types/index.ts` module remains source-compatible for tests
 * and external consumers. Production source imports one domain leaf directly,
 * so editor, console, execution, language, and settings contracts cannot pull
 * each other into unrelated dependency surfaces.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type {
  AppLanguage as FacadeAppLanguage,
  BuiltInLanguage as FacadeBuiltInLanguage,
  CollapsedConsoleRow as FacadeCollapsedConsoleRow,
  ConsoleClearSnapshot as FacadeConsoleClearSnapshot,
  ConsoleEntry as FacadeConsoleEntry,
  ConsoleEntryType as FacadeConsoleEntryType,
  ConsoleOutput as FacadeConsoleOutput,
  ConsolePayloadKindBucket as FacadeConsolePayloadKindBucket,
  ConsolePayloadKindFilter as FacadeConsolePayloadKindFilter,
  ConsoleState as FacadeConsoleState,
  EditorDiagnostic as FacadeEditorDiagnostic,
  EditorRevealRequest as FacadeEditorRevealRequest,
  EditorState as FacadeEditorState,
  ExecutionContext as FacadeExecutionContext,
  ExecutionError as FacadeExecutionError,
  ExecutionResult as FacadeExecutionResult,
  FileTab as FacadeFileTab,
  InputSet as FacadeInputSet,
  Language as FacadeLanguage,
  LanguageRunner as FacadeLanguageRunner,
  LayoutPreset as FacadeLayoutPreset,
  LineTimingEntry as FacadeLineTimingEntry,
  MagicCommentResult as FacadeMagicCommentResult,
  RestoreSessionMode as FacadeRestoreSessionMode,
  RichOutputPayload as FacadeRichOutputPayload,
  RuntimeTimeoutPreset as FacadeRuntimeTimeoutPreset,
  ScopeSnapshot as FacadeScopeSnapshot,
  SettingsState as FacadeSettingsState,
  TabExecutionState as FacadeTabExecutionState,
  WorkerResponse as FacadeWorkerResponse,
} from '../../src/renderer/types';
import type {
  CollapsedConsoleRow,
  ConsoleClearSnapshot,
  ConsoleEntry,
  ConsoleEntryType,
  ConsolePayloadKindBucket,
  ConsolePayloadKindFilter,
  ConsoleState,
} from '../../src/renderer/types/console';
import type {
  EditorRevealRequest,
  EditorState,
  FileTab,
  InputSet,
  TabExecutionState,
} from '../../src/renderer/types/editor';
import type {
  ConsoleOutput,
  EditorDiagnostic,
  ExecutionContext,
  ExecutionError,
  ExecutionResult,
  LanguageRunner,
  LineTimingEntry,
  MagicCommentResult,
  WorkerResponse,
} from '../../src/renderer/types/execution';
import type { AppLanguage, BuiltInLanguage, Language } from '../../src/renderer/types/language';
import type {
  LayoutPreset,
  RestoreSessionMode,
  SettingsState,
} from '../../src/renderer/types/settings';
import type { RichOutputPayload } from '../../src/shared/richOutput';
import type { RuntimeTimeoutPreset } from '../../src/shared/runtimeTimeoutPresets';
import type { ScopeSnapshot } from '../../src/shared/scopeSnapshot';

const repoRoot = path.resolve(__dirname, '../..');
const typesDirectory = path.join(repoRoot, 'src/renderer/types');

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

const compatibilityProbe: [
  Assert<Equal<FacadeAppLanguage, AppLanguage>>,
  Assert<Equal<FacadeBuiltInLanguage, BuiltInLanguage>>,
  Assert<Equal<FacadeCollapsedConsoleRow, CollapsedConsoleRow>>,
  Assert<Equal<FacadeConsoleClearSnapshot, ConsoleClearSnapshot>>,
  Assert<Equal<FacadeConsoleEntry, ConsoleEntry>>,
  Assert<Equal<FacadeConsoleEntryType, ConsoleEntryType>>,
  Assert<Equal<FacadeConsoleOutput, ConsoleOutput>>,
  Assert<Equal<FacadeConsolePayloadKindBucket, ConsolePayloadKindBucket>>,
  Assert<Equal<FacadeConsolePayloadKindFilter, ConsolePayloadKindFilter>>,
  Assert<Equal<FacadeConsoleState, ConsoleState>>,
  Assert<Equal<FacadeEditorDiagnostic, EditorDiagnostic>>,
  Assert<Equal<FacadeEditorRevealRequest, EditorRevealRequest>>,
  Assert<Equal<FacadeEditorState, EditorState>>,
  Assert<Equal<FacadeExecutionContext, ExecutionContext>>,
  Assert<Equal<FacadeExecutionError, ExecutionError>>,
  Assert<Equal<FacadeExecutionResult, ExecutionResult>>,
  Assert<Equal<FacadeFileTab, FileTab>>,
  Assert<Equal<FacadeInputSet, InputSet>>,
  Assert<Equal<FacadeLanguage, Language>>,
  Assert<Equal<FacadeLanguageRunner, LanguageRunner>>,
  Assert<Equal<FacadeLayoutPreset, LayoutPreset>>,
  Assert<Equal<FacadeLineTimingEntry, LineTimingEntry>>,
  Assert<Equal<FacadeMagicCommentResult, MagicCommentResult>>,
  Assert<Equal<FacadeRestoreSessionMode, RestoreSessionMode>>,
  Assert<Equal<FacadeRichOutputPayload, RichOutputPayload>>,
  Assert<Equal<FacadeRuntimeTimeoutPreset, RuntimeTimeoutPreset>>,
  Assert<Equal<FacadeScopeSnapshot, ScopeSnapshot>>,
  Assert<Equal<FacadeSettingsState, SettingsState>>,
  Assert<Equal<FacadeTabExecutionState, TabExecutionState>>,
  Assert<Equal<FacadeWorkerResponse, WorkerResponse>>,
] = Array.from({ length: 30 }, () => true) as never;

const MODULE_BUDGETS = {
  'index.ts': 30,
  'language.ts': 50,
  'editor.ts': 450,
  'console.ts': 150,
  'execution.ts': 500,
  'settings.ts': 620,
} as const;

function sourceModules(directory: string): string[] {
  const absoluteDirectory = path.join(repoRoot, directory);
  return readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap(entry => {
    const relativePath = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) return sourceModules(relativePath);
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [relativePath] : [];
  });
}

function typeSource(filename: string): string {
  return readFileSync(path.join(typesDirectory, filename), 'utf8');
}

function leafDependencies(filename: string): string[] {
  const sourceFile = ts.createSourceFile(
    filename,
    typeSource(filename),
    ts.ScriptTarget.Latest,
    true
  );

  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .filter(statement => ts.isStringLiteral(statement.moduleSpecifier))
    .map(statement => (statement.moduleSpecifier as ts.StringLiteral).text)
    .filter(specifier => specifier.startsWith('./'))
    .map(specifier => `${specifier.slice(2).replace(/\.ts$/u, '')}.ts`)
    .filter(dependency => dependency in MODULE_BUDGETS && dependency !== 'index.ts');
}

function findLeafCycle(graph: ReadonlyMap<string, readonly string[]>): string[] | null {
  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];

  const visit = (node: string): string[] | null => {
    if (active.has(node)) {
      const cycleStart = stack.indexOf(node);
      return [...stack.slice(cycleStart), node];
    }
    if (visited.has(node)) return null;

    visited.add(node);
    active.add(node);
    stack.push(node);
    for (const dependency of graph.get(node) ?? []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    stack.pop();
    active.delete(node);
    return null;
  };

  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

function lineCount(filename: string): number {
  return typeSource(filename).split('\n').length;
}

function resolvesToFacade(sourceModule: string, specifier: string): boolean {
  if (specifier === '@/types' || specifier === '@/types/index') return true;
  if (!specifier.startsWith('.')) return false;
  const resolved = path.resolve(path.dirname(path.join(repoRoot, sourceModule)), specifier);
  const withoutExtension = resolved.replace(/\.(?:ts|tsx)$/u, '').replace(/\/index$/u, '');
  return withoutExtension === typesDirectory;
}

function facadeImports(sourceModule: string): string[] {
  const absolutePath = path.join(repoRoot, sourceModule);
  const sourceFile = ts.createSourceFile(
    absolutePath,
    readFileSync(absolutePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .filter(statement => ts.isStringLiteral(statement.moduleSpecifier))
    .map(statement => (statement.moduleSpecifier as ts.StringLiteral).text)
    .filter(specifier => resolvesToFacade(sourceModule, specifier));
}

describe('renderer type boundaries', () => {
  it('preserves every historical facade type export', () => {
    expect(compatibilityProbe).toHaveLength(30);
  });

  it('keeps every domain module within its review budget', () => {
    for (const [filename, budget] of Object.entries(MODULE_BUDGETS)) {
      expect(lineCount(filename), `${filename} exceeds ${budget} lines`).toBeLessThanOrEqual(
        budget
      );
    }
  });

  it('keeps the compatibility facade export-only', () => {
    const source = typeSource('index.ts');
    expect(source).not.toMatch(/^import\b/mu);
    expect(source).not.toMatch(/\b(?:function|class|const|let|var)\b/u);
    expect(source.match(/^export type\b/gmu)).toHaveLength(8);
  });

  it('keeps domain-leaf dependencies type-only and acyclic', () => {
    const leafFilenames = Object.keys(MODULE_BUDGETS).filter(name => name !== 'index.ts');
    const graph = new Map<string, readonly string[]>();

    for (const filename of leafFilenames) {
      const sourceFile = ts.createSourceFile(
        filename,
        typeSource(filename),
        ts.ScriptTarget.Latest,
        true
      );
      const imports = sourceFile.statements.filter(ts.isImportDeclaration);
      expect(
        imports.every(statement => statement.importClause?.isTypeOnly),
        `${filename} contains a value import`
      ).toBe(true);
      expect(typeSource(filename)).not.toContain("from './index'");
      graph.set(filename, leafDependencies(filename));
    }

    expect(findLeafCycle(graph), 'renderer type leaf dependency cycle').toBeNull();
  });

  it('keeps every production consumer off the historical facade', () => {
    const offenders = sourceModules('src')
      .filter(sourceModule => sourceModule !== 'src/renderer/types/index.ts')
      .flatMap(sourceModule =>
        facadeImports(sourceModule).map(specifier => `${sourceModule}: ${specifier}`)
      );
    expect(offenders).toEqual([]);
  });
});
