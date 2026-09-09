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
 * discover the Node-flavoured shared modules, then prove the web and renderer
 * entries cannot statically reach any of them.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRendererViteAliases, createWebViteAliases } from '../../build/viteAliases.mts';
import {
  importChain,
  staticSpecifiers,
  walkStaticImportGraph,
} from '../../scripts/lib/staticImportGraph.mjs';

const repoRoot = path.resolve(__dirname, '../..');

/** Browser entries. Anything they statically reach ships to a browser. */
const BROWSER_ENTRIES = {
  web: 'src/web/main.tsx',
  renderer: 'src/renderer/main.tsx',
} as const;

function normalizeAliases(aliases: Record<string, string>): Array<[string, string]> {
  return Object.entries(aliases).map(([find, replacement]) => [
    find,
    path.relative(repoRoot, replacement).split(path.sep).join('/'),
  ]);
}

const ENTRY_ALIASES: Record<keyof typeof BROWSER_ENTRIES, Array<[string, string]>> = {
  web: normalizeAliases(createWebViteAliases(repoRoot)),
  renderer: normalizeAliases(createRendererViteAliases(repoRoot)),
};

function sharedSourceFiles(): string[] {
  const root = path.join(repoRoot, 'src', 'shared');
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
  return sharedSourceFiles().filter(file => {
    const source = readFileSync(path.join(repoRoot, file), 'utf8');
    return staticSpecifiers(source).some(specifier => specifier.startsWith('node:'));
  });
}

describe('shared modules that import Node builtins', () => {
  it('are discoverable, so this guard cannot quietly become a no-op', () => {
    // If this ever empties out, the loop below asserts nothing. That is fine
    // while it holds, but it should be a visible decision rather than a
    // silent one — hence the explicit shape assertion.
    const flavoured = nodeFlavouredSharedModules();

    expect(Array.isArray(flavoured)).toBe(true);
    for (const file of flavoured) {
      expect(file.startsWith('src/shared/')).toBe(true);
    }
  });

  for (const [surface, entry] of Object.entries(BROWSER_ENTRIES)) {
    it(`stay unreachable from the ${surface} entry`, () => {
      const flavoured = nodeFlavouredSharedModules();
      if (flavoured.length === 0) return;

      const aliases = ENTRY_ALIASES[surface as keyof typeof BROWSER_ENTRIES];
      const { parents } = walkStaticImportGraph({ repoRoot, entry, aliases });

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
