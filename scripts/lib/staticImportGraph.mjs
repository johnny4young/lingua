import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'];

/**
 * Strip JavaScript comments without treating URL-like text inside string
 * literals as comments. This is deliberately a small source-graph scanner,
 * not a JavaScript parser: it only feeds the static import patterns below.
 */
export function stripComments(source) {
  let output = '';
  let index = 0;
  let quote = null;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (quote) {
      if (char === '\\') {
        output += char + (next ?? '');
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      output += char;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      output += char;
      index += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      continue;
    }
    output += char;
    index += 1;
  }

  return output;
}

function namedBindingsAreTypeOnly(clause) {
  const trimmed = clause.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false;
  const bindings = trimmed
    .slice(1, -1)
    .split(',')
    .map(binding => binding.trim())
    .filter(Boolean);
  return bindings.length > 0 && bindings.every(binding => /^type\b/u.test(binding));
}

/**
 * Return static runtime imports and re-exports. Type-only and dynamic imports
 * are intentionally excluded because neither creates an eager bundle edge.
 */
export function staticSpecifiers(source) {
  const uncommented = stripComments(source);
  const specifiers = [];
  const importRe = /^\s*import\s+(?!type\s)([^;]*?)from\s*['"]([^'"]+)['"]/gmu;
  const bareImportRe = /^\s*import\s*['"]([^'"]+)['"]/gmu;
  const reExportRe = /^\s*export\s+(?!type\s)([^;]*?)from\s*['"]([^'"]+)['"]/gmu;

  for (const match of uncommented.matchAll(importRe)) {
    if (!namedBindingsAreTypeOnly(match[1])) specifiers.push(match[2]);
  }
  for (const match of uncommented.matchAll(bareImportRe)) {
    specifiers.push(match[1]);
  }
  for (const match of uncommented.matchAll(reExportRe)) {
    if (!namedBindingsAreTypeOnly(match[1])) specifiers.push(match[2]);
  }
  return specifiers;
}

function applyAlias(specifier, aliases) {
  for (const [from, to] of aliases) {
    if (specifier === from) return to;
    if (specifier.startsWith(`${from}/`)) {
      return `${to}/${specifier.slice(from.length + 1)}`;
    }
  }
  return null;
}

/**
 * Resolve a source import the same limited way the graph guard needs:
 * relative paths and already-normalized Vite aliases only.
 */
export function resolveSourceImport(repoRoot, fromFile, specifier, aliases = []) {
  const aliased = specifier.startsWith('.') ? null : applyAlias(specifier, aliases);
  if (!specifier.startsWith('.') && !aliased) return null;

  const base = aliased
    ? path.join(repoRoot, aliased)
    : path.resolve(path.dirname(path.join(repoRoot, fromFile)), specifier);
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map(extension => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map(extension => path.join(base, `index${extension}`)),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate) || candidate.endsWith(path.sep)) continue;
    try {
      if (readFileSync(candidate).length >= 0) {
        const relative = path.relative(repoRoot, candidate).split(path.sep).join('/');
        if (SOURCE_EXTENSIONS.some(extension => relative.endsWith(extension))) {
          return relative;
        }
      }
    } catch {
      // Directories and unreadable candidates are simply not source modules.
    }
  }
  return null;
}

/**
 * Walk every module statically reachable from an entry. The returned parent
 * map records the first (therefore shortest breadth-first) path to each file.
 * Bare imports are retained separately with all reachable importers so reports
 * can explain why a package is still part of the eager graph.
 */
export function walkStaticImportGraph({ repoRoot, entry, aliases = [] }) {
  const parents = new Map();
  const bareImporters = new Map();
  const queue = [[entry, null]];

  while (queue.length > 0) {
    const [file, importer] = queue.shift();
    if (parents.has(file)) continue;
    parents.set(file, importer);

    let source;
    try {
      source = readFileSync(path.join(repoRoot, file), 'utf8');
    } catch {
      continue;
    }

    for (const specifier of staticSpecifiers(source)) {
      const resolved = resolveSourceImport(repoRoot, file, specifier, aliases);
      if (resolved) {
        if (!parents.has(resolved)) queue.push([resolved, file]);
        continue;
      }
      if (specifier.startsWith('.')) continue;
      const importers = bareImporters.get(specifier) ?? [];
      importers.push(file);
      bareImporters.set(specifier, importers);
    }
  }

  return { parents, bareImporters };
}

export function importChain(parents, target) {
  const chain = [];
  let current = target;
  while (current) {
    chain.unshift(current);
    current = parents.get(current) ?? null;
  }
  return chain;
}
