/**
 * Vite config for the standalone web build.
 *
 * Differences from the Electron renderer config:
 *  - Entry point is src/web/main.tsx (not src/renderer/main.tsx)
 *  - Output goes to dist/web/ (served as a static site / PWA)
 *  - No Electron externals — everything must be bundled or copied locally
 *  - Public base defaults to '/' and can be overridden for GitHub Pages
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySharedEnvDefaults, getSharedBuildDefines } from './build/appBuildMetadata.mts';
import { copyRuntimeAssetsPlugin } from './build/copyRuntimeAssetsPlugin.mts';

// Seed `VITE_LINGUA_APP_VERSION` from `package.json#version` BEFORE
// Vite reads `process.env` for env-substitution. Lets the telemetry
// consumer (`src/renderer/utils/telemetry.ts`) and the web update
// banner pick up the real app version without requiring an external
// `.env.production` to set it. RL-061 Slice 5.
applySharedEnvDefaults();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = process.env.VITE_BASE_PATH ?? '/';

function readPackageVersion(packageJsonPath: string): string {
  const pkg = JSON.parse(readFileSync(path.resolve(__dirname, packageJsonPath), 'utf-8')) as {
    version?: unknown;
  };
  if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
    throw new Error(`Missing version in ${packageJsonPath}`);
  }
  return pkg.version;
}

const webRuntimeBase = (
  process.env.VITE_LINGUA_WEB_RUNTIME_BASE ?? 'https://downloads.linguacode.dev/web-runtime'
).replace(/\/$/, '');
const duckdbWasmVersion = readPackageVersion('node_modules/@duckdb/duckdb-wasm/package.json');
const rubyWasmVersion = readPackageVersion('node_modules/@ruby/3.4-wasm-wasi/package.json');

/**
 * Build-time sha256 (hex) of a runtime WASM payload, computed from the SAME
 * `node_modules` file deploy-web.yml uploads to R2. pnpm verifies the package
 * tarball against the integrity pins in pnpm-lock.yaml at install time, so
 * this hash is a trusted expected value — the workers compare the bytes they
 * fetch from the R2 mirror against it before instantiation, closing the gap
 * where a tampered bucket object would have been executed unchecked.
 */
function sha256OfRuntimeAsset(relativePath: string): string {
  const bytes = readFileSync(path.resolve(__dirname, relativePath));
  return createHash('sha256').update(bytes).digest('hex');
}

