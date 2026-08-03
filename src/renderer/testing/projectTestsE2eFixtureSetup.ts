import { useProjectStore } from '../stores/projectStore';
import { useProjectTestStore } from '../stores/projectTestStore';
import { useSettingsStore } from '../stores/settingsStore';
import { asRootId } from '../../shared/fs/brandedIds';

const rootId = asRootId('e2e-project-tests-root');

export function prepareProjectTestsE2eFixture(): void {
  useProjectStore.setState({
    currentProject: {
      id: 'e2e-project-tests',
      name: 'polyglot-checkout',
      rootPath: '/fixtures/polyglot-checkout',
      openedAt: 1,
      rootId,
    },
  });
  useProjectTestStore.setState({
    rootId,
    projectName: 'polyglot-checkout',
    status: 'ready',
    detection: {
      kind: 'ready',
      candidates: [
        {
          framework: 'vitest',
          command: 'vitest run --no-color',
          evidence: ['vitest.config.ts', 'package.json#vitest'],
          available: true,
        },
        {
          framework: 'jest',
          command: 'jest --runInBand --colors=false',
          evidence: ['jest.config.js'],
          available: true,
        },
        {
          framework: 'pytest',
          command: 'python -m pytest -q --color=no',
          evidence: ['pyproject.toml#[tool.pytest]'],
          available: true,
        },
        {
          framework: 'go',
          command: 'go test ./...',
          evidence: ['go.mod'],
          available: true,
        },
        {
          framework: 'cargo',
          command: 'cargo test --color never',
          evidence: ['Cargo.toml'],
          available: true,
        },
      ],
    },
    selectedFramework: 'vitest',
    result: {
      kind: 'success',
      framework: 'vitest',
      command: 'vitest run --no-color',
      stdout: '✓ src/cart.test.ts (4 tests)\n✓ src/license.test.ts (3 tests)\n\n7 tests passed\n',
      stderr: '',
      exitCode: 0,
      executionTime: 842,
      timeoutMs: 300_000,
    },
    liveOutput: { stdout: '', stderr: '' },
    error: null,
    activeRunId: null,
  });
  useSettingsStore.setState({ nativeExecutionAcknowledged: true });
  window.lingua = {
    ...window.lingua,
    projectTests: {
      detect: async () => useProjectTestStore.getState().detection!,
      run: async () => useProjectTestStore.getState().result!,
      stop: async () => ({ stopped: true }),
      onOutput: () => () => undefined,
    },
  };
}
