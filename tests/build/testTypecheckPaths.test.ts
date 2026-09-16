/**
 * `tsconfig.test.json` declares its own `compilerOptions.paths`, which replaces
 * the root mapping instead of extending it. Without this guard a root alias
 * added or retargeted in `tsconfig.json` would surface only as TS2307 inside
 * `src/**` under `typecheck:tests`, pointing at files the change never touched.
 * It also keeps the test-only `#src` mirror aligned with the vitest alias it
 * copies.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import vitestConfig from '../../vitest.config.mts';

const repoRoot = path.resolve(__dirname, '../..');

type PathMap = Record<string, string[]>;

/** Both configs hold only full-line `//` comments, which JSON cannot parse. */
function readPaths(file: string): PathMap {
  const text = readFileSync(path.join(repoRoot, file), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const config = JSON.parse(text) as { compilerOptions?: { paths?: PathMap } };
  return config.compilerOptions?.paths ?? {};
}

describe('test type-check path aliases', () => {
  const rootPaths = readPaths('tsconfig.json');
  const testPaths = readPaths('tsconfig.test.json');

  it('repeats every root alias with the same targets', () => {
    expect(Object.keys(rootPaths).length).toBeGreaterThan(0);
    for (const [alias, targets] of Object.entries(rootPaths)) {
      expect(testPaths[alias], `tsconfig.test.json does not repeat root alias ${alias}`).toEqual(
        targets
      );
    }
  });

  it('maps every vitest alias to the directory vitest resolves', () => {
    const aliases = vitestConfig.resolve?.alias as Record<string, string>;
    expect(Object.keys(aliases).length).toBeGreaterThan(0);
    for (const [alias, directory] of Object.entries(aliases)) {
      const target = testPaths[`${alias}/*`]?.[0];
      expect(target, `tsconfig.test.json has no ${alias}/* for the vitest alias`).toBeDefined();
      expect(
        path.resolve(repoRoot, target!.replace(/\/\*$/, '')),
        `${alias}/* in tsconfig.test.json points somewhere other than the vitest alias`
      ).toBe(directory);
    }
  });
});
