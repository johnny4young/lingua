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
 * Web builds also read `sourceUrl`: `vite.web.config.mts` injects it
 * into the shared Python worker as the CDN index URL, and `public/sw.js`
 * cache-firsts the same prefix so Python is offline-tolerant after the
 * first successful web load.
 */

export type RuntimeAssetId = 'pyodide' | 'ruby';

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
  /**
   * Superset of `criticalFiles`. The build-time copy plugin iterates
   * this list; entries missing from `node_modules` warn but do not
   * fail the build (use `criticalFiles` for boot-blocking assets).
   * Defaults to `criticalFiles` when omitted.
   */
  readonly copyFiles?: readonly string[];
  /**
   * Directory holding the upstream `package.json` for version checks.
   * Defaults to `nodeModulesPath` when omitted. Ruby keeps its WASM
   * payload in `node_modules/@ruby/3.4-wasm-wasi/dist/` but the
   * `package.json` lives one level up at the package root, so the
   * runtimeAssets integrity check needs an explicit pointer.
   */
  readonly packageDir?: string;
};

export const RUNTIME_ASSETS: { readonly [K in RuntimeAssetId]: RuntimeAssetEntry } = {
  pyodide: {
    version: '0.29.4',
    sourceUrl: 'https://cdn.jsdelivr.net/pyodide/v0.29.4/full/',
    nodeModulesPath: 'node_modules/pyodide',
    servedPath: 'pyodide',
    criticalFiles: [
      'pyodide.mjs',
      'pyodide.asm.js',
      'pyodide.asm.wasm',
      'pyodide-lock.json',
      'python_stdlib.zip',
    ],
    copyFiles: [
      'pyodide.mjs',
      'pyodide.js',
      'pyodide.asm.js',
      'pyodide.asm.wasm',
      'pyodide-lock.json',
      'python_stdlib.zip',
      'ffi.d.ts',
      'pyodide.d.ts',
      'package.json',
    ],
  },
  // RL-042 Slice 5 — Ruby web runtime via `@ruby/wasm-wasi`. The
  // bytecode lives in the version-specific `@ruby/3.4-wasm-wasi`
  // package; the renderer worker resolves the URL via
  // `new URL('../ruby/ruby+stdlib.wasm', import.meta.url)`, which the
  // build plugin serves from `node_modules/@ruby/3.4-wasm-wasi/dist`
  // (dev) or copies into `<outDir>/ruby/` (production).
  ruby: {
    version: '2.9.3-2.9.4',
    sourceUrl:
      'https://cdn.jsdelivr.net/npm/@ruby/3.4-wasm-wasi@2.9.3-2.9.4/dist/ruby+stdlib.wasm',
    nodeModulesPath: 'node_modules/@ruby/3.4-wasm-wasi/dist',
    packageDir: 'node_modules/@ruby/3.4-wasm-wasi',
    servedPath: 'ruby',
    criticalFiles: ['ruby+stdlib.wasm'],
  },
} as const;

/**
 * @deprecated Use `RUNTIME_ASSETS.pyodide.copyFiles` instead. Kept as
 * a re-export for any external script that still imports the symbol;
 * the plugin reads from the asset entry directly.
 */
export const PYODIDE_COPY_FILES: readonly string[] =
  RUNTIME_ASSETS.pyodide.copyFiles ?? RUNTIME_ASSETS.pyodide.criticalFiles;
