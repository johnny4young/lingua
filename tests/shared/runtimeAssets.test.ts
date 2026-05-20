import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RUNTIME_ASSETS } from '#src/shared/runtimeAssets';

/**
 * RL-083 Slice 1 — integrity gate for vendored runtime assets.
 *
 * The committed `runtime-assets.lock.json` is the authoritative
 * fingerprint of the Pyodide files we ship inside the desktop app. If
 * `node_modules/pyodide/` changes (intentional upgrade or accidental
 * postinstall mutation) without a matching lock update, this test
 * fails — the same diff that bumps the package must also run
 * `npm run build:runtime-assets`.
 *
 * The script in `scripts/build-runtime-asset-manifest.mjs` does the
 * same work for CLI / CI use; this test is a Vitest mirror so failures
 * surface alongside the rest of the test suite.
 */

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..', '..');
const lockPath = path.join(repoRoot, 'runtime-assets.lock.json');
const packageJsonPath = path.join(repoRoot, 'package.json');
const rendererConfigPath = path.join(repoRoot, 'vite.renderer.config.mts');
const webConfigPath = path.join(repoRoot, 'vite.web.config.mts');
const serviceWorkerPath = path.join(repoRoot, 'public', 'sw.js');

async function sha256OfFile(absolutePath: string): Promise<string> {
  const buf = await readFile(absolutePath);
  return `sha256-${createHash('sha256').update(buf).digest('hex')}`;
}

type LockShape = Record<
  string,
  { version: string; sourceUrl: string; integrity: Record<string, string> }
>;

describe('RL-083 — runtime-assets.lock.json integrity', () => {
  it('lock matches the freshly-installed Pyodide payload', async () => {
    const lockRaw = await readFile(lockPath, 'utf8');
    const lock = JSON.parse(lockRaw) as LockShape;

    for (const [id, entry] of Object.entries(RUNTIME_ASSETS)) {
      const lockEntry = lock[id];
      expect(lockEntry, `lock missing entry for ${id}`).toBeDefined();
      expect(lockEntry.version).toBe(entry.version);
      expect(lockEntry.sourceUrl).toBe(entry.sourceUrl);

      const baseDir = path.join(repoRoot, entry.nodeModulesPath);
      const packageDir = path.join(
        repoRoot,
        entry.packageDir ?? entry.nodeModulesPath
      );
      const packageJson = JSON.parse(
        await readFile(path.join(packageDir, 'package.json'), 'utf8')
      ) as { version?: string };
      expect(entry.version, `${id} runtime registry version must match package.json`).toBe(
        packageJson.version
      );
      // Source URL must mention the package version, but the format
      // varies per CDN: Pyodide uses `/v0.29.4/`, jsdelivr's npm-mode
      // URL for Ruby uses `@2.9.3-2.9.4`. Either path counts as
      // version-pinned integrity.
      expect(
        entry.sourceUrl,
        `${id} runtime registry source URL must include the package version`
      ).toContain(packageJson.version);

      for (const file of entry.criticalFiles) {
        const expected = lockEntry.integrity[file];
        expect(expected, `lock missing integrity for ${id}/${file}`).toBeDefined();
        const actual = await sha256OfFile(path.join(baseDir, file));
        expect(actual, `${id}/${file} drifted from lock`).toBe(expected);
      }

      const lockedFiles = new Set(Object.keys(lockEntry.integrity));
      const expectedFiles = new Set(entry.criticalFiles);
      for (const file of lockedFiles) {
        expect(
          expectedFiles.has(file),
          `lock has stale integrity entry ${id}/${file}; either add to RUNTIME_ASSETS.criticalFiles or rebuild the lock`
        ).toBe(true);
      }
    }
  });

  it('keeps desktop and web on copied local Pyodide assets', async () => {
    const rendererConfig = await readFile(rendererConfigPath, 'utf8');
    const webConfig = await readFile(webConfigPath, 'utf8');

    expect(rendererConfig).toContain('__LINGUA_PYODIDE_INDEX_URL__');
    expect(rendererConfig).toContain('JSON.stringify(null)');
    expect(webConfig).toContain('__LINGUA_PYODIDE_INDEX_URL__');
    expect(webConfig).toContain('JSON.stringify(null)');
    expect(webConfig).toContain('copyRuntimeAssetsPlugin()');
  });

  it('service worker no longer pins or caches the Pyodide CDN prefix', async () => {
    const sw = await readFile(serviceWorkerPath, 'utf8');
    expect(sw).not.toContain('PYODIDE_CACHE_PREFIX');
    expect(sw).not.toContain(RUNTIME_ASSETS.pyodide.sourceUrl);
  });

  it('keeps Ruby JS bindings paired with the version-specific WASM package', async () => {
    const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
      dependencies?: Record<string, string>;
    };

    expect(pkg.dependencies?.['@ruby/3.4-wasm-wasi']).toBe(
      RUNTIME_ASSETS.ruby.version
    );
    expect(pkg.dependencies?.['@ruby/wasm-wasi']).toBe(
      RUNTIME_ASSETS.ruby.version
    );
  });
});
