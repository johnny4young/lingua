/**
 * Browser execution-worker architecture guard.
 *
 * Included by tsconfig.test.json so protocol-discriminator assertions are
 * compile-time locks in addition to the runtime source-boundary checks.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { JsWorkerInboundMessage } from '../../src/renderer/workers/js-worker-protocol';
import type {
  PythonWorkerDependencyResponse,
  PythonWorkerInboundMessage,
} from '../../src/renderer/workers/python-worker-protocol';

const repoRoot = path.resolve(__dirname, '../..');
const workersRoot = path.join(repoRoot, 'src/renderer/workers');

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

const protocolProbe: [
  Assert<
    Equal<
      JsWorkerInboundMessage['type'],
      'execute' | 'resume' | 'step' | 'set-breakpoints' | 'set-watches'
    >
  >,
  Assert<
    Equal<
      PythonWorkerInboundMessage['type'],
      'init' | 'reset-scope' | 'execute' | 'dependencies:list-loaded' | 'dependencies:install'
    >
  >,
  Assert<
    Equal<
      PythonWorkerDependencyResponse['type'],
      'dependencies:list-loaded:reply' | 'dependencies:install:log' | 'dependencies:install:done'
    >
  >,
] = [true, true, true];

const MODULE_BUDGETS = {
  'js-worker.ts': 70,
  'js-worker-protocol.ts': 100,
  'js-worker-execution.ts': 520,
  'js-worker-serialization.ts': 500,
  'js-worker-runtime.ts': 220,
  'js-worker-debugger.ts': 130,
  'debuggerExpression.ts': 560,
  'js-worker-stdin.ts': 60,
  'python-worker.ts': 70,
  'python-worker-protocol.ts': 130,
  'python-worker-execution.ts': 420,
  'python-worker-serialization.ts': 520,
  'python-worker-sources.ts': 500,
  'python-worker-auto-log-source.ts': 120,
  'python-worker-runtime.ts': 220,
  'python-worker-dependencies.ts': 250,
  'python-worker-env.ts': 80,
  'python-worker-stdin.ts': 80,
} as const;

function workerSource(filename: string): string {
  return readFileSync(path.join(workersRoot, filename), 'utf8');
}

function lineCount(filename: string): number {
  return workerSource(filename).split('\n').length;
}

function sourceModules(directory: string): string[] {
  const absoluteDirectory = path.join(repoRoot, directory);
  return readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap(entry => {
    const relativePath = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) return sourceModules(relativePath);
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [relativePath] : [];
  });
}

describe('browser execution worker architecture', () => {
  it('keeps protocol discriminators closed and compile-time checked', () => {
    expect(protocolProbe).toEqual([true, true, true]);
  });

  it('keeps stable Vite entrypoints transport-only', () => {
    const jsEntry = workerSource('js-worker.ts');
    const pythonEntry = workerSource('python-worker.ts');

    expect(jsEntry).toContain('createJsWorkerMessageHandler');
    expect(jsEntry).toContain("ctx.addEventListener('message'");
    expect(jsEntry).not.toContain('const AsyncFunction =');
    expect(jsEntry).not.toContain('captureJsScope(');

    expect(pythonEntry).toContain('createPythonRuntimeAdapter');
    expect(pythonEntry).toContain("ctx.addEventListener('message'");
    expect(pythonEntry).not.toMatch(/runPythonAsync|micropip\.install|__lingua_print/u);
  });

  it('keeps debugger expressions on the bounded interpreter path', () => {
    const evaluator = workerSource('debuggerExpression.ts');
    expect(evaluator).toContain('parseExpressionAt');
    expect(evaluator).not.toMatch(/\beval\s*\(/u);
    expect(evaluator).not.toContain('new Function');
    expect(evaluator).not.toContain('new AsyncFunction');
  });

  it('keeps message listeners in the two stable entrypoints', () => {
    for (const filename of Object.keys(MODULE_BUDGETS)) {
      const hasListener = workerSource(filename).includes("addEventListener('message'");
      expect(hasListener, filename).toBe(
        filename === 'js-worker.ts' || filename === 'python-worker.ts'
      );
    }
  });

  it('keeps responsibility modules within their review budgets', () => {
    for (const [filename, budget] of Object.entries(MODULE_BUDGETS)) {
      expect(lineCount(filename), `${filename} exceeds ${budget} lines`).toBeLessThanOrEqual(
        budget
      );
    }
  });

  it('keeps responsibility-module imports acyclic', () => {
    const modules = new Set(Object.keys(MODULE_BUDGETS));
    const graph = new Map<string, string[]>();
    for (const filename of modules) {
      const imports = [...workerSource(filename).matchAll(/from\s+['"]\.\/([^'"]+)['"]/gu)]
        .map(match => `${match[1]}.ts`)
        .filter(dependency => modules.has(dependency));
      graph.set(filename, imports);
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (filename: string, ancestry: string[]): void => {
      expect(
        visiting.has(filename),
        `worker import cycle: ${[...ancestry, filename].join(' -> ')}`
      ).toBe(false);
      if (visited.has(filename)) return;
      visiting.add(filename);
      for (const dependency of graph.get(filename) ?? []) {
        visit(dependency, [...ancestry, filename]);
      }
      visiting.delete(filename);
      visited.add(filename);
    };
    for (const filename of modules) visit(filename, []);
  });

  it('keeps production consumers on stable worker entrypoints', () => {
    const internalImport =
      /(?:from\s+|import\s*\()['"][^'"]*workers\/(?:js-worker-(?:debugger|execution|protocol|runtime|serialization|stdin)|python-worker-(?:dependencies|execution|protocol|runtime|serialization|sources))/u;

    const offenders = sourceModules('src')
      .filter(filename => !filename.startsWith('src/renderer/workers/'))
      .filter(filename => internalImport.test(readFileSync(path.join(repoRoot, filename), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
