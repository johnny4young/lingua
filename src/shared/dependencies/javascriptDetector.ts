/**
 * RL-025 Slice A — JS / TS dependency detector backed by acorn.
 *
 * The detector extracts every external package referenced by an
 * `import` declaration, dynamic `import(…)`, or `require(…)` call.
 * Relative paths (`./foo`, `../bar`), absolute paths, Node built-ins
 * (`fs`, `path`, `node:fs`, …), and dynamic specifiers
 * (`import(name)`, template literals) are intentionally skipped —
 * the panel only surfaces things a user could actually `npm install`.
 *
 * The parser runs in module + JSX-friendly mode with `latestEcmaVersion`
 * so TypeScript-style annotations stripped by `esbuild-wasm` upstream
 * also pass through cleanly. Parse errors fall back to a regex sweep
 * over the buffer so mid-keystroke states still surface the imports
 * the user typed seconds ago instead of going blank.
 */

import { Parser, type Node } from 'acorn';
import type {
  DependencyAdapter,
  DetectedDependency,
} from './types';
import { DEPENDENCY_DETECTION_MAX_BUFFER_BYTES } from './types';

/**
 * Closed list of Node.js built-ins. A package with the same name
 * (e.g. someone publishing a `path` shim) would be hidden — that is
 * the right trade since the user almost never installs over a
 * built-in name in practice and the false negative cost is small.
 *
 * The `node:` prefix is handled separately by stripping the prefix
 * before this lookup.
 */
const NODE_BUILTINS = new Set<string>([
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'path/posix',
  'path/win32',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'readline/promises',
  'repl',
  'stream',
  'stream/promises',
  'stream/web',
  'string_decoder',
  'sys',
  'timers',
  'timers/promises',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'util/types',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
]);

const NODE_PROTOCOL_ONLY_BUILTINS = new Set<string>([
  'sea',
  'sqlite',
  'test',
  'test/reporters',
]);

const NPM_PACKAGE_SEGMENT_RE = /^[a-z0-9][a-z0-9._-]*$/iu;

function isPackageSegment(segment: string): boolean {
  return NPM_PACKAGE_SEGMENT_RE.test(segment);
}

/**
 * Split a specifier into `{ name, submodule? }`. Handles scoped
 * packages (`@scope/pkg` → name; `@scope/pkg/sub` → submodule), bare
 * packages (`lodash` → name only), and submodules (`lodash/fp` →
 * `name: 'lodash', submodule: 'fp'`). Returns null for things that
 * don't look like a package at all.
 */
function splitSpecifier(
  raw: string
): { readonly name: string; readonly submodule?: string } | null {
  if (raw.length === 0) return null;
  if (raw.startsWith('.') || raw.startsWith('/')) return null;
  const noProtocol = raw.startsWith('node:') ? raw.slice('node:'.length) : raw;
  if (noProtocol.length === 0) return null;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(noProtocol)) return null;
  if (noProtocol.startsWith('#') || noProtocol.startsWith('~/')) return null;
  if (noProtocol.startsWith('@')) {
    const firstSlash = noProtocol.indexOf('/');
    if (firstSlash === -1) return null;
    const scope = noProtocol.slice(1, firstSlash);
    if (!isPackageSegment(scope)) return null;
    const secondSlash = noProtocol.indexOf('/', firstSlash + 1);
    const pkg =
      secondSlash === -1
        ? noProtocol.slice(firstSlash + 1)
        : noProtocol.slice(firstSlash + 1, secondSlash);
    if (!isPackageSegment(pkg)) return null;
    const name = `@${scope}/${pkg}`;
    if (secondSlash === -1) {
      return { name };
    }
    const submodule = noProtocol.slice(secondSlash + 1);
    return submodule.length === 0 ? { name } : { name, submodule };
  }
  const slash = noProtocol.indexOf('/');
  if (slash === -1) {
    return isPackageSegment(noProtocol) ? { name: noProtocol } : null;
  }
  const name = noProtocol.slice(0, slash);
  if (!isPackageSegment(name)) return null;
  const submodule = noProtocol.slice(slash + 1);
  return submodule.length === 0 ? { name } : { name, submodule };
}

