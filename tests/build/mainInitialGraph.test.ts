/**
 * Keeps what main does not need at launch out of `main.js`.
 *
 * Main is one CommonJS bundle evaluated before `app.ready`. Static imports put
 * the renderer's i18n catalogs (for a few native dialogs), undici and ws (for
 * HTTP requests), the MCP SDK and zod (for a server few sessions start), acorn
 * (for one Node run heuristic) and electron-updater (first used ten seconds
 * after launch) on that path. Each now loads with its first use; this walks
 * the static graph from the entry and fails with the import chain when one of
 * them comes back.
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { importChain, walkStaticImportGraph } from '../../scripts/lib/staticImportGraph.mjs';

const repoRoot = path.resolve(__dirname, '../..');
const ENTRY = 'src/main/index.ts';

const MUST_STAY_LAZY_MODULES: Array<{ module: string; why: string }> = [
  { module: 'src/shared/i18n/runtime.ts', why: 'the es and en catalogs, a quarter of main.js' },
  { module: 'src/main/httpProxy.ts', why: 'undici' },
  { module: 'src/main/httpWebSocket.ts', why: 'ws' },
  { module: 'src/main/localMcp.ts', why: 'the MCP SDK and zod' },
  { module: 'src/shared/nodeSourceMode.ts', why: 'acorn' },
];

const MUST_STAY_LAZY_PACKAGES = [
  'i18next',
  'undici',
  'ws',
  'zod',
  'acorn',
  'electron-updater',
  '@modelcontextprotocol/server',
  '@modelcontextprotocol/node',
];

describe('main initial graph', () => {
  const { parents, bareImporters } = walkStaticImportGraph({ repoRoot, entry: ENTRY });

  it('reaches the entry and a realistic number of modules', () => {
    expect(parents.has(ENTRY)).toBe(true);
    expect(parents.size).toBeGreaterThan(50);
  });

  it.each(MUST_STAY_LAZY_MODULES)('loads $module ($why) on first use', ({ module }) => {
    expect(parents.has(module), importChain(parents, module).join(' > ')).toBe(false);
  });

  it.each(MUST_STAY_LAZY_PACKAGES)('does not import %s statically', packageName => {
    const importers = [...bareImporters.entries()]
      .filter(([specifier]) => specifier === packageName || specifier.startsWith(`${packageName}/`))
      .flatMap(([, files]) => files.map(file => importChain(parents, file).join(' > ')));
    expect(importers).toEqual([]);
  });
});
