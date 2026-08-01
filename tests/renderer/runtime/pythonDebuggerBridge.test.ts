import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PythonDebuggerBridge } from '@/../shared/pythonDebugger';
import {
  dispatchPythonDebuggerCommand,
  executePythonDebugSession,
  isPythonDebuggerActive,
  runPythonDebuggerToEnd,
} from '@/runtime/pythonDebuggerBridge';
import { useDebuggerStore } from '@/stores/debuggerStore';
import type { FileTab } from '@/types/editor';

const originalLingua = window.lingua;

const tab: FileTab = {
  id: 'python-tab',
  name: 'main.py',
  language: 'python',
  content: 'a = 1\nb = 2\nprint(a + b)\n',
  isDirty: true,
  workflowMode: 'debug',
};

function bridge(overrides: Partial<PythonDebuggerBridge> = {}): PythonDebuggerBridge {
  return {
    start: vi.fn(),
    command: vi.fn(),
    syncBreakpoints: vi.fn(async sessionId => ({ kind: 'synced', sessionId })),
    syncWatches: vi.fn(async sessionId => ({ kind: 'synced', sessionId })),
    stop: vi.fn(async sessionId => ({ kind: 'stopped', sessionId })),
    ...overrides,
  };
}

beforeEach(() => {
  useDebuggerStore.setState({
    breakpoints: {
      'python-tab:2': {
        tabId: 'python-tab',
        line: 2,
        condition: '',
        mode: 'pause',
        logMessage: '',
        enabled: true,
      },
    },
    breakpointOrder: ['python-tab:2'],
    watches: [{ id: 'watch-1', expression: 'a + b' }],
    session: null,
    pausedFrame: null,
  });
});

afterEach(() => {
  window.lingua = originalLingua;
  useDebuggerStore.getState().detachSession();
});

describe('pythonDebuggerBridge', () => {
  it('attaches on pause, routes a step, and settles through the shared run result', async () => {
    const nativeBridge = bridge({
      start: vi.fn(async () => ({
        kind: 'paused',
        sessionId: 'session-1',
        output: 'before pause',
        frame: {
          tabId: 'python-tab',
          line: 2,
          reason: 'user-breakpoint',
          locals: { a: '1' },
          callStack: [{ functionName: '<module>', line: 2 }],
          watchResults: { 'a + b': { value: '3' } },
        },
      })),
      command: vi.fn(async () => ({
        kind: 'finished',
        sessionId: 'session-1',
        output: '3',
      })),
    });
    window.lingua = {
      platform: 'darwin',
      pythonDebugger: nativeBridge,
    } as unknown as LinguaAPI;
    const onConsole = vi.fn();

    const execution = executePythonDebugSession(tab, onConsole);
    await vi.waitFor(() => {
      expect(useDebuggerStore.getState().pausedFrame?.line).toBe(2);
    });
    expect(useDebuggerStore.getState().session?.runtime).toBe('python');
    expect(isPythonDebuggerActive()).toBe(true);
    expect(nativeBridge.start).toHaveBeenCalledWith(
      expect.objectContaining({ breakpoints: [2], watches: ['a + b'] })
    );

    expect(dispatchPythonDebuggerCommand('step-over')).toBe(true);
    const result = await execution;
    expect(nativeBridge.command).toHaveBeenCalledWith('session-1', 'step-over');
    expect(result).toMatchObject({ kind: 'success' });
    expect(result.stdout.map(output => output.args[0])).toEqual(['before pause', '3']);
    expect(onConsole).toHaveBeenCalledTimes(2);
    expect(isPythonDebuggerActive()).toBe(false);
    expect(useDebuggerStore.getState().session).toBeNull();
  });

  it('surfaces native startup diagnostics and truncation without attaching', async () => {
    const nativeBridge = bridge({
      start: vi.fn(async () => ({
        kind: 'error',
        reason: 'process-exited',
        output: 'SyntaxError: invalid syntax',
        outputTruncated: true,
      })),
    });
    window.lingua = {
      platform: 'darwin',
      pythonDebugger: nativeBridge,
    } as unknown as LinguaAPI;
    const onConsole = vi.fn();

    const result = await executePythonDebugSession(tab, onConsole);

    expect(result.kind).toBe('error');
    expect(result.stdout).toHaveLength(2);
    expect(result.stdout[0]?.args[0]).toContain('SyntaxError');
    expect(result.stdout[1]?.type).toBe('warn');
    expect(onConsole).toHaveBeenCalledTimes(2);
    expect(useDebuggerStore.getState().session).toBeNull();
  });

  it('settles an exception pause during run-to-end without orphaning debugger state', async () => {
    const nativeBridge = bridge({
      start: vi.fn(async () => ({
        kind: 'paused',
        sessionId: 'session-exception',
        output: '',
        frame: {
          tabId: 'python-tab',
          line: 2,
          reason: 'user-breakpoint',
          locals: { a: '1' },
          callStack: [{ functionName: '<module>', line: 2 }],
          watchResults: {},
        },
      })),
      command: vi.fn(async () => ({
        kind: 'paused',
        sessionId: 'session-exception',
        output: 'ValueError: boom',
        frame: {
          tabId: 'python-tab',
          line: 3,
          reason: 'exception',
          locals: {},
          callStack: [{ functionName: '<module>', line: 3 }],
          watchResults: {},
        },
      })),
    });
    window.lingua = {
      platform: 'darwin',
      pythonDebugger: nativeBridge,
    } as unknown as LinguaAPI;

    const execution = executePythonDebugSession(tab);
    await vi.waitFor(() => expect(isPythonDebuggerActive()).toBe(true));
    expect(runPythonDebuggerToEnd()).toBe(true);
    useDebuggerStore.getState().detachSession();
    const result = await execution;

    expect(result).toMatchObject({ kind: 'error' });
    expect(result.stdout[0]?.args[0]).toContain('ValueError');
    expect(nativeBridge.stop).toHaveBeenCalledWith('session-exception');
    expect(useDebuggerStore.getState().session).toBeNull();
    expect(useDebuggerStore.getState().pausedFrame).toBeNull();
    expect(isPythonDebuggerActive()).toBe(false);
  });

  it('returns an honest desktop-only failure when the preload bridge is absent', async () => {
    window.lingua = { platform: 'web' } as unknown as LinguaAPI;

    const result = await executePythonDebugSession(tab);

    expect(result).toMatchObject({ kind: 'error' });
    expect(result.error?.message).toMatch(/desktop/i);
  });
});
