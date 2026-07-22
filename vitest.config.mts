import { configDefaults, defineConfig } from 'vitest/config';
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
    // The suite mixes jsdom module transforms with CPU microbenchmarks.
    // Letting Vitest mirror a high host core count creates enough contention
    // to delay lazy imports and distort full-suite performance guards; four
    // workers is faster and deterministic across local and hosted runners.
    maxWorkers: 4,
    // The website is a deliberately isolated (--ignore-workspace) npm
    // package; this root job installs only the app's pnpm deps. A test
    // that imports website/src/*.ts forces esbuild to load
    // website/tsconfig.json, which `extends astro/tsconfigs/strict` from
    // website/node_modules — absent here, so the transform fails in CI
    // (it only passes locally when the website happens to be installed).
    // Website unit tests belong with the website toolchain; keep them out
    // of the app's root run.
    exclude: [...configDefaults.exclude, 'tests/website/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer'),
      '#src': path.resolve(__dirname, './src'),
    },
  },
});
