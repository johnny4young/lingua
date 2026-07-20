import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySharedEnvDefaults, getSharedBuildDefines } from './build/appBuildMetadata.mts';

// Seed VITE_LINGUA_APP_VERSION from package.json so jsdom-based tests
// see the real version through `import.meta.env`. implementation
applySharedEnvDefaults();

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
