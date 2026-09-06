import { nodeTypingChunkPlugin } from './build/nodeTypingChunkPlugin.mts';
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
import { injectRuntimePreconnect } from './build/runtimePreconnect.mts';
import { createWebViteAliases } from './build/viteAliases.mts';

// Seed `VITE_LINGUA_APP_VERSION` from `package.json#version` BEFORE
// Vite reads `process.env` for env-substitution. Lets the telemetry
// consumer (`src/renderer/utils/telemetry.ts`) and the web update
// banner pick up the real app version without requiring an external
// `.env.production` to set it. implementation
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
    plugins: [
      nodeTypingChunkPlugin(),
      react(),
      copyRuntimeAssetsPlugin({ exclude: useExternalWebRuntime ? ['ruby'] : [] }),
      // Production points DuckDB/Ruby at the R2 mirror, an origin the
      // browser has not touched by the time the user opens SQL or runs
      // Ruby. Warm the connection from the static head. Same-origin builds
      // (dev, e2e) never fetch from it, so the hint is gated with the
      // runtime URLs themselves.
      ...(useExternalWebRuntime
        ? [
            {
              name: 'lingua-runtime-preconnect',
              transformIndexHtml(html: string): string {
                return injectRuntimePreconnect(html, webRuntimeBase);
              },
            },
          ]
        : []),
      // Dev-only: widen the web CSP's `connect-src` so a local OpenAI-compatible
      // AI server (Ollama on :11434, LM Studio on :1234, …) can be reached
      // directly from the dev browser for the "Explain this error" feature.
      // Gated on `command === 'serve'`, so it runs ONLY under `dev:web` /
      // `dev:web:pro` — a production `vite build` never sees it and the shipped
      // CSP stays `https:`-only. See docs/runbooks/local-ai-smoke.md.
      ...(command === 'serve'
        ? [
            {
              name: 'lingua-dev-local-ai-csp',
              transformIndexHtml(html: string): string {
                // Anchor on `connect-src 'self'` so the real directive is
                // matched, not the CSP explainer comment that also mentions
                // "connect-src". Appends local AI origins before the `;`.
                return html.replace(
                  /(connect-src 'self'[^;]*?)(;)/,
                  '$1 http://localhost:* http://127.0.0.1:*$2'
                );
              },
            },
          ]
        : []),
    ],
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
    // `import.meta.env.VITE_*` substitution as `undefined`. implementation
    // 2.5 noticed this when VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK and
    // VITE_LINGUA_LICENSE_SERVER_URL did not land in `dist/web/assets/*`.
    envDir: __dirname,
    publicDir: path.resolve(__dirname, 'public'),
    resolve: {
      alias: createWebViteAliases(__dirname),
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
          // Vite's dynamic-import preload helper is a ~1 KB shared module that
          // every chunk performing a dynamic import needs, the entry included.
          // Left to automatic placement rolldown parks it inside whichever
          // chunk is convenient — in practice the 3.7 MB monaco chunk — which
          // turns the entry's need for a one-kilobyte helper into a static
          // edge onto the whole editor, dragging Monaco into the initial
          // graph for visitors who never open one. Pinning it to its own
          // chunk is what keeps Monaco lazy.
          //
          // The helper's virtual id is `\0vite/preload-helper.js`. Keep its
          // pin alongside the vendor groups rather than in a second policy.
          // Rolldown ignores manualChunks when advancedChunks/codeSplitting
          // is also supplied, so the former mixed config emitted no named
          // vendor chunks. Keep all grouping in this one policy.
          advancedChunks: {
            // Per-group threshold, not a global merge: a vendor group that
            // captures under 4 KB is not worth its own request, so rolldown
            // drops the group and lets those modules fall back to automatic
            // chunking. Unrelated small chunks are not coalesced by this.
            minSize: 4096,
            groups: [
              // This correctness pin is smaller than the vendor threshold.
              { name: 'vite-preload', test: /preload-helper/, priority: 100, minSize: 0 },
              // Vendor code below is split so a deploy that touches app code
              // does not invalidate the framework bytes returning visitors
              // already cached. Every group is vendor-only on purpose: app
              // modules keep following their lazy boundaries, Monaco stays
              // owned by its dynamic import plus monacoInitialGraph.test.ts,
              // and worker entries must remain separate files for
              // `new Worker(new URL(...))`, so neither gets a group.
              { name: 'react', test: /node_modules\/(?:react|react-dom|scheduler)\//, priority: 50 },
              { name: 'zustand', test: /node_modules\/zustand\//, priority: 50 },
              { name: 'lucide', test: /node_modules\/lucide-react\//, priority: 50 },
              { name: 'i18next', test: /node_modules\/(?:i18next|react-i18next)\//, priority: 50 },
              // vega-embed chart renderer stays in its own chunk so the charting
              // bundle only loads when <RichValueChart> mounts.
              { name: 'vega-embed', test: /node_modules\/(?:vega-embed|vega-lite|vega)\//, priority: 50 },
              // DuckDB-WASM SQL engine plus Apache Arrow ride together behind the
              // first SQL workspace open.
              { name: 'duckdb-wasm', test: /node_modules\/(?:@duckdb\/duckdb-wasm|apache-arrow)\//, priority: 50 },
              { name: 'esbuild-wasm', test: /node_modules\/esbuild-wasm\//, priority: 50 },
            ],
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
