/**
 * Keeps the runner graph — and esbuild-wasm behind it — out of the editor chunk.
 *
 * `CodeEditor` warms the TypeScript runner on idle so the first TS run does not
 * pay for importing and initialising esbuild-wasm. It reaches the runner
 * manager through a DYNAMIC import, and that detail is load-bearing.
 *
 * The usual instinct is to guard this with `monacoInitialGraph.test.ts`, but
 * that guard would never fire: `CodeEditor` is itself behind a lazy boundary,
 * so nothing it imports lands on the boot path either way. The real hazard is
 * one level down — a static edge would bundle the whole runner graph into the
 * editor chunk, which every session loads as soon as the editor mounts. People
 * who never open a TypeScript buffer would download esbuild-wasm anyway.
 *
 * So this walks the static graph from `CodeEditor` itself and proves the
 * runner graph stays on the far side of the `import()`.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRendererViteAliases, createWebViteAliases } from '../../build/viteAliases.mts';
import { importChain, walkStaticImportGraph } from '../../scripts/lib/staticImportGraph.mjs';

const repoRoot = path.resolve(__dirname, '../..');

const CODE_EDITOR = 'src/renderer/components/Editor/CodeEditor.tsx';

/**
 * Modules the editor chunk must reach only through `import()`, with the cost
 * each one carries if that boundary is lost.
 */
const MUST_STAY_BEHIND_A_DYNAMIC_IMPORT: Array<{ module: string; why: string }> = [
  {
    module: 'src/renderer/runners/manager.ts',
    why: 'the entire runner graph: every language runner, their workers and transforms',
  },
  {
    module: 'src/renderer/runners/esbuildLoader.ts',
    why: 'esbuild-wasm, which dwarfs the editor chunk and is useless to a session that never runs TypeScript',
  },
];

function normalizeAliases(aliases: Record<string, string>): Array<[string, string]> {
  return Object.entries(aliases).map(([find, replacement]) => [
    find,
    path.relative(repoRoot, replacement).split(path.sep).join('/'),
  ]);
}

const SURFACE_ALIASES: Record<string, Array<[string, string]>> = {
  web: normalizeAliases(createWebViteAliases(repoRoot)),
  renderer: normalizeAliases(createRendererViteAliases(repoRoot)),
};

describe('the editor chunk', () => {
  for (const [surface, aliases] of Object.entries(SURFACE_ALIASES)) {
    it(`does not statically reach the runner graph (${surface})`, () => {
      const { parents } = walkStaticImportGraph({ repoRoot, entry: CODE_EDITOR, aliases });

      const reached = MUST_STAY_BEHIND_A_DYNAMIC_IMPORT.filter(target =>
        parents.has(target.module)
      );
      const detail = reached
        .map(
          target =>
            `${target.module} — ${target.why}\n  ${importChain(parents, target.module).join('\n  -> ')}`
        )
        .join('\n\n');

      expect(
        reached.map(target => target.module),
        reached.length === 0
          ? ''
          : `${CODE_EDITOR} statically reaches modules that belong behind an import():\n\n${detail}`
      ).toEqual([]);
    });
  }

  it('still warms the TypeScript runner, rather than having dropped the call', () => {
    // The guard above is satisfied trivially if the warm is deleted. Pin the
    // dynamic import so removing it is a deliberate edit, not a silent one.
    const source = readCodeEditor();

    expect(source).toContain("import('../../runners/manager')");
    expect(source).toContain("prepareRunner('typescript')");
  });
});

function readCodeEditor(): string {
  return readFileSync(path.join(repoRoot, CODE_EDITOR), 'utf8');
}
