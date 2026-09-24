import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoDebuggerBridge } from '@/../shared/goDebugger';
import {
  dispatchGoDebuggerCommand,
  executeGoDebugSession,
  isGoDebuggerActive,
  syncGoDebuggerWatches,
  stopActiveGoDebugger,
} from '@/runtime/goDebuggerBridge';
import { useDebuggerStore } from '@/stores/debuggerStore';
import type { FileTab } from '@/types/editor';

const originalLingua = window.lingua;

const tab: FileTab = {
  id: 'go-tab',
  name: 'main.go',
  language: 'go',
  content: 'package main\nfunc main() {\n\tvalue := 2\n\tprintln(value)\n}\n',
  isDirty: true,
  workflowMode: 'debug',
};

function bridge(overrides: Partial<GoDebuggerBridge> = {}): GoDebuggerBridge {
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
      'go-tab:4': {
        tabId: 'go-tab',
        line: 4,
        condition: '',
        mode: 'pause',
        logMessage: '',
        enabled: true,
      },
    },
    breakpointOrder: ['go-tab:4'],
    watches: [{ id: 'watch-go', expression: 'value * 2' }],
    session: null,
    pausedFrame: null,
  });
});

afterEach(() => {
  window.lingua = originalLingua;
  useDebuggerStore.getState().detachSession();
});

