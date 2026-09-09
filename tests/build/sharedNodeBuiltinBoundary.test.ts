/**
 * Keeps Node-flavoured shared modules out of the browser bundles.
 *
 * `src/shared/**` is the layer the renderer, the Electron main process and the
 * CLI all import from, and `eslint.config.mjs` freezes it against Electron,
 * React and Zustand. It does NOT forbid Node builtins, and it cannot: a module
 * like the Python interpreter policy is shared precisely between the CLI and
 * main, and needs `node:path` to build platform-correct interpreter paths.
 *
 * The invariant that actually matters is narrower than "no builtins in
 * shared": such a module must never become reachable from a browser entry,
 * where `node:path` has no implementation and the build breaks — or worse,
 * gets shimmed and silently ships dead weight.
 *
 * Until now that was a convention nothing enforced, held up only by the fact
 * that no shared module imported a builtin at all. This turns it into a gate:
 * discover the Node-flavoured shared modules, then prove no browser entry can
 * statically reach any of them.
 *
 * "Browser entry" includes the WORKER bundles, not just the two app entries.
 * `walkStaticImportGraph` follows static `import` specifiers, and a worker is
 * reached through `new Worker(new URL('../workers/x-worker.ts', import.meta.url))`
 * — an edge the walk does not cross. A shared module imported only by a worker
 * would therefore pass a two-entry version of this guard while still being
 * bundled for the browser. The worker entries are DISCOVERED from that call
 * shape rather than listed, so a new worker is covered the day it is added.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRendererViteAliases, createWebViteAliases } from '../../build/viteAliases.mts';
import {
  importChain,
  staticSpecifiers,
  walkStaticImportGraph,
} from '../../scripts/lib/staticImportGraph.mjs';

const repoRoot = path.resolve(__dirname, '../..');

/** The two app entries. Anything they statically reach ships to a browser. */
const APP_ENTRIES = {
  web: 'src/web/main.tsx',
  renderer: 'src/renderer/main.tsx',
} as const;

/** `new URL('<specifier>', import.meta.url)` — how Vite is told about a worker. */
const WORKER_URL = /new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/gu;

function normalizeAliases(aliases: Record<string, string>): Array<[string, string]> {
  return Object.entries(aliases).map(([find, replacement]) => [
    find,
    path.relative(repoRoot, replacement).split(path.sep).join('/'),
  ]);
}

const ENTRY_ALIASES: Record<keyof typeof APP_ENTRIES, Array<[string, string]>> = {
  web: normalizeAliases(createWebViteAliases(repoRoot)),
  renderer: normalizeAliases(createRendererViteAliases(repoRoot)),
};

function sourceFilesUnder(relativeRoot: string): string[] {
  const root = path.join(repoRoot, relativeRoot);
  const found: string[] = [];
  const visit = (absolute: string): void => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = path.join(absolute, entry.name);
      if (entry.isDirectory()) {
        visit(child);
        continue;
      }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
      found.push(path.relative(repoRoot, child).split(path.sep).join('/'));
    }
  };
  visit(root);
  return found.sort();
}

/**
 * Shared modules with a STATIC `node:` import. A dynamic `import('node:…')`
 * does not count: it terminates the static graph the bundler follows, which is
 * the same boundary every other build guard here uses.
 */
function nodeFlavouredSharedModules(): string[] {
  return sourceFilesUnder('src/shared').filter(file => {
    const source = readFileSync(path.join(repoRoot, file), 'utf8');
    return staticSpecifiers(source).some(specifier => specifier.startsWith('node:'));
  });
}

/**
 * Worker entry points, discovered from every `new URL(..., import.meta.url)`
 * whose specifier resolves to a first-party module. Vite turns exactly that
 * shape into a separate browser bundle.
 */
function workerEntries(): string[] {
  const found = new Set<string>();
  for (const file of sourceFilesUnder('src')) {
    const source = readFileSync(path.join(repoRoot, file), 'utf8');
    for (const match of source.matchAll(WORKER_URL)) {
      const specifier = match[1];
      if (!specifier?.startsWith('.')) continue;
      const resolved = path
        .relative(repoRoot, path.resolve(repoRoot, path.dirname(file), specifier))
        .split(path.sep)
        .join('/');
      if (existsSync(path.join(repoRoot, resolved))) found.add(resolved);
    }
  }
  return [...found].sort();
}

/** Every browser bundle root: the two app entries plus every worker entry. */
function browserEntries(): Array<{ label: string; entry: string; surface: keyof typeof APP_ENTRIES }> {
  const roots = Object.entries(APP_ENTRIES).map(([surface, entry]) => ({
    label: surface,
    entry,
    surface: surface as keyof typeof APP_ENTRIES,
  }));
  for (const worker of workerEntries()) {
    // A worker ships in both builds, so check it under both alias sets.
    for (const surface of Object.keys(APP_ENTRIES) as Array<keyof typeof APP_ENTRIES>) {
      roots.push({ label: `${worker} (${surface})`, entry: worker, surface });
    }
  }
  return roots;
}

describe('shared modules that import Node builtins', () => {
  it('still detects the module this guard was built for', () => {
    // The detector is a regex over static specifiers, so it can silently stop
    // matching. Naming the known Node-flavoured module means removing it, or
    // escaping detection, requires an explicit update here rather than
    // quietly turning every assertion below into a no-op over an empty list.
    expect(nodeFlavouredSharedModules()).toContain('src/shared/python/interpreter.ts');
  });

  it('discovers the worker entry points rather than trusting a hand-written list', () => {
    const workers = workerEntries();

    // Every discovered entry is a real first-party worker module.
    for (const worker of workers) {
      expect(worker.startsWith('src/')).toBe(true);
      expect(worker.endsWith('.ts')).toBe(true);
    }
    // The runners spawn one worker per language family plus the utility pool;
    // if this drops to zero the discovery regex has stopped matching and the
    // worker half of this guard is inert.
    expect(workers.length).toBeGreaterThanOrEqual(5);
  });

  for (const { label, entry, surface } of browserEntries()) {
    it(`stay unreachable from ${label}`, () => {
      const flavoured = nodeFlavouredSharedModules();
      const { parents } = walkStaticImportGraph({
        repoRoot,
        entry,
        aliases: ENTRY_ALIASES[surface],
      });

      const reachable = flavoured.filter(file => parents.has(file));
      const detail = reachable
        .map(file => `${file}\n  ${importChain(parents, file).join('\n  -> ')}`)
        .join('\n\n');

      expect(
        reachable,
        reachable.length === 0
          ? ''
          : `These shared modules import a Node builtin AND are statically reachable from ${entry}.\n` +
              'Either drop the builtin, or keep the module off the browser graph.\n\n' +
              detail
      ).toEqual([]);
    });
  }
});
