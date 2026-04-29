import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSharedBuildDefines } from './build/appBuildMetadata.mts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  define: getSharedBuildDefines(),
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
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Monaco editor and language workers — largest chunk, load separately
          if (id.includes('monaco-editor') || id.includes('@monaco-editor')) {
            return 'monaco';
          }
          // Pyodide CDN is loaded at runtime, but esbuild-wasm ships in bundle
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