describe('goDebuggerBridge', () => {
  it('attaches on pause, exposes values, routes a step, and settles', async () => {
    const nativeBridge = bridge({
      start: vi.fn(async () => ({
        kind: 'paused',
        sessionId: 'go-session',
        output: '',
        frame: {
          tabId: 'go-tab',
          line: 4,
          reason: 'user-breakpoint',
          locals: { value: '2' },
          callStack: [{ functionName: 'main.main', line: 4 }],
          watchResults: { 'value * 2': { value: '4' } },
        },
      })),
      command: vi.fn(async () => ({
        kind: 'finished',
        sessionId: 'go-session',
        output: '2\n',
      })),
    });
    window.lingua = { platform: 'darwin', goDebugger: nativeBridge } as unknown as LinguaAPI;

    const execution = executeGoDebugSession(tab);
    await vi.waitFor(() => expect(useDebuggerStore.getState().pausedFrame?.line).toBe(4));
    expect(useDebuggerStore.getState().session?.runtime).toBe('go');
    expect(nativeBridge.start).toHaveBeenCalledWith(
      expect.objectContaining({ breakpoints: [4], watches: ['value * 2'] })
    );
    expect(dispatchGoDebuggerCommand('step-over')).toBe(true);

    await expect(execution).resolves.toMatchObject({ kind: 'success' });
    expect(nativeBridge.command).toHaveBeenCalledWith('go-session', 'step-over');
    expect(isGoDebuggerActive()).toBe(false);
  });

  it('surfaces the actionable macOS permission failure without attaching', async () => {
    const nativeBridge = bridge({
      start: vi.fn(async () => ({ kind: 'error', reason: 'permission-required' })),
    });
    window.lingua = { platform: 'darwin', goDebugger: nativeBridge } as unknown as LinguaAPI;

    const result = await executeGoDebugSession(tab);

    expect(result).toMatchObject({ kind: 'error' });
    expect(result.error?.message).toMatch(/macOS|Delve/i);
    expect(useDebuggerStore.getState().session).toBeNull();
  });

  it('ignores a stale watch refresh after execution resumes', async () => {
    let resolveWatch: ((value: Awaited<ReturnType<GoDebuggerBridge['syncWatches']>>) => void) | null =
      null;
    let resolveCommand: ((value: Awaited<ReturnType<GoDebuggerBridge['command']>>) => void) | null =
      null;
    const nativeBridge = bridge({
      start: vi.fn(async () => ({
        kind: 'paused',
        sessionId: 'go-session',
        output: '',
        frame: {
          tabId: 'go-tab',
          line: 4,
          reason: 'user-breakpoint',
          locals: { value: '2' },
          callStack: [{ functionName: 'main.main', line: 4 }],
          watchResults: {},
        },
      })),
      syncWatches: vi.fn(
        () =>
          new Promise(resolve => {
            resolveWatch = resolve;
          })
      ),
      command: vi.fn(
        () =>
          new Promise(resolve => {
            resolveCommand = resolve;
          })
      ),
    });
    window.lingua = { platform: 'darwin', goDebugger: nativeBridge } as unknown as LinguaAPI;

    const execution = executeGoDebugSession(tab);
    await vi.waitFor(() => expect(useDebuggerStore.getState().pausedFrame?.line).toBe(4));
    expect(syncGoDebuggerWatches(['value * 2'])).toBe(true);
    expect(dispatchGoDebuggerCommand('continue')).toBe(true);

    resolveWatch?.({
      kind: 'paused',
      sessionId: 'go-session',
      output: '',
      frame: {
        tabId: 'go-tab',
        line: 99,
        reason: 'user-breakpoint',
        locals: { stale: 'true' },
        callStack: [{ functionName: 'stale.frame', line: 99 }],
        watchResults: { 'value * 2': { value: '4' } },
      },
    });
    await Promise.resolve();
    expect(useDebuggerStore.getState().pausedFrame).toBeNull();

    resolveCommand?.({ kind: 'finished', sessionId: 'go-session', output: 'result 2\n' });
    await expect(execution).resolves.toMatchObject({ kind: 'success' });
    expect(useDebuggerStore.getState().pausedFrame).toBeNull();
  });

  it('stops a pending start through its preallocated session identity', async () => {
    let resolveStart!: (response: Awaited<ReturnType<GoDebuggerBridge['start']>>) => void;
    const nativeBridge = bridge({
      start: vi.fn(() => new Promise(resolve => { resolveStart = resolve; })),
    });
    window.lingua = { platform: 'darwin', goDebugger: nativeBridge } as unknown as LinguaAPI;

    const execution = executeGoDebugSession(tab);
    await vi.waitFor(() => expect(nativeBridge.start).toHaveBeenCalledTimes(1));
    const request = vi.mocked(nativeBridge.start).mock.calls[0]![0];
    const stopped = stopActiveGoDebugger();
    resolveStart({ kind: 'stopped', sessionId: request.sessionId ?? 'missing-session' });
    const result = await execution;

    expect(request.sessionId).toEqual(expect.any(String));
    expect(stopped).toBe(true);
    expect(nativeBridge.stop).toHaveBeenCalledWith(request.sessionId);
    expect(result).toMatchObject({ kind: 'stopped', cancelled: true });
  });

  it('does not start a replacement after Stop wins while the previous start is cancelling', async () => {
    let resolveFirstStart!: (response: Awaited<ReturnType<GoDebuggerBridge['start']>>) => void;
    let resolveFirstStop!: (response: Awaited<ReturnType<GoDebuggerBridge['stop']>>) => void;
    const nativeBridge = bridge({
      start: vi.fn(() => new Promise(resolve => { resolveFirstStart = resolve; })),
      stop: vi.fn(sessionId => {
        if (vi.mocked(nativeBridge.start).mock.calls[0]?.[0].sessionId === sessionId) {
          return new Promise(resolve => { resolveFirstStop = resolve; });
        }
        return Promise.resolve({ kind: 'stopped', sessionId });
      }),
    });
    window.lingua = { platform: 'darwin', goDebugger: nativeBridge } as unknown as LinguaAPI;

    const first = executeGoDebugSession(tab);
    await vi.waitFor(() => expect(nativeBridge.start).toHaveBeenCalledTimes(1));
    const firstSessionId = vi.mocked(nativeBridge.start).mock.calls[0]![0].sessionId!;
    const replacement = executeGoDebugSession({ ...tab, id: 'replacement-tab' });
    await vi.waitFor(() => expect(nativeBridge.stop).toHaveBeenCalledWith(firstSessionId));

    expect(stopActiveGoDebugger()).toBe(true);
    const replacementSessionId = vi.mocked(nativeBridge.stop).mock.calls[1]![0];
    expect(replacementSessionId).not.toBe(firstSessionId);
    resolveFirstStop({ kind: 'stopped', sessionId: firstSessionId });
    resolveFirstStart({ kind: 'stopped', sessionId: firstSessionId });

    await expect(first).resolves.toMatchObject({ kind: 'stopped', cancelled: true });
    await expect(replacement).resolves.toMatchObject({ kind: 'stopped', cancelled: true });
    expect(nativeBridge.start).toHaveBeenCalledTimes(1);
  });

  it('returns an honest desktop-only failure without a preload bridge', async () => {
    window.lingua = { platform: 'web' } as unknown as LinguaAPI;
    const result = await executeGoDebugSession(tab);
    expect(result).toMatchObject({ kind: 'error' });
    expect(result.error?.message).toMatch(/desktop/i);
  });
});
