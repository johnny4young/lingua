import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeTypingChunkPlugin } from '../../../build/nodeTypingChunkPlugin.mts';

const fixture = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(fixture, '../../..');
const output = process.env.LINGUA_SQL_EDITOR_FIXTURE_ROOT;
if (!output) throw new Error('Run through scripts/smoke-sql-editor-input.mjs');
export default defineConfig({
  root: fixture,
  envDir: fixture,
  cacheDir: path.join(output, 'vite-cache'),
  plugins: [nodeTypingChunkPlugin(), react()],
  build: { outDir: path.join(output, 'dist'), emptyOutDir: false },
  preview: { host: '127.0.0.1', port: 0, strictPort: true },
  define: { 'import.meta.env.VITE_LINGUA_TELEMETRY_URL': JSON.stringify('') },
  resolve: {
    alias: {
      react: path.join(repo, 'node_modules/react'),
      'react-dom': path.join(repo, 'node_modules/react-dom'),
      '@monaco-editor/react': path.join(repo, 'node_modules/@monaco-editor/react/dist/index.mjs'),
      'monaco-editor': path.join(repo, 'node_modules/monaco-editor'),
    },
    dedupe: ['react', 'react-dom', 'i18next', 'react-i18next'],
  },
});