export default defineConfig(({ command }) => {
  // LINGUA_WEB_RUNTIME_SAME_ORIGIN=1 keeps the oversized WASM runtimes
  // (DuckDB, Ruby) same-origin even in production-shaped builds. The
  // local Playwright e2e runner sets it so validation runs are hermetic:
  // the R2 mirror's bucket CORS policy allowlists only the production
  // app origin (deploy-web.yml validates exactly that), so a localhost
  // preview fetching the mirror gets a CORS block — which surfaced as
  // flaky console-error failures in the SQL workspace specs. Deploys
  // never set this var, and the deploy workflow's own CORS gate keeps
  // covering the external path. Config-load-time process.env read,
  // injected explicitly by scripts/run-playwright-web-validation.mjs —
  // not a repo-root .env consumer, so the three-config envDir landmine
  // does not apply.
  const useExternalWebRuntime =
    command === 'build' && process.env.LINGUA_WEB_RUNTIME_SAME_ORIGIN !== '1';
  const duckdbWasmUrl = `${webRuntimeBase}/duckdb/${duckdbWasmVersion}/duckdb-mvp.wasm`;
  const rubyWasmUrl = `${webRuntimeBase}/ruby/${rubyWasmVersion}/ruby+stdlib.wasm`;
  const duckdbWasmSha256 = useExternalWebRuntime
    ? sha256OfRuntimeAsset('node_modules/@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm')
    : null;
  const rubyWasmSha256 = useExternalWebRuntime
    ? sha256OfRuntimeAsset('node_modules/@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm')
    : null;

  return {
    base,
    plugins: [react(), copyRuntimeAssetsPlugin({ exclude: useExternalWebRuntime ? ['ruby'] : [] })],
    define: {
      ...getSharedBuildDefines(),
      // The web build self-hosts Pyodide under dist/web/pyodide via the
      // same runtime-asset copier as Electron, so the worker's
      // `new URL('../pyodide/...')` path is the authority.
      __LINGUA_PYODIDE_INDEX_URL__: JSON.stringify(null),
      // Cloudflare Pages rejects single files above 25 MiB. Ruby's
      // stdlib WASM and DuckDB's MVP WASM are uploaded to the public R2
      // runtime prefix by deploy-web.yml, while local dev keeps using
      // the same-origin Vite middleware/assets.
      __LINGUA_DUCKDB_MVP_WASM_URL__: JSON.stringify(useExternalWebRuntime ? duckdbWasmUrl : null),
      __LINGUA_RUBY_WASM_URL__: JSON.stringify(useExternalWebRuntime ? rubyWasmUrl : null),
      // Expected sha256 of the R2-mirrored payloads (null when serving
      // same-origin assets, which skip runtime verification — they are
      // covered by runtime-assets.lock.json / pnpm-lock integrity).
      __LINGUA_DUCKDB_MVP_WASM_SHA256__: JSON.stringify(duckdbWasmSha256),
      __LINGUA_RUBY_WASM_SHA256__: JSON.stringify(rubyWasmSha256),
    },
    root: path.resolve(__dirname, 'src/web'),
    // Repo-root `.env` / `.env.production` are the canonical source for
    // VITE_* values across all build configs (renderer, web, main). With
    // `root` set to `src/web/`, Vite's default `envDir` would point there
    // and miss the repo-root files entirely — silently leaving every
    // `import.meta.env.VITE_*` substitution as `undefined`. RL-061 Slice
    // 2.5 noticed this when VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK and
    // VITE_LINGUA_LICENSE_SERVER_URL did not land in `dist/web/assets/*`.
    envDir: __dirname,
    publicDir: path.resolve(__dirname, 'public'),
    resolve: {
      alias: {
        '@/plugins/catalog': path.resolve(__dirname, './src/web/plugin-catalog.ts'),
        '@': path.resolve(__dirname, './src/renderer'),
      },
      dedupe: ['react', 'react-dom', 'i18next', 'react-i18next'],
    },
    optimizeDeps: {
      // React must be pre-bundled in a SINGLE optimize pass. List every
      // entrypoint the app + its deps reach — not just `react`/`react-dom`.
      // `react-dom/client` (the root render call in src/web/main.tsx) and
      // the JSX runtimes are otherwise discovered late during the dep
      // crawl, behind the lazy Monaco/CodeEditor boundary. That late
      // discovery triggers a second optimize pass with a fresh browser
      // hash, so the page ends up loading `react.js?v=A` and
      // `react-dom_client.js?v=B` — two React instances. The moment a
      // component calls a hook the dispatcher is null and React throws
      // "Invalid hook call … more than one copy of React". Pre-including
      // all entrypoints collapses everything into one pass / one hash.
      // Dev-server-only: `build:web` bundles a single React and is
      // unaffected (verified on the prod preview).
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-i18next',
        'i18next',
      ],
    },
    build: {
      outDir: path.resolve(__dirname, 'dist/web'),
      emptyOutDir: true,
      // Monaco ships large language workers even after the editor itself is
      // split behind a lazy boundary, so keep the warning threshold aligned
      // with the intentional web runtime shape.
      chunkSizeWarningLimit: 8000,
      rollupOptions: {
        output: {
          manualChunks: id => {
            if (id.includes('monaco-editor') || id.includes('@monaco-editor')) {
              return 'monaco';
            }
            if (id.includes('esbuild-wasm')) {
              return 'esbuild-wasm';
            }
            if (id.includes('react-dom') || id.includes('react/')) {
              return 'react';
            }
            if (id.includes('zustand')) {
              return 'zustand';
            }
            if (id.includes('lucide-react')) {
              return 'lucide';
            }
            // RL-044 Slice 2b-β-α — vega-embed chart renderer ships in its
            // own chunk so the charting bundle stays out of the
            // main entry. The chunk only loads when <RichValueChart>
            // mounts (first chart payload), mirroring the Pyodide
            // lazy-load pattern.
            if (
              id.includes('vega-embed') ||
              id.includes('vega-lite') ||
              id.includes('node_modules/vega/')
            ) {
              return 'vega-embed';
            }
            // RL-097 Slice 2 — DuckDB-WASM SQL engine ships in its own
            // chunk so the ~7 MiB WASM bundle never touches the main
            // entry. The chunk loads only when the SQL workspace tab is
            // opened for the first time, mirroring the vega-embed +
            // Pyodide lazy-load patterns. Apache Arrow rides along
            // (DuckDB depends on it for the result format).
            if (id.includes('@duckdb/duckdb-wasm') || id.includes('apache-arrow')) {
              return 'duckdb-wasm';
            }
            if (id.includes('/workers/')) {
              return 'workers';
            }
          },
        },
      },
    },
    server: {
      headers: {
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin',
      },
      watch: {
        ignored: [
          '**/.playwright-cli/**',
          '**/Library/**',
          '**/dist/**',
          '**/out/**',
          '**/output/**',
        ],
      },
    },
  };
});
