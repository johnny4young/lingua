import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSharedBuildDefines } from './build/appBuildMetadata.mts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  define: getSharedBuildDefines(),
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer'),
      '#src': path.resolve(__dirname, './src'),
    },
  },
});
