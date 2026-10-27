import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestsPanel } from '../../src/renderer/components/ProjectTests/TestsPanel';
import { useNativeExecutionGateStore } from '../../src/renderer/stores/nativeExecutionGateStore';
import { useProjectStore } from '../../src/renderer/stores/projectStore';
import { useProjectTestStore } from '../../src/renderer/stores/projectTestStore';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';
import { asRootId } from '../../src/shared/fs/brandedIds';
import type { ProjectTestCase, ProjectTestDetectionResult, ProjectTestRunResult } from '../../src/shared/projectTests';

const originalLingua = window.lingua;
const initialProject = useProjectStore.getState();
const initialProjectTests = useProjectTestStore.getState();
const initialSettings = useSettingsStore.getState();
const initialGate = useNativeExecutionGateStore.getState();

const detection: ProjectTestDetectionResult = {
  kind: 'ready',
  candidates: [{ framework: 'vitest', command: 'vitest run --no-color', evidence: ['vitest.config.ts'], available: true }],
};

const cases: ProjectTestCase[] = [
  { file: 'cart/total.test.ts', path: ['cartTotal', 'sums'], status: 'passed' },
  {
    file: 'cart/total.test.ts',
    path: ['cartTotal', 'rounds cents'],
    status: 'failed',
    failureFile: 'cart/total.test.ts',
    failureLine: 10,
    failureMessage: 'expected 1211 to be 1210.5',
  },
  { file: 'cart/tax.test.ts', path: ['tax'], status: 'passed' },
  { file: 'legacy.test.ts', path: ['old'], status: 'skipped' },
];

function result(overrides: Partial<ProjectTestRunResult> = {}): ProjectTestRunResult {
  return {
    kind: 'failed',
    framework: 'vitest',
    command: 'vitest run --no-color',
    stdout: '',
    stderr: '',
    orderedOutput: 'raw vitest log\n',
    exitCode: 1,
    executionTime: 5,
    timeoutMs: 300_000,
    cases,
    ...overrides,
  };
}

function openProject(): void {
  useProjectStore.setState({
    currentProject: { id: 'project-1', name: 'checkout', rootPath: '/tmp/checkout', openedAt: 1, rootId: asRootId('root-1') },
    recentProjects: [{ id: 'project-1', name: 'checkout', rootPath: '/tmp/checkout', openedAt: 1 }],
  });
}

function installBridge() {
  const bridge = {
    detect: vi.fn<() => Promise<ProjectTestDetectionResult>>().mockResolvedValue(detection),
    run: vi.fn().mockResolvedValue(result()),
    stop: vi.fn().mockResolvedValue({ stopped: true }),
    onOutput: vi.fn().mockReturnValue(() => undefined),
  };
  window.lingua = { platform: 'darwin', projectTests: bridge } as unknown as LinguaAPI;
  return bridge;
}

