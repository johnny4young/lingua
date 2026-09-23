import { beforeEach, describe, expect, it, vi } from 'vitest';

const trackEventMock = vi.fn();
vi.mock('../../src/renderer/utils/telemetry', () => ({
  trackEvent: (...args: unknown[]) => trackEventMock(...args),
}));

import { AltJsRunner } from '../../src/renderer/runners/altJsRunner';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';

function installBridge(
  id: 'deno' | 'bun',
  overrides: Record<string, unknown> = {}
) {
  const bridge = {
    detect: vi.fn(),
    run: vi.fn().mockResolvedValue({
      kind: 'success',
      stdout: 'hi\n',
      stderr: '',
      exitCode: 0,
      executionTime: 5,
      timeoutMs: 30_000,
    }),
    stop: vi.fn().mockResolvedValue({ stopped: true }),
    ...overrides,
  };
  Object.defineProperty(window, 'lingua', {
    value: { platform: 'darwin', [id]: bridge },
    writable: true,
    configurable: true,
  });
  return bridge;
}

describe('AltJsRunner', () => {
  const initialSettings = useSettingsStore.getState();

  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState(initialSettings, true);
    useUIStore.setState({ statusNotice: null });
  });

  it('runs TypeScript through the Deno bridge without transpiling (native TS)', async () => {
    const bridge = installBridge('deno');
    const runner = new AltJsRunner('deno');
    await runner.init();
    const result = await runner.execute('const x: number = 2; console.log(x)', {
      language: 'typescript',
    });
    expect(bridge.run).toHaveBeenCalledTimes(1);
    // Raw TS source crosses IPC unchanged — Deno compiles TS itself.
    const [source, options] = bridge.run.mock.calls[0]!;
    expect(source).toContain('const x: number');
    expect(options.language).toBe('typescript');
    expect(result.kind).toBe('success');
    expect(result.stdout).toEqual([{ type: 'log', args: ['hi\n'] }]);
  });

  it('routes to the Bun bridge for a Bun runner', async () => {
    const bridge = installBridge('bun');
    const runner = new AltJsRunner('bun');
    await runner.init();
    await runner.execute('console.log(1)', { language: 'javascript' });
    expect(bridge.run).toHaveBeenCalledTimes(1);
  });

  it.each(['deno', 'bun'] as const)('recovers when %s is not installed', async (id) => {
    const bridge = installBridge(id, {
      run: vi.fn().mockResolvedValue({
        kind: 'missing-binary',
        stdout: '',
        stderr: '',
        exitCode: -1,
        executionTime: 0,
        error: `${id} is not installed`,
        timeoutMs: 30_000,
      }),
      detect: vi.fn().mockResolvedValue({ installed: true, version: '1.0.0' }),
    });
    const runner = new AltJsRunner(id);
    await runner.init();
    const result = await runner.execute('console.log(1)');
    expect(result.kind).toBe('error');
    expect(result.error?.message).toContain('not installed');
    const notice = useUIStore.getState().statusNotice;
    expect(notice).toMatchObject({
      tone: 'warning',
      priority: 'high',
      messageKey: 'nativeToolchain.missing.message',
      values: { toolchain: id === 'deno' ? 'Deno' : 'Bun' },
      actions: [
        { labelKey: 'nativeToolchain.action.install' },
        { labelKey: 'nativeToolchain.action.retry' },
      ],
    });
    const retry = notice?.actions?.[1];
    useUIStore.getState().dismissStatusNotice('cta');
    retry?.onClick();
    await vi.waitFor(() => {
      expect(bridge.detect).toHaveBeenCalledWith({}, true);
      expect(useUIStore.getState().statusNotice).toMatchObject({
        tone: 'success',
        messageKey: 'nativeToolchain.retry.detected',
      });
    });
  });
});
