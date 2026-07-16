import { beforeEach, describe, expect, it, vi } from 'vitest';

const trackEventMock = vi.fn();
const esbuildTransformMock = vi.fn();
const esbuildInitializeMock = vi.fn();

vi.mock('esbuild-wasm', () => ({
  initialize: (...args: unknown[]) => esbuildInitializeMock(...args),
  transform: (...args: unknown[]) => esbuildTransformMock(...args),
}));

vi.mock('../../src/renderer/utils/telemetry', () => ({
  trackEvent: (...args: unknown[]) => trackEventMock(...args),
}));

import { NodeRunner } from '../../src/renderer/runners/nodeRunner';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';

function installNodeBridge(overrides: Partial<NonNullable<LinguaAPI['node']>> = {}) {
  const node = {
    detect: vi.fn(),
    run: vi.fn().mockResolvedValue({
      kind: 'success',
      stdout: 'ok\n',
      stderr: '',
      exitCode: 0,
      executionTime: 8,
      timeoutMs: 30_000,
    }),
    stop: vi.fn().mockResolvedValue({ stopped: true }),
    ...overrides,
  };

  Object.defineProperty(window, 'lingua', {
    value: {
      platform: 'darwin',
      node,
    },
    writable: true,
    configurable: true,
  });

  return node;
}

describe('NodeRunner', () => {
  const initialSettings = useSettingsStore.getState();

  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState(initialSettings, true);
    useUIStore.setState({ statusNotice: null });
    esbuildTransformMock.mockResolvedValue({
      code: 'const value = 1;\n',
      warnings: [],
    });
    installNodeBridge();
  });

  it('transpiles TypeScript tabs even when the source has only annotations', async () => {
    const node = installNodeBridge();
    const runner = new NodeRunner();

    const result = await runner.execute('const value: number = 1;', {
      language: 'typescript',
      filePath: '/project/src/index.ts',
    });

    expect(result.error).toBeUndefined();
    expect(esbuildTransformMock).toHaveBeenCalledWith(
      'const value: number = 1;',
      expect.objectContaining({ loader: 'tsx', format: 'esm' })
    );
    expect(node.run).toHaveBeenCalledWith(
      'const value = 1;\n',
      expect.objectContaining({
        filePath: '/project/src/index.ts',
        runId: expect.any(String),
      })
    );
    expect(trackEventMock).toHaveBeenCalledWith('runtime.node_runner_used', {
      language: 'typescript',
      status: 'success',
    });
  });

  it('uses the TypeScript timeout preset for TypeScript Node-mode runs', async () => {
    const node = installNodeBridge();
    useSettingsStore.setState({
      runtimeTimeoutPresetByLanguage: {
        javascript: 'extended',
        typescript: 'quick',
        python: 'normal',
        go: 'normal',
      },
    });
    const runner = new NodeRunner();

    await runner.execute('const value: number = 1;', {
      language: 'typescript',
    });

    expect(node.run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        timeoutMs: 5_000,
      })
    );
  });

  it('offers install guidance and a forced retry when Node is missing', async () => {
    const detect = vi
      .fn()
      .mockResolvedValue({ installed: true, version: 'v24.0.0' });
    const node = installNodeBridge({
      detect,
      run: vi.fn().mockResolvedValue({
        kind: 'missing-binary',
        stdout: '',
        stderr: 'Node.js is not installed.',
        exitCode: -1,
        executionTime: 1,
        timeoutMs: 30_000,
        error: 'Node.js is not installed.',
      }),
    });
    const runner = new NodeRunner();

    const result = await runner.execute('console.log(1)', {
      language: 'javascript',
    });

    expect(result.error?.message).toContain('Node.js is not installed');
    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'warning',
      values: { toolchain: 'Node.js' },
    });

    useUIStore.getState().statusNotice?.actions?.[1]?.onClick();
    await vi.waitFor(() => expect(detect).toHaveBeenCalledWith({}, true));
    expect(node.run).toHaveBeenCalledOnce();
  });

  it('stops the main-process child for the active run', async () => {
    let resolveRun!: (value: NodeRunResult) => void;
    const node = installNodeBridge({
      run: vi.fn(
        () =>
          new Promise<NodeRunResult>((resolve) => {
            resolveRun = resolve;
          })
      ),
    });
    const runner = new NodeRunner();

    const promise = runner.execute('setInterval(() => {}, 1000)', {
      language: 'javascript',
    });

    await vi.waitFor(() => expect(node.run).toHaveBeenCalledTimes(1));
    const runId = vi.mocked(node.run).mock.calls[0]?.[1]?.runId;
    expect(runId).toEqual(expect.any(String));

    runner.stop();
    await expect(promise).resolves.toMatchObject({
      cancelled: true,
      kind: 'stopped',
    });
    expect(node.stop).toHaveBeenCalledWith(runId);
    expect(trackEventMock).toHaveBeenCalledWith('runtime.node_runner_used', {
      language: 'javascript',
      status: 'stopped',
    });

    resolveRun({
      kind: 'stopped',
      stdout: '',
      stderr: '',
      exitCode: -1,
      executionTime: 10,
      timeoutMs: 30_000,
    });
  });
});
