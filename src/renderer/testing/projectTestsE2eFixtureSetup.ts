import type { ProjectTestCase, ProjectTestOutputEvent, ProjectTestRunResult } from '../../shared/projectTests';
import { useProjectStore } from '../stores/projectStore';
import { useProjectTestStore } from '../stores/projectTestStore';
import { useSettingsStore } from '../stores/settingsStore';
import { asRootId } from '../../shared/fs/brandedIds';

const rootId = asRootId('e2e-project-tests-root');

export function prepareProjectTestsE2eFixture(): void {
  const noProject = new URLSearchParams(window.location.search).get('state') === 'no-project';
  useProjectStore.setState({
    currentProject: noProject
      ? null
      : {
          id: 'e2e-project-tests',
          name: 'polyglot-checkout',
          rootPath: '/fixtures/polyglot-checkout',
          openedAt: 1,
          rootId,
        },
    recentProjects: [
      { id: '/fixtures/polyglot-checkout', name: 'polyglot-checkout', rootPath: '/fixtures/polyglot-checkout', openedAt: 3, testRunner: 'vitest' },
      { id: '/fixtures/ledger-api', name: 'ledger-api', rootPath: '/fixtures/ledger-api', openedAt: 2, testRunner: 'go' },
      { id: '/fixtures/notes', name: 'notes', rootPath: '/fixtures/notes', openedAt: 1 },
    ],
  });
  const cases: ProjectTestCase[] = [
    { file: 'cart/total.test.ts', path: ['cartTotal', 'sums quantities'], status: 'passed', durationMs: 2 },
    {
      file: 'cart/total.test.ts',
      path: ['cartTotal', 'rounds cents'],
      status: 'failed',
      failureFile: 'cart/total.test.ts',
      failureLine: 10,
      failureMessage: 'AssertionError: expected 1211 to be 1210.5 // Object.is equality',
    },
    { file: 'cart/total.test.ts', path: ['cartTotal', 'applies tax rate'], status: 'passed' },
    { file: 'cart/tax.test.ts', path: ['tax', 'uses the region rate'], status: 'passed' },
    { file: 'checkout/flow.test.ts', path: ['checkout', 'completes'], status: 'passed' },
    { file: 'pricing/legacy.test.ts', path: ['legacy', 'old rounding'], status: 'skipped' },
  ];
  useProjectTestStore.setState({
    rootId,
    projectName: 'polyglot-checkout',
    status: 'ready',
    detection: {
      kind: 'ready',
      candidates: [
        { framework: 'vitest', command: 'vitest run --no-color', evidence: ['vitest.config.ts'], available: true },
        { framework: 'go', command: 'go test ./...', evidence: ['go.mod'], available: true },
      ],
    },
    selectedFramework: 'vitest',
    result: {
      kind: 'failed',
      framework: 'vitest',
      command: 'vitest run --no-color',
      orderedOutput: ' FAIL  cart/total.test.ts > cartTotal > rounds cents\n Tests  1 failed | 4 passed | 1 skipped (6)\n',
      stdout: '',
      stderr: '',
      exitCode: 1,
      executionTime: 842,
      timeoutMs: 300_000,
      cases,
    },
    cases,
    casesTruncated: false,
    filter: 'all',
    runningScope: null,
    liveOutput: { stdout: '', stderr: '' },
    error: null,
    activeRunId: null,
  });
  useSettingsStore.setState({ nativeExecutionAcknowledged: true });
  let onOutput: ((event: ProjectTestOutputEvent) => void) | undefined;
  let attempts = 0;
  window.lingua = {
    ...window.lingua,
    projectTests: {
      detect: async () => useProjectTestStore.getState().detection!,
      run: async (_rootId, framework, runId, scope) => {
        attempts += 1;
        const fixed = cases.map(entry => (entry.status === 'failed' ? { file: entry.file, path: entry.path, status: 'passed' as const } : entry));
        const result: ProjectTestRunResult = {
          kind: attempts === 1 ? 'failed' : 'success',
          framework,
          command: 'vitest run --no-color',
          stdout: 'first\nlast\n',
          stderr: 'warning\n',
          orderedOutput: 'first\nwarning\nlast\n',
          exitCode: attempts === 1 ? 1 : 0,
          executionTime: 12,
          timeoutMs: 300_000,
          ...(scope ? { scope } : {}),
          cases: scope && scope.kind !== 'all' ? fixed : attempts === 1 ? cases : fixed,
        };
        const pending = new Promise<ProjectTestRunResult>(resolve => {
          window.addEventListener('e2e-project-tests-complete', () => resolve(result), {
            once: true,
          });
        });
        onOutput?.({ runId, stream: 'stdout', chunk: 'first\n' });
        onOutput?.({ runId, stream: 'stderr', chunk: 'warning\n' });
        onOutput?.({ runId, stream: 'stdout', chunk: 'last\n' });
        return pending;
      },
      stop: async () => ({ stopped: true }),
      onOutput: handler => {
        onOutput = handler;
        return () => {
          onOutput = undefined;
        };
      },
    },
  };
}
