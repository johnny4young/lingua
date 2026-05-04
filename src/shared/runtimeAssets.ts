/**
 * Runtime-asset registry — RL-083 Slice 1.
 *
 * Single source of truth for any runtime asset that ships outside the
 * normal JS / CSS bundles. Consumed by:
 *
 *   - `src/renderer/workers/python-worker.ts` — to resolve the local
 *     Pyodide directory under packaged + dev modes.
 *   - `scripts/build-runtime-asset-manifest.mjs` — to compute and
 *     enforce the `runtime-assets.lock.json` integrity snapshot.
 *   - `tests/shared/runtimeAssets.test.ts` — to assert the lock matches
 *     the freshly-installed `node_modules/pyodide/` files.
 *
 * The integrity hash is recorded only in the lock file (committed to
 * git). This module names the files we care about and the version we
 * pin against.
 *
 * Web-build behavior is intentionally unchanged at this slice. Slice 2
 * (web first-party hosting decision) will widen this surface; until
 * then, web consumers continue to load from the CDN.
 */

export type RuntimeAssetId = 'pyodide';

export type RuntimeAssetEntry = {
  /** Semver string. Must match the dependency pin in package.json. */
  readonly version: string;
  /** Upstream source URL where the same files can be fetched. */
  readonly sourceUrl: string;
  /** Path under `node_modules/...` where the files are read at build/check time. */
  readonly nodeModulesPath: string;
  /** Path under the renderer build output (and dev server) where copies are served. */
  readonly servedPath: string;
  /**
   * Files that MUST exist for the runtime to boot. Integrity is asserted
   * over this exact list — anything not in here is best-effort.
   */
  readonly criticalFiles: readonly string[];
};

export const RUNTIME_ASSETS: { readonly [K in RuntimeAssetId]: RuntimeAssetEntry } = {
  pyodide: {
    version: '0.26.4',
    sourceUrl: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/',
    nodeModulesPath: 'node_modules/pyodide',
    servedPath: 'pyodide',
    criticalFiles: [
      'pyodide.mjs',
      'pyodide.asm.js',
      'pyodide.asm.wasm',
      'pyodide-lock.json',
      'python_stdlib.zip',
    ],
  },
} as const;

/** Files copied into the renderer build output (superset of criticalFiles). */
export const PYODIDE_COPY_FILES: readonly string[] = [
  'pyodide.mjs',
  'pyodide.js',
  'pyodide.asm.js',
  'pyodide.asm.wasm',
  'pyodide-lock.json',
  'python_stdlib.zip',
  'ffi.d.ts',
  'pyodide.d.ts',
  'package.json',
] as const;
