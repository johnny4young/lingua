import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/', 'out/', 'output/', '.vite/', 'node_modules/', '*.config.*'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Global: honour _ prefix for intentionally unused identifiers across all files
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // ESLint 10's two new recommended rules were demoted to warn by the
      // dep-sweep so the bumps could land; the 2026-05-18 cleanup slice
      // fixed every call site so both are re-promoted to error.
      'no-useless-assignment': 'error',
      'preserve-caught-error': 'error',
    },
  },
  // Service worker: declare ServiceWorker globals (flat config ignores eslint-env comments)
  {
    files: ['public/sw.js'],
    languageOptions: {
      globals: globals.serviceworker,
    },
  },
  {
    files: ['scripts/**/*.mjs', 'license-server/scripts/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      // react-hooks 7 added four new recommended rules. The 2026-05-18
      // cleanup slice cleared `purity` (CompareResultsPanel anchored its
      // relative-time strings to capturedAt instead of Date.now() so the
      // render stays pure) and bumped that rule to error. The other three
      // (`set-state-in-effect` x24, `immutability` x2, `refs` x1) stay
      // warn because most pre-existing call sites are intentional
      // useEffect patterns (timers, focus reset, scroll-into-view) whose
      // refactor would be a design change rather than a bug fix. Track
      // the per-site review under the dep-sweep maintenance entry.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'error',
      'react-hooks/refs': 'warn',
    },
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off',
    },
  }
);
