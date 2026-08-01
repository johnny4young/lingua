/**
 * Renderer type-boundary guard.
 *
 * The historical `types/index.ts` module remains source-compatible, but
 * production execution code imports the domain leaf directly. This test locks
 * compatibility, module budgets, and the no-facade-consumer rule together.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type {
  AppLanguage as FacadeAppLanguage,
  BuiltInLanguage as FacadeBuiltInLanguage,
  ConsoleOutput as FacadeConsoleOutput,
  EditorDiagnostic as FacadeEditorDiagnostic,
  ExecutionContext as FacadeExecutionContext,
  ExecutionError as FacadeExecutionError,
  ExecutionResult as FacadeExecutionResult,
  Language as FacadeLanguage,
  LanguageRunner as FacadeLanguageRunner,
  LineTimingEntry as FacadeLineTimingEntry,
  MagicCommentResult as FacadeMagicCommentResult,
  WorkerResponse as FacadeWorkerResponse,
} from '../../src/renderer/types';
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
import type {
  AppLanguage,
  BuiltInLanguage,
  Language,
} from '../../src/renderer/types/language';

const repoRoot = path.resolve(__dirname, '../..');
const typesDirectory = path.join(repoRoot, 'src/renderer/types');
const executionSymbols = new Set([
  'ConsoleOutput',
  'EditorDiagnostic',
  'ExecutionContext',
  'ExecutionError',
  'ExecutionResult',
  'LanguageRunner',
  'LineTimingEntry',
  'MagicCommentResult',
  'WorkerResponse',
]);

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

const compatibilityProbe: [
  Assert<Equal<FacadeAppLanguage, AppLanguage>>,
  Assert<Equal<FacadeBuiltInLanguage, BuiltInLanguage>>,
  Assert<Equal<FacadeConsoleOutput, ConsoleOutput>>,
  Assert<Equal<FacadeEditorDiagnostic, EditorDiagnostic>>,
  Assert<Equal<FacadeExecutionContext, ExecutionContext>>,
  Assert<Equal<FacadeExecutionError, ExecutionError>>,
  Assert<Equal<FacadeExecutionResult, ExecutionResult>>,
  Assert<Equal<FacadeLanguage, Language>>,
  Assert<Equal<FacadeLanguageRunner, LanguageRunner>>,
  Assert<Equal<FacadeLineTimingEntry, LineTimingEntry>>,
  Assert<Equal<FacadeMagicCommentResult, MagicCommentResult>>,
  Assert<Equal<FacadeWorkerResponse, WorkerResponse>>,
] = [true, true, true, true, true, true, true, true, true, true, true, true];

function sourceModules(directory: string): string[] {
  const absoluteDirectory = path.join(repoRoot, directory);
  return readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap(entry => {
    const relativePath = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) return sourceModules(relativePath);
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [relativePath] : [];
  });
}

function lineCount(file: string): number {
  return readFileSync(path.join(typesDirectory, file), 'utf8').split('\n').length;
}

function executionFacadeImports(sourceModule: string): string[] {
  const absolutePath = path.join(repoRoot, sourceModule);
  const source = readFileSync(absolutePath, 'utf8');
  const sourceFile = ts.createSourceFile(absolutePath, source, ts.ScriptTarget.Latest, true);
  const matches: string[] = [];

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !/(^|\/)types(?:\/index)?$/u.test(statement.moduleSpecifier.text)
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (executionSymbols.has(importedName)) matches.push(importedName);
    }
  }

  return matches;
}

describe('renderer type boundaries', () => {
  it('preserves the historical execution type exports', () => {
    expect(compatibilityProbe).toHaveLength(12);
  });

  it('keeps the language and execution modules within domain budgets', () => {
    expect(lineCount('language.ts')).toBeLessThanOrEqual(50);
    expect(lineCount('execution.ts')).toBeLessThanOrEqual(500);
    expect(lineCount('index.ts')).toBeLessThanOrEqual(1_120);
  });

  it('keeps the language leaf dependency-free and execution imports type-only', () => {
    const languageSource = readFileSync(path.join(typesDirectory, 'language.ts'), 'utf8');
    expect(languageSource).not.toMatch(/\b(?:import|export)\s+(?:type\s+)?[^;]*from\b/u);

    const executionSource = readFileSync(path.join(typesDirectory, 'execution.ts'), 'utf8');
    const executionFile = ts.createSourceFile(
      'execution.ts',
      executionSource,
      ts.ScriptTarget.Latest,
      true
    );
    const imports = executionFile.statements.filter(ts.isImportDeclaration);
    expect(imports).toHaveLength(4);
    expect(imports.every(statement => statement.importClause?.isTypeOnly)).toBe(true);
    expect(executionSource).not.toContain("from './index'");
  });

  it('keeps production execution consumers off the historical barrel', () => {
    const offenders = sourceModules('src').flatMap(sourceModule =>
      executionFacadeImports(sourceModule).map(symbol => `${sourceModule}: ${symbol}`)
    );
    expect(offenders).toEqual([]);
  });
});
