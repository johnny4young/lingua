import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectTestsOverlay } from '../../src/renderer/components/ProjectTests/ProjectTestsOverlay';
import { useNativeExecutionGateStore } from '../../src/renderer/stores/nativeExecutionGateStore';
import { useProjectStore } from '../../src/renderer/stores/projectStore';
import { useProjectTestStore } from '../../src/renderer/stores/projectTestStore';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';
import { asRootId } from '../../src/shared/fs/brandedIds';
import type { ProjectTestOutputEvent } from '../../src/shared/projectTests';

const originalLingua = window.lingua;
const initialProject = useProjectStore.getState();
const initialProjectTests = useProjectTestStore.getState();
const initialSettings = useSettingsStore.getState();
const initialGate = useNativeExecutionGateStore.getState();

const detection = {
  kind: 'ready' as const,
  candidates: [
    {
      framework: 'vitest' as const,
      command: 'vitest run --no-color',
      evidence: ['vitest.config.ts'],
      available: true,
    },
  ],
};

function openProject(): void {
  useProjectStore.setState({
    currentProject: {
      id: 'project-1',
      name: 'checkout',
      rootPath: '/tmp/checkout',
      openedAt: 1,
      rootId: asRootId('root-1'),
    },
  });
}

function installDesktopBridge() {
  let outputHandler: ((event: ProjectTestOutputEvent) => void) | null = null;
  const bridge = {
    detect: vi.fn().mockResolvedValue(detection),
    run: vi.fn().mockImplementation(async (_rootId, _framework, runId) => {
      outputHandler?.({ runId, stream: 'stdout', chunk: 'RUN  v4\n' });
      return {
        kind: 'success',
        framework: 'vitest',
        command: 'vitest run --no-color',
        stdout: 'RUN  v4\n2 tests passed\n',
        stderr: '',
        exitCode: 0,
        executionTime: 42,
        timeoutMs: 300_000,
      };
    }),
    stop: vi.fn().mockResolvedValue({ stopped: true }),
    onOutput: vi.fn().mockImplementation(handler => {
      outputHandler = handler;
      return () => {
        outputHandler = null;
      };
    }),
  };
  window.lingua = { platform: 'darwin', projectTests: bridge } as unknown as LinguaAPI;
  return bridge;
}

describe('ProjectTestsOverlay', () => {
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

  it('keeps the web limitation explicit instead of pretending to run locally', () => {
    openProject();
    window.lingua = { platform: 'web' } as unknown as LinguaAPI;

    render(<ProjectTestsOverlay onClose={vi.fn()} />);

    expect(screen.getByText('Project tests require the desktop app')).toBeTruthy();
    expect(screen.queryByTestId('project-tests-run')).toBeNull();
  });

  it('detects a runner and renders its completed output', async () => {
    openProject();
    const bridge = installDesktopBridge();
    const user = userEvent.setup();

    render(<ProjectTestsOverlay onClose={vi.fn()} />);
    expect(await screen.findByText('Vitest')).toBeTruthy();
    await user.click(screen.getByTestId('project-tests-run'));

    await waitFor(() => expect(screen.getByText('Passed')).toBeTruthy());
    expect(screen.getByTestId('project-tests-stdout').textContent).toContain('2 tests passed');
    expect(bridge.detect).toHaveBeenCalledWith('root-1');
    expect(bridge.run).toHaveBeenCalledWith('root-1', 'vitest', expect.any(String));
  });

  it('requires the persisted native-execution acknowledgement before spawning', async () => {
    openProject();
    const bridge = installDesktopBridge();
    useSettingsStore.setState({ nativeExecutionAcknowledged: false });
    const user = userEvent.setup();

    render(<ProjectTestsOverlay onClose={vi.fn()} />);
    await screen.findByText('Vitest');
    await user.click(screen.getByTestId('project-tests-run'));

    expect(bridge.run).not.toHaveBeenCalled();
    expect(useNativeExecutionGateStore.getState().pendingLanguage).toBe('project-tests');
  });
});
