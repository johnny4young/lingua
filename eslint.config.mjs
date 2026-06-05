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
    // RL-121 / AUDIT-01 — ban inline active-tab derivation in the
    // renderer. The one canonical tabs.find(... === activeTabId)
    // lives in editorSelectors.ts (getActiveTab / getActiveTabIndex —
    // extracted from editorStore.ts by the RL-128 split); every other
    // site must go through getActiveTab(state) or the useActiveTab() /
    // useActiveTabId() hooks so the selector stays referentially
    // stable and re-render fan-out stays bounded.
    files: ['src/renderer/**/*.{ts,tsx}'],
    ignores: ['src/renderer/stores/editorSelectors.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.property.name="find"][callee.object.name="tabs"]:has(Identifier[name="activeTabId"])',
          message:
            'Use useActiveTab() / getActiveTab(state) instead of an inline tabs.find(... === activeTabId). See RL-121.',
        },
        {
          selector:
            'CallExpression[callee.property.name="find"][callee.object.property.name="tabs"]:has(Identifier[name="activeTabId"])',
          message:
            'Use useActiveTab() / getActiveTab(state) instead of an inline state.tabs.find(... === activeTabId). See RL-121.',
        },
      ],
    },
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  // RL-098 Slice 1 — the CLI must stay React-free + Electron-free
  // so the bundled CJS at `dist/cli/lingua.cjs` stays small instead
  // of pulling in multi-megabyte app surfaces. Forbid imports from
  // forbidden trees at lint time; esbuild would still bundle them
  // otherwise and the bundle would balloon silently. Allow:
  // `src/shared/**`, `node:*`,
  // third-party deps that are CLI-safe.
  {
    files: ['src/cli/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['*/renderer/*', '**/renderer/**'],
              message:
                'The CLI bundle must not import renderer code. Use shared modules under src/shared/ instead.',
            },
            {
              group: ['*/main/*', '**/main/**'],
              message:
                'The CLI runs outside Electron — main-process modules are off-limits.',
            },
            {
              group: ['*/preload/*', '**/preload/**'],
              message:
                'The CLI runs outside Electron — preload modules are off-limits.',
            },
          ],
          paths: [
            { name: 'react', message: 'React must not reach the CLI bundle.' },
            { name: 'react-dom', message: 'React DOM must not reach the CLI bundle.' },
            { name: 'react-i18next', message: 'i18n is renderer-only; the CLI is English Slice 1.' },
            { name: 'electron', message: 'Electron must not reach the CLI bundle.' },
            { name: 'zustand', message: 'Zustand stores are renderer-only; the CLI is stateless.' },
          ],
        },
      ],
      '@typescript-eslint/no-require-imports': 'off',
    },
    languageOptions: {
      globals: globals.node,
    },
  }
);
