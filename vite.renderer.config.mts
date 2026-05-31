import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySharedEnvDefaults, getSharedBuildDefines } from './build/appBuildMetadata.mts';
import { copyRuntimeAssetsPlugin } from './build/copyRuntimeAssetsPlugin.mts';

// Seed VITE_LINGUA_APP_VERSION from package.json before Vite reads
// process.env so the telemetry consumer and web update banner pick
// up the real version. RL-061 Slice 5.
applySharedEnvDefaults();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), copyRuntimeAssetsPlugin()],
  define: {
    ...getSharedBuildDefines(),
    // Desktop renderer loads Pyodide from the local copy placed under
    // <renderer-out-dir>/pyodide/. The web build overrides this to
    // the CDN until RL-083 Slice 2 picks the first-party hosting path.
    __LINGUA_PYODIDE_INDEX_URL__: JSON.stringify(null),
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
    alias: {
      '@': path.resolve(__dirname, './src/renderer'),
    },
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
        manualChunks: (id) => {
          // Monaco editor and language workers — largest chunk, load separately
          if (id.includes('monaco-editor') || id.includes('@monaco-editor')) {
            return 'monaco';
          }
          // Pyodide static assets are copied to <outDir>/pyodide/ by
          // copyRuntimeAssetsPlugin (RL-083 Slice 1) — no JS chunking
          // is involved. esbuild-wasm still ships in-bundle.
          if (id.includes('esbuild-wasm')) {
            return 'esbuild-wasm';
          }
          // React + ReactDOM together
          if (id.includes('react-dom') || id.includes('react/')) {
            return 'react';
          }
          // Zustand store infrastructure
          if (id.includes('zustand')) {
            return 'zustand';
          }
          // Lucide icons
          if (id.includes('lucide-react')) {
            return 'lucide';
          }
          // RL-044 Slice 2b-beta — mirror the web chart chunk split
          // for the packaged desktop renderer. <RichValueChart>
          // lazy-loads vega-embed, so these deps should stay grouped
          // behind that first chart render in both shipped surfaces.
          if (
            id.includes('vega-embed') ||
            id.includes('vega-lite') ||
            id.includes('node_modules/vega/')
          ) {
            return 'vega-embed';
          }
          // RL-097 Slice 2 — mirror the web SQL chunk split for the
          // packaged desktop renderer. <SqlWorkspacePanel> lazy-loads
          // @duckdb/duckdb-wasm + apache-arrow, so these deps should
          // stay grouped behind that first SQL tab open in both
          // shipped surfaces.
          if (
            id.includes('@duckdb/duckdb-wasm') ||
            id.includes('apache-arrow')
          ) {
            return 'duckdb-wasm';
          }
          // Web workers — bundled separately by Vite's worker import syntax,
          // but any shared worker utilities should be isolated
          if (id.includes('/workers/')) {
            return 'workers';
          }
        },
      },
    },
  },
});
