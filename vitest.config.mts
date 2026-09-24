import { nodeTypingChunkPlugin } from './build/nodeTypingChunkPlugin.mts';
import { configDefaults, defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySharedEnvDefaults, getSharedBuildDefines } from './build/appBuildMetadata.mts';

// Seed VITE_LINGUA_APP_VERSION from package.json so jsdom-based tests
// see the real version through `import.meta.env`. implementation
applySharedEnvDefaults();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Vitest 5 does not forward the root CLI --exclude option into inline
// projects. Exclude timing benches from instrumented runs in each project,
// while keeping them in the ordinary uninstrumented suite.
const coverageBenchExcludes = process.argv.includes('--coverage') ? ['**/*.bench.test.ts'] : [];

export default defineConfig({
  plugins: [nodeTypingChunkPlugin()],
  define: getSharedBuildDefines(),
  test: {
    globals: true,
    // These suites have been exercised without DOM globals or renderer setup.
    // New tests in their directories must remain Node-compatible or move to a
    // DOM suite; all other tests retain the historical jsdom environment.
    projects: [
      {
        extends: true,
        test: {
          name: 'node-operations',
          environment: 'node',
          setupFiles: [],
          include: [
            'tests/docs/**/*.test.ts',
            'tests/scripts/**/*.test.ts',
            'tests/main/**/*.test.ts',
            'tests/cli/**/*.test.ts',
            'tests/ipc/**/*.test.ts',
            'tests/shared/**/*.test.ts',
          ],
          exclude: [...configDefaults.exclude, 'tests/website/**', ...coverageBenchExcludes],
        },
      },
      {
        extends: true,
        test: {
          name: 'renderer-and-runtime',
          environment: 'jsdom',
          setupFiles: ['./tests/setup.ts'],
          include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
          exclude: [
            ...configDefaults.exclude,
            'tests/website/**',
            'tests/docs/**',
            'tests/scripts/**',
            'tests/main/**',
            'tests/cli/**',
            'tests/ipc/**',
            'tests/shared/**',
            ...coverageBenchExcludes,
          ],
        },
      },
    ],
    // The suite mixes jsdom module transforms with CPU microbenchmarks.
    // Letting Vitest mirror a high host core count creates enough contention
    // to delay lazy imports and distort full-suite performance guards; four
    // workers is faster and deterministic across local and hosted runners.
    maxWorkers: 4,
    // Instrumented coverage runs only under `pnpm run test:coverage`; the
    // plain `pnpm test` stays uninstrumented. Thresholds are a ratchet set
    // Math.floor(measured percentage - 2) initially, then only raised.
    // Rounding leaves at least two but less than three points of headroom.
    coverage: {
      provider: 'v8',
      enabled: false,
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/types.d.ts'],
      reporter: ['text-summary', 'json-summary', 'lcov'],
      reportsDirectory: 'output/coverage',
      // Measured 2026-09-06 on the full suite (benches excluded):
      // Initial: lines 80.69, statements 77.92, functions 78.99, branches 69.82.
      // A fresh full run measured functions 79.04, raising that floor to 77.
      // Under vitest 5 a fresh full run measured lines 80.89, statements 78.10,
      // functions 79.06 and branches 70.01, raising statements to 76 and
      // branches to 68.
      thresholds: {
        lines: 78,
        statements: 76,
        functions: 77,
        branches: 68,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer'),
      '#src': path.resolve(__dirname, './src'),
    },
  },
});
