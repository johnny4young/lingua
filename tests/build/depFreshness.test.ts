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
 * justification to the implementation notes whenever an entry is added).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
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
const WEBSITE_PACKAGE_JSON_PATH = resolve(ROOT, 'website/package.json');
const WEBSITE_PACKAGE_LOCK_PATH = resolve(ROOT, 'website/package-lock.json');

// Documented hold-backs: package -> reason. When you add an entry,
// also append a bullet to the implementation notes under the matching maintenance
// entry so the next sweep reviewer sees the why.
const HELD_BACK: Record<string, string> = {
  // No current hold-backs. (The former @electron/fuses pin was removed with the
  // Electron Forge maker/fuses toolchain when desktop moved to electron-builder,
  // which manages fuses via electron-builder.yml electronFuses.)
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

function assertYauzlLockfile(lockfile: string): void {
  const lock = load(lockfile) as Record<'packages' | 'snapshots', Record<string, unknown>>;
  for (const section of ['packages', 'snapshots'] as const) {
    const entries = Object.keys(lock[section]).filter(key => key.startsWith('yauzl@'));
    expect(entries.length, `Missing yauzl ${section}`).toBeGreaterThan(0);
    for (const entry of entries) {
      // Accept patches >= 3.3.1, but reject old, prerelease, or new minor lines.
      expect(entry).toMatch(/^yauzl@3\.3\.[1-9]\d*$/u);
    }
  }
}

describe('dependency override hygiene', () => {
  it('does not decode nested host escapes into a live destination in packaging tooling', () => {
    const rootRequire = createRequire(PACKAGE_JSON_PATH);
    const builderRequire = createRequire(rootRequire.resolve('app-builder-lib/package.json'));
    const ajvRequire = createRequire(builderRequire.resolve('ajv/package.json'));
    const uri = ajvRequire('fast-uri') as { normalize: (value: string) => string };
    const encoded = 'http://%256c%256f%2563%2561%256c%2568%256f%2573%2574/';
    expect(uri.normalize(encoded)).not.toBe('http://localhost/');
    expect(uri.normalize('https://example.com/path')).toBe('https://example.com/path');
  });

  it('keeps shared npm overrides aligned with pnpm and direct dependency specs', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8')) as PackageJson;
    const direct = { ...pkg.devDependencies, ...pkg.dependencies };
    const workspace = load(readFileSync(PNPM_WORKSPACE_PATH, 'utf-8')) as {
      overrides: Record<string, string>;
    };
    for (const [name, spec] of Object.entries(pkg.overrides ?? {})) {
      expect(typeof spec, name).toBe('string');
      const resolved = String(spec).startsWith('$') ? direct[String(spec).slice(1)] : spec;
      const selector = name === 'dompurify' ? 'monaco-editor>dompurify' : name;
      expect(resolved, name).toBe(workspace.overrides[selector]);
      if (direct[name]) expect(resolved, `npm direct override: ${name}`).toBe(direct[name]);
    }
  });

  it('lets npm load the declared undici override without EOVERRIDE', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8')) as PackageJson;
    const lock = load(readFileSync(PNPM_LOCK_PATH, 'utf-8')) as {
      importers: Record<string, { devDependencies: Record<string, { version: string }> }>;
    };
    const cwd = mkdtempSync(resolve(tmpdir(), 'lingua-npm-override-'));
    try {
      // A minimal installed tree exercises npm's real override resolver offline.
      // No registry access, lifecycle scripts, or global npm configuration writes.
      writeFileSync(
        resolve(cwd, 'package.json'),
        JSON.stringify({
          name: 'override-probe',
          version: '1.0.0',
          private: true,
          devDependencies: { undici: pkg.devDependencies?.undici },
          overrides: { undici: pkg.overrides?.undici },
        })
      );
      mkdirSync(resolve(cwd, 'node_modules/undici'), { recursive: true });
      writeFileSync(
        resolve(cwd, 'node_modules/undici/package.json'),
        JSON.stringify({
          name: 'undici',
          version: lock.importers['.']!.devDependencies.undici!.version,
        })
      );
      const output = execFileSync(
        process.platform === 'win32' ? 'npm.cmd' : 'npm',
        ['ls', '--depth=0', '--json', '--offline'],
        {
          cwd,
          env: { ...process.env, npm_config_cache: resolve(cwd, '.npm-cache') },
          encoding: 'utf-8',
          timeout: 15_000,
          shell: process.platform === 'win32',
        }
      );
      expect(JSON.parse(output).dependencies.undici.version).toBe(
        lock.importers['.']!.devDependencies.undici!.version
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 20_000);

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
    // Tilde range: patches flow, the minor stays put (the ZIP reader sits on
    // the packaging path and a minor bump needs make:desktop validation).
    expect(workspace).toMatch(/["']?yauzl["']?:\s*["']~3\.3\./u);

    // Do not read node_modules here: pnpm can leave local trees stale until a
    // full relink, while CI installs from the lockfile. The lock is the
    // release-build source of truth for this transitive override.
    const lockfile = readFileSync(PNPM_LOCK_PATH, 'utf-8');
    assertYauzlLockfile(lockfile);
  });

  it.each(['3.3.1', '3.3.2', '3.3.12'])('permits a yauzl patch refresh to %s', version => {
    assertYauzlLockfile(`packages:\n  yauzl@${version}: {}\nsnapshots:\n  yauzl@${version}: {}`);
  });

  it.each(['2.10.0', '3.3.0', '3.4.0', '4.0.0', '3.3.2-beta.1'])(
    'rejects a yauzl resolution outside the reviewed patch line: %s',
    version => {
      // Even a valid entry must not mask an additional disallowed resolution.
      expect(() =>
        assertYauzlLockfile(
          `packages:\n  yauzl@3.3.1: {}\n  yauzl@${version}: {}\nsnapshots:\n  yauzl@3.3.1: {}`
        )
      ).toThrow();
    }
  );

  it('keeps Astro icon tooling off vulnerable extract-zip', () => {
    const websitePackage = JSON.parse(
      readFileSync(WEBSITE_PACKAGE_JSON_PATH, 'utf-8')
    ) as PackageJson;
    expect(websitePackage.overrides?.['@iconify/tools']).toBe('^5.0.12');

    // astro-icon 1.x still declares @iconify/tools 4.x. The 5.x override is
    // load-bearing because 4.2.0 pulls extract-zip 2.0.1, which has no patched
    // release for GHSA-jmr9-qjv8-65gv. Keep the standalone npm lock aligned.
    const websiteLock = readFileSync(WEBSITE_PACKAGE_LOCK_PATH, 'utf-8');
    expect(websiteLock).toContain('node_modules/@iconify/tools');
    expect(websiteLock).toContain('tools-5.0.12.tgz');
    expect(websiteLock).not.toContain('node_modules/extract-zip');
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