function isInstallable(raw: string, name: string): boolean {
  if (raw.startsWith('node:')) {
    const noProtocol = raw.slice('node:'.length);
    return (
      !NODE_BUILTINS.has(noProtocol) &&
      !NODE_BUILTINS.has(name) &&
      !NODE_PROTOCOL_ONLY_BUILTINS.has(noProtocol) &&
      !NODE_PROTOCOL_ONLY_BUILTINS.has(name)
    );
  }
  return !NODE_BUILTINS.has(name);
}

interface SpecifierHit {
  readonly start: number;
  readonly dependency: DetectedDependency;
}

interface DetectorScratch {
  readonly hits: SpecifierHit[];
}

function pushSpecifier(
  scratch: DetectorScratch,
  raw: string | undefined,
  kind: DetectedDependency['kind'],
  start: number
): void {
  if (typeof raw !== 'string') return;
  const trimmed = raw.trim();
  const split = splitSpecifier(trimmed);
  if (!split) return;
  if (!isInstallable(trimmed, split.name)) return;
  scratch.hits.push({
    start,
    dependency: {
      name: split.name,
      kind,
      ...(split.submodule ? { submodule: split.submodule } : {}),
    },
  });
}

function dedupeInDocumentOrder(
  hits: readonly SpecifierHit[]
): DetectedDependency[] {
  // Sort by AST / regex offset so the FIRST occurrence in source
  // order wins the dedup race — regardless of how the AST walker
  // pushed nodes onto its work stack.
  const sorted = [...hits].sort((a, b) => a.start - b.start);
  const seen = new Set<string>();
  const out: DetectedDependency[] = [];
  for (const hit of sorted) {
    if (seen.has(hit.dependency.name)) continue;
    seen.add(hit.dependency.name);
    out.push(hit.dependency);
  }
  return out;
}

interface AcornImportNode extends Node {
  readonly type: string;
  readonly start: number;
  readonly source?: {
    readonly type: string;
    readonly value?: unknown;
    readonly start?: number;
  };
  readonly callee?: { readonly type: string; readonly name?: string };
  readonly arguments?: ReadonlyArray<{
    readonly type: string;
    readonly value?: unknown;
    readonly start?: number;
  }>;
}

function walkAst(root: Node, visit: (node: Node) => void): void {
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    visit(node);
    for (const value of Object.values(node)) {
      if (!value || typeof value !== 'object') continue;
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child === 'object' && 'type' in child) {
            stack.push(child as Node);
          }
        }
      } else if ('type' in (value as Record<string, unknown>)) {
        stack.push(value as Node);
      }
    }
  }
}

