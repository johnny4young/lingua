import { nodeTypingChunkPlugin } from './build/nodeTypingChunkPlugin.mts';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySharedEnvDefaults, getSharedBuildDefines } from './build/appBuildMetadata.mts';
import { copyRuntimeAssetsPlugin } from './build/copyRuntimeAssetsPlugin.mts';
import { createRendererViteAliases } from './build/viteAliases.mts';

// Seed VITE_LINGUA_APP_VERSION from package.json before Vite reads
// process.env so the telemetry consumer and web update banner pick
// up the real version. implementation
applySharedEnvDefaults();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [nodeTypingChunkPlugin(),react(), copyRuntimeAssetsPlugin()],
  define: {
    ...getSharedBuildDefines(),
    // Desktop renderer loads Pyodide from the local copy placed under
    // <renderer-out-dir>/pyodide/. The web build overrides this to
    // the CDN until implementation picks the first-party hosting path.
    __LINGUA_PYODIDE_INDEX_URL__: JSON.stringify(null),
    // Desktop packages keep large WASM runtimes inside the app bundle.
    // The standalone web build overrides these to public R2 URLs so
    // Cloudflare Pages never receives >25 MiB single assets.
    __LINGUA_DUCKDB_MVP_WASM_URL__: JSON.stringify(null),
    __LINGUA_RUBY_WASM_URL__: JSON.stringify(null),
    // Same-origin / bundled payloads skip runtime sha256 verification
    // (integrity is covered by runtime-assets.lock.json + pnpm-lock);
    // only the web build's R2-mirrored fetches carry expected hashes.
    __LINGUA_DUCKDB_MVP_WASM_SHA256__: JSON.stringify(null),
    __LINGUA_RUBY_WASM_SHA256__: JSON.stringify(null),
  },
  // Repo-root `.env` / `.env.production` are the canonical source for
  // VITE_* values across all build configs (renderer, web, main). When
  // `make:desktop` invokes Vite via `@electron-forge/plugin-vite`, the
  // working directory is the project root but Vite's default envDir
  // resolution can drift to wherever Forge stages the renderer entry,
  // silently leaving every `import.meta.env.VITE_*` substitution as
  // `undefined`. The desktop renderer was missing
  // VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK in packaged builds for that
  // reason — pasting a CF token reported `no-public-key`. The web
  // config (`vite.web.config.mts`) already pins `envDir` for the same
  // reason; this mirror keeps the desktop renderer in sync.
  envDir: __dirname,
  server: {
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
  resolve: {
    alias: createRendererViteAliases(__dirname),
    // Keep a single React/i18n instance in the Electron renderer dev
    // server. Mirrors vite.web.config.mts — see the optimizeDeps note
    // below for why the include list matters.
    dedupe: ['react', 'react-dom', 'i18next', 'react-i18next'],
  },
  optimizeDeps: {
    // Pre-bundle every React entrypoint in one optimize pass so the dev
    // server never re-optimizes a React subpath late and splits it into
    // a second instance. `src/renderer/main.tsx` renders via
    // `react-dom/client`; the JSX runtimes are pulled in by every
    // component. Without listing them here, late discovery behind the
    // lazy Monaco/CodeEditor boundary produces mismatched optimize-dep
    // hashes (`react.js?v=A` vs `react-dom_client.js?v=B`) → two React
    // copies → "Invalid hook call … more than one copy of React" on the
    // first hook. Web config hit this first; the renderer (dev:desktop)
    // shares the same crawl shape, so it gets the same guard.
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
    rollupOptions: {
      output: {
        // Same defect, same fix as vite.web.config.mts: Vite's dynamic-import
        // preload helper is a ~1 KB shared module every chunk with a dynamic
        // import needs, the entry included. Rolldown otherwise parks it inside
        // the monaco chunk, which turns that need into a static edge onto the
        // whole editor and pins Monaco to the initial graph. The helper's id
        // is the virtual `\0vite/preload-helper.js`, which a rollup-compat
        // `manualChunks` function never sees, so it has to be a group here.
        // The vendor groups below replaced such a function: under Vite 8 /
        // rolldown it produced no named chunk at all, so the split it
        // described never existed in the built output.
        advancedChunks: {
          // Per-group threshold, not a global merge: a vendor group that
          // captures under 4 KB is not worth its own request, so rolldown
          // drops the group and lets those modules fall back to automatic
          // chunking. Unrelated small chunks are not coalesced by this.
          minSize: 4096,
          groups: [
            { name: 'vite-preload', test: /preload-helper/, priority: 100 },
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
});
