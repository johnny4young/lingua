import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RUNTIME_WORKER_CSP,
  SQL_WORKER_CSP,
  TOOLING_WORKER_CSP,
  WORKER_ENTRY_CSP,
  workerScriptCsp,
} from '../../src/main/workerCsp';

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(';').map(part => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name!, sources];
    })
  );
}

const FOREIGN_CODE_SOURCE = /^(?:https?:|wss?:|\*|[a-z0-9.-]+\.[a-z]{2,}|'unsafe-inline')/i;

describe('worker CSP policies', () => {
  it.each([
    ['runtime', RUNTIME_WORKER_CSP],
    ['sql', SQL_WORKER_CSP],
    ['tooling', TOOLING_WORKER_CSP],
  ])('%s loads code only from the app and denies anything unnamed', (_name, policy) => {
    const parsed = directives(policy);
    expect(parsed.get('default-src')).toEqual(["'none'"]);
    expect(parsed.get('script-src')).toContain("'self'");
    expect(parsed.get('script-src')!.filter(source => FOREIGN_CODE_SOURCE.test(source))).toEqual([]);
    expect(parsed.has('script-src-elem')).toBe(false);
  });

  it('keeps every host Allow reaches for running code; the guard decides per run', () => {
    const connect = directives(RUNTIME_WORKER_CSP).get('connect-src');
    expect(connect).toEqual(expect.arrayContaining(["'self'", 'blob:', 'data:', 'https:', 'wss:', 'http:', 'ws:']));
    expect(directives(RUNTIME_WORKER_CSP).get('script-src')).toEqual(
      expect.arrayContaining(['blob:', "'unsafe-eval'", "'wasm-unsafe-eval'"])
    );
    expect(directives(RUNTIME_WORKER_CSP).get('font-src')).not.toContain('https:');
  });

  it('runs no JavaScript eval in the SQL engine and reaches no network from editor services', () => {
    expect(directives(SQL_WORKER_CSP).get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(directives(TOOLING_WORKER_CSP).get('connect-src')).toEqual(["'self'"]);
    expect(directives(TOOLING_WORKER_CSP).get('script-src')).toEqual(["'self'"]);
  });
});

describe('workerScriptCsp', () => {
  it.each([
    ['assets/js-worker-BYCOppnO.js', RUNTIME_WORKER_CSP],
    ['assets/python-worker-D2Zeslku.js', RUNTIME_WORKER_CSP],
    ['assets/duckdb-browser-eh.worker-hQa-dcAV.js', SQL_WORKER_CSP],
    ['assets/ts.worker-DJNYEI7I.js', TOOLING_WORKER_CSP],
    ['assets/utility-compute-worker-DR1a7tvi.js', TOOLING_WORKER_CSP],
    // A case-insensitive file system serves the same file under another case.
    ['assets/EDITOR.WORKER-C3R1XRKP.JS', TOOLING_WORKER_CSP],
  ])('gives %s its entry policy', (file, policy) => {
    expect(workerScriptCsp(file)).toBe(policy);
  });

  it.each([
    'assets/main-Ab12Cd34.js',
    'assets/editor.worker.js',
    'assets/nested/ts.worker-DJNYEI7I.js',
    'pyodide/pyodide.mjs',
    'pyodide/pyodide.asm.js',
    'assets/x.cjs',
  ])('gives any other JavaScript file, %s, the runtime policy', file => {
    expect(workerScriptCsp(file)).toBe(RUNTIME_WORKER_CSP);
  });

  it.each(['index.html', 'assets/index-Ab12Cd34.css', 'pyodide/pyodide.asm.wasm', 'assets/js-worker-BYCOppnO.js.map'])(
    'sends no policy with %s',
    file => {
      expect(workerScriptCsp(file)).toBeNull();
    }
  );

  it('never resolves an entry through the object prototype', () => {
    expect(workerScriptCsp('assets/constructor-Ab12Cd34.js')).toBe(RUNTIME_WORKER_CSP);
    expect(workerScriptCsp('assets/__proto__-Ab12Cd34.js')).toBe(RUNTIME_WORKER_CSP);
  });
});

const rendererRoot = path.resolve(__dirname, '../../src/renderer');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const URL_WORKER = /new\s+(?:Shared)?Worker\(\s*new\s+URL\(\s*['"][^'"]*\/([\w.-]+)\.ts['"]/g;
const IMPORTED_WORKER = /['"][^'"]*\/([\w.-]+\.worker)(?:\.js)?\?(?:worker(?:&url)?|url)['"]/g;
const ANY_WORKER = /new\s+(?:Shared)?Worker\(/g;

describe('worker entry coverage', () => {
  const sources = sourceFiles(rendererRoot).map(file => ({
    file: path.relative(rendererRoot, file),
    code: withoutComments(readFileSync(file, 'utf8')),
  }));

  it('lists a policy for every worker entry the renderer builds, and nothing else', () => {
    const entries = new Set<string>();
    for (const { code } of sources) {
      for (const match of code.matchAll(URL_WORKER)) entries.add(match[1]!);
      for (const match of code.matchAll(IMPORTED_WORKER)) entries.add(match[1]!);
    }
    expect([...entries].sort()).toEqual(Object.keys(WORKER_ENTRY_CSP).sort());
  });

  it('starts workers only from entries the scan above can see', () => {
    const unseen = sources.flatMap(({ file, code }) => {
      const constructions = [...code.matchAll(ANY_WORKER)].length;
      const literal = [...code.matchAll(URL_WORKER)].length;
      const imported = [...code.matchAll(IMPORTED_WORKER)].length;
      return constructions > literal + imported ? [file] : [];
    });
    expect(unseen).toEqual([]);
  });
});
