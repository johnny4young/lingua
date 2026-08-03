import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
}));

function hasPython(): boolean {
  return ['python3', 'python'].some(candidate => {
    const probe = spawnSync(candidate, ['--version']);
    return probe.status === 0 && probe.error === undefined;
  });
}

const describeReal = hasPython() ? describe : describe.skip;

function sender(id: number) {
  return {
    id,
    once: vi.fn(),
    isDestroyed: vi.fn(() => false),
  };
}

describeReal('Python debugger IPC lifecycle', () => {
  beforeEach(async () => {
    vi.resetModules();
    handlers.clear();
    const { registerPythonDebuggerHandlers } = await import('../../src/main/ipc/pythonDebugger');
    registerPythonDebuggerHandlers();
  });

  afterEach(async () => {
    const { disposePythonDebuggerSessions } = await import('../../src/main/ipc/pythonDebugger');
    disposePythonDebuggerSessions();
  });

  it('starts at a breakpoint, inspects state, steps, and finishes', async () => {
    const owner = sender(7);
    const start = handlers.get('debugger:python:start');
    const command = handlers.get('debugger:python:command');
    const syncWatches = handlers.get('debugger:python:sync-watches');

    const started = await start?.(
      { sender: owner },
      {
        tabId: 'python-tab',
        fileName: 'main.py',
        source: [
          'x = 1',
          'y = 2',
          'def add(a, b):',
          '    total = a + b',
          '    return total',
          'z = add(x, y)',
          'print("result", z)',
          '',
        ].join('\n'),
        breakpoints: [4],
        watches: ['a + b'],
      }
    );

    expect(started).toMatchObject({
      kind: 'paused',
      frame: {
        tabId: 'python-tab',
        line: 4,
        reason: 'user-breakpoint',
        locals: { a: '1', b: '2' },
        watchResults: { 'a + b': { value: '3' } },
      },
    });
    if (!started || typeof started !== 'object' || !('sessionId' in started)) {
      throw new Error('Expected a started Python debugger session');
    }

    const stepped = await command?.({ sender: owner }, started.sessionId, 'step-over');
    expect(stepped).toMatchObject({
      kind: 'paused',
      frame: {
        line: 5,
        reason: 'step',
        locals: { total: '3' },
      },
    });

    const refreshed = await syncWatches?.({ sender: owner }, started.sessionId, ['total']);
    expect(refreshed).toMatchObject({
      kind: 'paused',
      frame: {
        line: 5,
        reason: 'step',
        watchResults: { total: { value: '3' } },
      },
    });

    const finished = await command?.({ sender: owner }, started.sessionId, 'continue');
    expect(finished).toMatchObject({
      kind: 'finished',
      output: expect.stringContaining('result 3'),
    });
  });

  it('binds commands to the renderer owner and rejects missing breakpoints', async () => {
    const start = handlers.get('debugger:python:start');
    const command = handlers.get('debugger:python:command');
    const owner = sender(11);
    const rejected = await start?.(
      { sender: owner },
      {
        tabId: 'python-tab',
        fileName: 'main.py',
        source: 'print("ok")\n',
        breakpoints: [],
        watches: [],
      }
    );
    expect(rejected).toEqual({ kind: 'error', reason: 'no-breakpoints' });

    const started = await start?.(
      { sender: owner },
      {
        tabId: 'python-tab',
        fileName: 'main.py',
        source: 'value = 1\nprint(value)\n',
        breakpoints: [2],
        watches: [],
      }
    );
    if (!started || typeof started !== 'object' || !('sessionId' in started)) {
      throw new Error('Expected a started Python debugger session');
    }
    expect(await command?.({ sender: sender(12) }, started.sessionId, 'continue')).toEqual({
      kind: 'error',
      reason: 'session-not-found',
    });
  });

  it('reports syntax failures with pdb output instead of a successful run', async () => {
    const start = handlers.get('debugger:python:start');
    const response = await start?.(
      { sender: sender(21) },
      {
        tabId: 'syntax-tab',
        fileName: 'syntax.py',
        source: 'if True print("bad")\n',
        breakpoints: [1],
        watches: [],
      }
    );

    expect(response).toMatchObject({
      kind: 'error',
      reason: 'process-exited',
      output: expect.stringContaining('SyntaxError'),
    });
  });
});
