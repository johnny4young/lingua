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

export default defineConfig({
  base,
  plugins: [react(), copyRuntimeAssetsPlugin()],
  define: {
    ...getSharedBuildDefines(),
    // The web build self-hosts Pyodide under dist/web/pyodide via the
    // same runtime-asset copier as Electron, so the worker's
    // `new URL('../pyodide/...')` path is the authority.
    __LINGUA_PYODIDE_INDEX_URL__: JSON.stringify(null),
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
    include: ['react', 'react-dom', 'react-i18next', 'i18next'],
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
        manualChunks: (id) => {
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
          if (
            id.includes('@duckdb/duckdb-wasm') ||
            id.includes('apache-arrow')
          ) {
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
});