describe('TestsPanel', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
    useProjectStore.setState(initialProject, true);
    useProjectTestStore.setState(initialProjectTests, true);
    useSettingsStore.setState({ ...initialSettings, nativeExecutionAcknowledged: true }, true);
    useNativeExecutionGateStore.setState(initialGate, true);
  });

  afterEach(() => {
    cleanup();
    window.lingua = originalLingua;
    useProjectStore.setState(initialProject, true);
    useProjectTestStore.setState(initialProjectTests, true);
    useSettingsStore.setState(initialSettings, true);
    useNativeExecutionGateStore.setState(initialGate, true);
    vi.clearAllMocks();
  });

  it('offers up to three recent projects with their runner when none is open', async () => {
    installBridge();
    const openProjectSpy = vi.fn().mockResolvedValue(undefined);
    useProjectStore.setState({
      openProject: openProjectSpy,
      recentProjects: [
        { id: 'a', name: 'alpha', rootPath: '/a', openedAt: 4, testRunner: 'vitest' },
        { id: 'b', name: 'beta', rootPath: '/b', openedAt: 3, testRunner: 'go' },
        { id: 'c', name: 'gamma', rootPath: '/c', openedAt: 2 },
        { id: 'd', name: 'delta', rootPath: '/d', openedAt: 1 },
      ],
    });
    render(<TestsPanel />);
    expect(screen.getByText('Open a project to see its tests')).toBeTruthy();
    const rows = screen.getAllByTestId('tests-recent-project');
    expect(rows.map((row) => row.textContent)).toEqual(['alphaVitestOpen', 'betaGoOpen', 'gammaOpen']);
    await userEvent.setup().click(within(rows[1]!).getByRole('button', { name: 'Open' }));
    expect(openProjectSpy).toHaveBeenCalledWith('/b');
  });

  it('runs every test and lists them by file with counts and the failing line', async () => {
    openProject();
    const bridge = installBridge();
    const user = userEvent.setup();
    render(<TestsPanel />);
    await user.click(await screen.findByTestId('tests-run-all'));

    await waitFor(() => expect(screen.getAllByTestId('tests-file')).toHaveLength(3));
    expect(bridge.run).toHaveBeenCalledWith('root-1', 'vitest', expect.any(String), { kind: 'all' });
    expect(screen.getByTestId('tests-summary').textContent).toContain('4 tests in 3 files · found with');
    expect(screen.getByTestId('tests-counts').textContent).toBe('2 passed1 failed1 skipped');
    expect(screen.getByText('Failed at line 10')).toBeTruthy();
    expect(useProjectStore.getState().recentProjects[0]!.testRunner).toBe('vitest');

    await user.click(screen.getByText('rounds cents'));
    expect(screen.getByTestId('tests-failure').textContent).toBe('expected 1211 to be 1210.5');
  });

  it('uses the singular for one result in Spanish', async () => {
    await i18next.changeLanguage('es');
    openProject();
    installBridge();
    render(<TestsPanel />);
    await userEvent.setup().click(await screen.findByTestId('tests-run-all'));
    await waitFor(() => expect(screen.getByTestId('tests-counts').textContent).toBe('2 aprobadas1 fallida1 omitida'));
  });

  it('narrows the list to failed tests', async () => {
    openProject();
    installBridge();
    const user = userEvent.setup();
    render(<TestsPanel />);
    await user.click(await screen.findByTestId('tests-run-all'));
    await screen.findAllByTestId('tests-file');

    await user.click(screen.getByTestId('tests-filter-failed'));
    expect(screen.getAllByTestId('tests-file')).toHaveLength(1);
    expect(screen.getAllByTestId('tests-case').map((row) => row.dataset.status)).toEqual(['failed']);
  });

  it('runs one file or one test and updates only that part of the list', async () => {
    openProject();
    const bridge = installBridge();
    const user = userEvent.setup();
    render(<TestsPanel />);
    await user.click(await screen.findByTestId('tests-run-all'));
    await screen.findAllByTestId('tests-file');

    bridge.run.mockResolvedValueOnce(
      result({ kind: 'success', cases: [{ file: 'cart/total.test.ts', path: ['cartTotal', 'rounds cents'], status: 'passed' }] })
    );
    const failedRow = screen.getAllByTestId('tests-case').find((row) => row.dataset.status === 'failed')!;
    await user.click(within(failedRow).getByTestId('tests-run-test'));
    expect(bridge.run).toHaveBeenLastCalledWith('root-1', 'vitest', expect.any(String), {
      kind: 'test',
      file: 'cart/total.test.ts',
      path: ['cartTotal', 'rounds cents'],
    });
    await waitFor(() => expect(screen.getByTestId('tests-counts').textContent).toBe('3 passed0 failed1 skipped'));

    await user.click(within(screen.getAllByTestId('tests-file')[1]!).getByTestId('tests-run-file'));
    expect(bridge.run).toHaveBeenLastCalledWith('root-1', 'vitest', expect.any(String), { kind: 'file', file: 'cart/tax.test.ts' });
  });

  it('opens the raw output when the report could not be read', async () => {
    openProject();
    const bridge = installBridge();
    bridge.run.mockResolvedValueOnce(result({ cases: undefined }));
    const user = userEvent.setup();
    render(<TestsPanel />);
    await user.click(await screen.findByTestId('tests-run-all'));
    expect((await screen.findByTestId('tests-notice')).textContent).toBe('The runner report could not be read.');
    expect(screen.getByTestId('tests-output').textContent).toBe('raw vitest log\n');
  });

  it('opens the log when a run fails before any test reports', async () => {
    openProject();
    const bridge = installBridge();
    bridge.run.mockResolvedValueOnce(result({ cases: [], orderedOutput: 'error: could not compile' }));
    render(<TestsPanel />);
    await userEvent.setup().click(await screen.findByTestId('tests-run-all'));
    expect((await screen.findByTestId('tests-notice')).textContent).toBe('The run failed before any test reported a result.');
    expect(screen.getByTestId('tests-output').textContent).toBe('error: could not compile');
  });

  it('remembers the runner the project last ran on its recent entry', async () => {
    openProject();
    const bridge = installBridge();
    bridge.detect.mockResolvedValueOnce({
      kind: 'ready',
      candidates: [detection.candidates[0]!, { framework: 'go', command: 'go test ./...', evidence: ['go.mod'], available: true }],
    });
    const user = userEvent.setup();
    render(<TestsPanel />);
    await user.selectOptions(await screen.findByTestId('tests-runner'), 'go');
    await user.click(screen.getByTestId('tests-run-all'));
    await waitFor(() => expect(useProjectStore.getState().recentProjects[0]!.testRunner).toBe('go'));
  });

  it.each([['en', 'Detect again'], ['es', 'Detectar de nuevo']])('detects a newly configured runner from the empty state in %s without running tests', async (locale, label) => {
    await i18next.changeLanguage(locale);
    openProject();
    const bridge = installBridge();
    let finish!: (value: ProjectTestDetectionResult) => void;
    bridge.detect.mockResolvedValueOnce({ kind: 'none', candidates: [] }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const user = userEvent.setup();
    render(<TestsPanel />);
    await screen.findByRole('button', { name: label });
    await waitFor(() => expect((screen.getByRole('button', { name: label }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole('button', { name: label }));
    expect((screen.getByRole('button', { name: label }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: label }));
    expect(bridge.detect).toHaveBeenCalledTimes(2);
    expect(bridge.run).not.toHaveBeenCalled();
    await act(async () => finish(detection));
    expect((await screen.findByTestId('tests-run-all') as HTMLButtonElement).disabled).toBe(false);
    expect(bridge.detect).toHaveBeenNthCalledWith(2, 'root-1');
    expect(bridge.run).not.toHaveBeenCalled();
  });

  it('explains a runner that needs setup and finds it again after Detect again', async () => {
    openProject();
    const bridge = installBridge();
    bridge.detect.mockResolvedValueOnce({
      kind: 'ready',
      candidates: [{ ...detection.candidates[0]!, available: false, unavailableReason: 'node-not-found' }],
    });
    const user = userEvent.setup();
    render(<TestsPanel />);
    expect((await screen.findByTestId('tests-unavailable')).textContent).toContain('Node.js was not found');
    expect((screen.getByTestId('tests-run-all') as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByTestId('tests-refresh'));
    await waitFor(() => expect((screen.getByTestId('tests-run-all') as HTMLButtonElement).disabled).toBe(false));
  });

  it('asks for the native execution acknowledgement before spawning', async () => {
    openProject();
    const bridge = installBridge();
    useSettingsStore.setState({ nativeExecutionAcknowledged: false });
    render(<TestsPanel />);
    await userEvent.setup().click(await screen.findByTestId('tests-run-all'));
    expect(bridge.run).not.toHaveBeenCalled();
    expect(useNativeExecutionGateStore.getState().pendingLanguage).toBe('project-tests');
  });
});