function detectViaAst(source: string, scratch: DetectorScratch): boolean {
  try {
    const ast = Parser.parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowImportExportEverywhere: true,
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      allowHashBang: true,
    });
    walkAst(ast as Node, (node) => {
      const typed = node as AcornImportNode;
      if (
        typed.type === 'ImportDeclaration' ||
        typed.type === 'ExportNamedDeclaration' ||
        typed.type === 'ExportAllDeclaration'
      ) {
        const src = typed.source;
        if (src && src.type === 'Literal' && typeof src.value === 'string') {
          pushSpecifier(scratch, src.value, 'import', src.start ?? typed.start);
        }
      }
      if (typed.type === 'ImportExpression') {
        const src = typed.source;
        if (src && src.type === 'Literal' && typeof src.value === 'string') {
          pushSpecifier(scratch, src.value, 'import', src.start ?? typed.start);
        }
      }
      if (
        typed.type === 'CallExpression' &&
        typed.callee &&
        typed.callee.type === 'Identifier' &&
        typed.callee.name === 'require' &&
        Array.isArray(typed.arguments) &&
        typed.arguments.length === 1
      ) {
        const arg = typed.arguments[0];
        if (arg && arg.type === 'Literal' && typeof arg.value === 'string') {
          pushSpecifier(scratch, arg.value, 'require', arg.start ?? typed.start);
        }
      }
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fallback regex sweep when acorn refuses the buffer mid-keystroke.
 * Deliberately conservative — only captures the three syntactic
 * shapes the AST walker handles. Misses dynamic specifiers (same as
 * the AST path) and aliases via template literals.
 */
const FALLBACK_PATTERNS: ReadonlyArray<{
  readonly re: RegExp;
  readonly kind: DetectedDependency['kind'];
}> = [
  {
    re: /\bimport\s*(?:[^'"\n;]*?from\s*)?['"]([^'"\n]+)['"]/gu,
    kind: 'import',
  },
  { re: /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/gu, kind: 'import' },
  {
    re: /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/gu,
    kind: 'require',
  },
  {
    re: /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+['"]([^'"\n]+)['"]/gu,
    kind: 'import',
  },
];

function blankRangePreservingNewlines(
  chars: string[],
  start: number,
  end: number
): void {
  for (let i = start; i < end; i += 1) {
    if (chars[i] !== '\n') chars[i] = ' ';
  }
}

function isLikelySpecifierString(chars: readonly string[], quoteIndex: number): boolean {
  const before = chars
    .slice(Math.max(0, quoteIndex - 160), quoteIndex)
    .join('')
    .replace(/\s+$/u, '');
  return /(?:\bfrom|\bimport\s*\(|\brequire\s*\(|\bimport)$/u.test(before);
}

function maskFallbackSource(source: string): string {
  const chars = source.split('');
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    const next = chars[i + 1];
    if (ch === '/' && next === '/') {
      const start = i;
      i += 2;
      while (i < chars.length && chars[i] !== '\n') i += 1;
      blankRangePreservingNewlines(chars, start, i);
      continue;
    }
    if (ch === '/' && next === '*') {
      const start = i;
      i += 2;
      while (i < chars.length) {
        if (chars[i] === '*' && chars[i + 1] === '/') {
          i += 2;
          break;
        }
        i += 1;
      }
      blankRangePreservingNewlines(chars, start, i);
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      const preserve = isLikelySpecifierString(chars, i);
      i += 1;
      while (i < chars.length) {
        if (chars[i] === '\\') {
          i += 2;
          continue;
        }
        if (chars[i] === quote) {
          i += 1;
          break;
        }
        if (chars[i] === '\n') break;
        i += 1;
      }
      if (!preserve) blankRangePreservingNewlines(chars, start, i);
      continue;
    }
    if (ch === '`') {
      const start = i;
      i += 1;
      while (i < chars.length) {
        if (chars[i] === '\\') {
          i += 2;
          continue;
        }
        if (chars[i] === '`') {
          i += 1;
          break;
        }
        i += 1;
      }
      blankRangePreservingNewlines(chars, start, i);
      continue;
    }
    i += 1;
  }
  return chars.join('');
}

function detectViaRegex(source: string, scratch: DetectorScratch): void {
  const masked = maskFallbackSource(source);
  for (const { re, kind } of FALLBACK_PATTERNS) {
    for (const match of masked.matchAll(re)) {
      pushSpecifier(scratch, match[1], kind, match.index ?? 0);
    }
  }
}

export function detectJavaScriptDependencies(
  source: string
): DetectedDependency[] {
  if (typeof source !== 'string' || source.length === 0) return [];
  if (source.length > DEPENDENCY_DETECTION_MAX_BUFFER_BYTES) return [];
  const scratch: DetectorScratch = { hits: [] };
  const astOk = detectViaAst(source, scratch);
  if (!astOk) {
    detectViaRegex(source, scratch);
  }
  return dedupeInDocumentOrder(scratch.hits);
}

export const javascriptDependencyAdapter: DependencyAdapter = {
  language: 'javascript',
  detect: (source) => detectJavaScriptDependencies(source),
};

export const typescriptDependencyAdapter: DependencyAdapter = {
  language: 'typescript',
  detect: (source) => detectJavaScriptDependencies(source),
};

export type { DependencyAdapterLanguage } from './types';
