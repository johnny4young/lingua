/**
 * Dep-modernization-sweep guard — fails CI if any direct devDep is
 * more than ONE major behind the latest published version on npm.
 * Catches the "outdated pile-up" that prompted the 2026-05-17 sweep.
 *
 * Gated behind LINGUA_CHECK_FRESHNESS=1 because:
 *   - npm view is a network call (flake-prone in CI on cold runners)
 *   - the guard is intended for periodic maintenance checks, not
 *     every PR. Run via:
 *       LINGUA_CHECK_FRESHNESS=1 pnpm test -- --run tests/build/depFreshness.test.ts
 *
 * Hold-back exemptions live in HELD_BACK below — packages with a
 * documented reason to stay on a previous major (cross-link the
 * justification to docs/PLAN.md whenever an entry is added).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackageJson {
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
  overrides?: Record<string, unknown>;
}

const ROOT = resolve(__dirname, '../..');
const PACKAGE_JSON_PATH = resolve(ROOT, 'package.json');
const PNPM_LOCK_PATH = resolve(ROOT, 'pnpm-lock.yaml');
const PNPM_WORKSPACE_PATH = resolve(ROOT, 'pnpm-workspace.yaml');

// Documented hold-backs: package -> reason. When you add an entry,
// also append a bullet to docs/PLAN.md under the matching maintenance
// entry so the next sweep reviewer sees the why.
const HELD_BACK: Record<string, string> = {
  '@electron/fuses':
    'Held at v1 because @electron-forge/plugin-fuses@7.11.1 peer-requires ^1.0.0. ' +
    'Unlocks when Forge ships a Vite-8-aware release (also unblocks RL-033 follow-up).',
};

function caretMajor(spec: string | undefined): number | null {
  if (!spec) return null;
  // Strip leading caret/tilde/range modifiers, take the major.
  const match = spec.match(/(\d+)\./);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

function latestMajor(pkg: string): number | null {
  try {
    const out = execFileSync('npm', ['view', pkg, 'version'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return caretMajor(out);
  } catch {
    // Network blip → don't fail the test; just skip the pin.
    return null;
  }
}

describe('dependency override hygiene', () => {
  it('dedupes Monaco to the patched root DOMPurify install', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8')) as PackageJson;

    // npm-style override kept for npm-compat + to document the intent.
    expect(pkg.overrides?.dompurify).toBe('$dompurify');
    // pnpm ignores npm's top-level `overrides` field AND its `$name`
    // self-reference, so the dompurify patch is restated as an explicit
    // parent>child override in pnpm-workspace.yaml. Without it Monaco
    // resolves its declared (older) dompurify — a security regression.
    const workspace = readFileSync(PNPM_WORKSPACE_PATH, 'utf-8');
    expect(workspace).toMatch(/["']?monaco-editor>dompurify["']?:\s*["']\^3\.4/u);
    // The installed root dompurify is on the patched 3.4.x line.
    const rootDompurify = JSON.parse(
      readFileSync(resolve(ROOT, 'node_modules/dompurify/package.json'), 'utf-8')
    ) as { version?: string };
    expect(rootDompurify.version).toMatch(/^3\.(?:[4-9]|\d{2,})\./u);
    // Monaco still DECLARES the older 3.2.7 (proves the override is
    // load-bearing) …
    const monaco = JSON.parse(
      readFileSync(resolve(ROOT, 'node_modules/monaco-editor/package.json'), 'utf-8')
    ) as { dependencies?: Record<string, string> };
    expect(monaco.dependencies?.dompurify).toBe('3.2.7');
    // … but pnpm's override deduped it: no nested copy survives under
    // the hoisted node_modules tree.
    expect(
      existsSync(resolve(ROOT, 'node_modules/monaco-editor/node_modules/dompurify'))
    ).toBe(false);
  });

  it('keeps Electron ZIP extraction on the Node 24-compatible yauzl line', () => {
    const workspace = readFileSync(PNPM_WORKSPACE_PATH, 'utf-8');
    expect(workspace).toMatch(/["']?yauzl["']?:\s*["']3\.3\./u);

    // Do not read node_modules here: pnpm can leave local trees stale until a
    // full relink, while CI installs from the lockfile. The lock is the
    // release-build source of truth for this transitive override.
    const lockfile = readFileSync(PNPM_LOCK_PATH, 'utf-8');
    expect(lockfile).toMatch(/^\s+yauzl@3\.3\.1:/mu);
    expect(lockfile).not.toMatch(/^\s+yauzl@2\./mu);
  });
});

describe.skipIf(process.env.LINGUA_CHECK_FRESHNESS !== '1')(
  'dep freshness (LINGUA_CHECK_FRESHNESS=1)',
  () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8')) as PackageJson;
    const direct = { ...(pkg.devDependencies ?? {}), ...(pkg.dependencies ?? {}) };

    it(
      'keeps every direct dep at most one major behind latest',
      { timeout: 120_000 },
      () => {
        const stale: string[] = [];

        for (const [name, spec] of Object.entries(direct)) {
          if (HELD_BACK[name]) continue;
          const current = caretMajor(spec);
          const latest = latestMajor(name);
          if (current === null || latest === null) continue;
          if (latest - current > 1) {
            stale.push(`${name}: ^${current}.x (latest ^${latest}.x)`);
          }
        }

        expect(
          stale,
          `Stale direct deps (>1 major behind):\n  ${stale.join('\n  ')}`
        ).toEqual([]);
      }
    );

    it('every held-back package has a documented reason', () => {
      for (const [name, reason] of Object.entries(HELD_BACK)) {
        expect(reason.length, `${name} hold-back reason is too short`).toBeGreaterThan(40);
      }
    });
  }
);
