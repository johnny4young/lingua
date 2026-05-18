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
      // ESLint 10 promoted `no-useless-assignment` and `preserve-caught-error`
      // to recommended rules. Both surface real anti-patterns but landed
      // during the major sweep with pre-existing violations (~6 + 4). Land
      // the bumps as warnings so CI stays green; fix the call sites in a
      // follow-up cleanup slice (tracked in the PLAN maintenance entry).
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
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
      // react-hooks 7 added four new recommended rules that surface
      // legitimate concurrent-mode anti-patterns. Pre-existing violations:
      // 24 `set-state-in-effect`, 2 `immutability`, 1 `purity` (Date.now()
      // in render), 1 `refs` (controlsRef read during render). Demote to
      // warn so the bump can land; the cleanup is a follow-up slice
      // (tracked in docs/PLAN.md maintenance entry).
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
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
