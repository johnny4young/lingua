/**
 * Vite config for the standalone web build.
 *
 * Differences from the Electron renderer config:
 *  - Entry point is src/web/main.tsx (not src/renderer/main.tsx)
 *  - Output goes to dist/web/ (served as a static site / PWA)
 *  - No Electron externals — everything must be bundled or CDN-loaded
 *  - Public base is '/' (adjust to '/run-lang/' for GitHub Pages sub-path)
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, 'src/web'),
  publicDir: path.resolve(__dirname, 'public'),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/web'),
    emptyOutDir: true,
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
