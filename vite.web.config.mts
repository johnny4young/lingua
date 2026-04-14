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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = process.env.VITE_BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [react()],
  root: path.resolve(__dirname, 'src/web'),
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
