/**
 * Vite config for the standalone web build.
 *
 * Differences from the Electron renderer config:
 *  - Entry point is src/web/main.tsx (not src/renderer/main.tsx)
 *  - Output goes to dist/web/ (served as a static site / PWA)
 *  - No Electron externals — everything must be bundled or CDN-loaded
 *  - Public base defaults to '/' and can be overridden for GitHub Pages
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySharedEnvDefaults, getSharedBuildDefines } from './build/appBuildMetadata.mts';

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
  plugins: [react()],
  define: getSharedBuildDefines(),
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
          if (id.includes('/workers/')) {
            return 'workers';
          }
        },
      },
    },
  },
  // Allow fetching Pyodide from CDN during development
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
