import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RustDebuggerBridge } from '@/../shared/rustDebugger';
import {
  dispatchRustDebuggerCommand,
  executeRustDebugSession,
  isRustDebuggerActive,
  syncRustDebuggerWatches,
} from '@/runtime/rustDebuggerBridge';
import { useDebuggerStore } from '@/stores/debuggerStore';
import type { FileTab } from '@/types/editor';

const originalLingua = window.lingua;

const tab: FileTab = {
  id: 'rust-tab',
  name: 'main.rs',
  language: 'rust',
  content: 'fn main() {\n    let value = 2;\n    println!("{value}");\n}\n',
  isDirty: true,
  workflowMode: 'debug',
};

function bridge(overrides: Partial<RustDebuggerBridge> = {}): RustDebuggerBridge {
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
      'rust-tab:4': {
        tabId: 'rust-tab',
        line: 4,
        condition: '',
        mode: 'pause',
        logMessage: '',
        enabled: true,
      },
    },
    breakpointOrder: ['rust-tab:4'],
    watches: [{ id: 'watch-rust', expression: 'value * 2' }],
    session: null,
    pausedFrame: null,
  });
});

afterEach(() => {
  window.lingua = originalLingua;
  useDebuggerStore.getState().detachSession();
});

describe('rustDebuggerBridge', () => {
  it('attaches on pause, exposes values, routes a step, and settles', async () => {
    const nativeBridge = bridge({
      start: vi.fn(async () => ({
        kind: 'paused',
        sessionId: 'rust-session',
        output: '',
        frame: {
          tabId: 'rust-tab',
          line: 4,
          reason: 'user-breakpoint',
          locals: { value: '2' },
          callStack: [{ functionName: 'main::main', line: 4 }],
          watchResults: { 'value * 2': { value: '4' } },
        },
      })),
      command: vi.fn(async () => ({
        kind: 'finished',
        sessionId: 'rust-session',
        output: '2\n',
      })),
    });
    window.lingua = { platform: 'darwin', rustDebugger: nativeBridge } as unknown as LinguaAPI;

    const execution = executeRustDebugSession(tab);
    await vi.waitFor(() => expect(useDebuggerStore.getState().pausedFrame?.line).toBe(4));
    expect(useDebuggerStore.getState().session?.runtime).toBe('rust');
    expect(nativeBridge.start).toHaveBeenCalledWith(
      expect.objectContaining({ breakpoints: [4], watches: ['value * 2'] })
    );
    expect(dispatchRustDebuggerCommand('step-over')).toBe(true);

    await expect(execution).resolves.toMatchObject({ kind: 'success' });
    expect(nativeBridge.command).toHaveBeenCalledWith('rust-session', 'step-over');
    expect(isRustDebuggerActive()).toBe(false);
  });

  it('surfaces the actionable macOS permission failure without attaching', async () => {
    const nativeBridge = bridge({
      start: vi.fn(async () => ({ kind: 'error', reason: 'permission-required' })),
    });
    window.lingua = { platform: 'darwin', rustDebugger: nativeBridge } as unknown as LinguaAPI;

    const result = await executeRustDebugSession(tab);

    expect(result).toMatchObject({ kind: 'error' });
    expect(result.error?.message).toMatch(/macOS|LLDB/i);
    expect(useDebuggerStore.getState().session).toBeNull();
  });

  it('ignores a stale watch refresh after execution resumes', async () => {
    let resolveWatch: ((value: Awaited<ReturnType<RustDebuggerBridge['syncWatches']>>) => void) | null =
      null;
    let resolveCommand: ((value: Awaited<ReturnType<RustDebuggerBridge['command']>>) => void) | null =
      null;
    const nativeBridge = bridge({
      start: vi.fn(async () => ({
        kind: 'paused',
        sessionId: 'rust-session',
        output: '',
        frame: {
          tabId: 'rust-tab',
          line: 4,
          reason: 'user-breakpoint',
          locals: { value: '2' },
          callStack: [{ functionName: 'main::main', line: 4 }],
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
    window.lingua = { platform: 'darwin', rustDebugger: nativeBridge } as unknown as LinguaAPI;

    const execution = executeRustDebugSession(tab);
    await vi.waitFor(() => expect(useDebuggerStore.getState().pausedFrame?.line).toBe(4));
    expect(syncRustDebuggerWatches(['value * 2'])).toBe(true);
    expect(dispatchRustDebuggerCommand('continue')).toBe(true);

    resolveWatch?.({
      kind: 'paused',
      sessionId: 'rust-session',
      output: '',
      frame: {
        tabId: 'rust-tab',
        line: 99,
        reason: 'user-breakpoint',
        locals: { stale: 'true' },
        callStack: [{ functionName: 'stale.frame', line: 99 }],
        watchResults: { 'value * 2': { value: '4' } },
      },
    });
    await Promise.resolve();
    expect(useDebuggerStore.getState().pausedFrame).toBeNull();

    resolveCommand?.({ kind: 'finished', sessionId: 'rust-session', output: 'result 2\n' });
    await expect(execution).resolves.toMatchObject({ kind: 'success' });
    expect(useDebuggerStore.getState().pausedFrame).toBeNull();
  });

  it('returns an honest desktop-only failure without a preload bridge', async () => {
    window.lingua = { platform: 'web' } as unknown as LinguaAPI;
    const result = await executeRustDebugSession(tab);
    expect(result).toMatchObject({ kind: 'error' });
    expect(result.error?.message).toMatch(/desktop/i);
  });
});
