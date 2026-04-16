import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSharedBuildDefines } from './build/appBuildMetadata.mts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  define: getSharedBuildDefines(),
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
