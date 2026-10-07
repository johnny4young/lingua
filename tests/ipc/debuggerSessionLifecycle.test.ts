import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const terminated = vi.fn();
const inspectFailure = new Error('no frame for the current source');
const inspectMode = { reject: true };
const pausedFrame = { tabId: 'tab', line: 3, reason: 'user-breakpoint', locals: {}, callStack: [], watchResults: {} };

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
}));

vi.mock('../../src/main/runners/spawnNativeRun', () => ({
  spawnNativeRun: async () => ({
    stdout: '',
    stderr: '',
    exitCode: 0,
    executionTime: 0,
    timedOut: false,
    killed: false,
  }),
}));

class FakeDapSession {
  start() {
    return Promise.resolve({ kind: 'stopped', threadId: 1, reason: 'breakpoint' });
  }
  command() {
    return Promise.resolve({ kind: 'stopped', threadId: 1, reason: 'step' });
  }
  inspect() {
    return inspectMode.reject ? Promise.reject(inspectFailure) : Promise.resolve(pausedFrame);
  }
  drainOutput() {
    return { output: '', outputTruncated: false };
  }
  setBreakpoints(lines: number[]) {
    return Promise.resolve(lines);
  }
  terminate() {
    terminated();
  }
}

vi.mock('../../src/main/goDebugger', () => ({
  resolveDelveBinary: async () => ({ command: 'dlv', version: 'fake' }),
  GoDebugSession: FakeDapSession,
}));

vi.mock('../../src/main/rustDebugger', () => ({
  resolveRustCompiler: async () => ({ command: 'rustc' }),
  resolveLldbDapBinary: async () => ({ command: 'lldb-dap' }),
  RustDebugSession: FakeDapSession,
}));

vi.mock('../../src/main/pythonDebugger', () => ({
  parsePdbStack: () => [],
  PythonDebugSession: class {
    start() {
      return Promise.resolve({ output: '', outputTruncated: false, finished: false });
    }
    setBreakpoint(line: number) {
      return Promise.resolve({ output: `Breakpoint 1 at main.py:${line}` });
    }
    continue() {
      return Promise.resolve({
        output: '',
        outputTruncated: false,
        finished: false,
        location: { file: 'main.py', line: 3, func: '<module>' },
      });
    }
    sendCommand() {
      return inspectMode.reject ? Promise.reject(inspectFailure) : Promise.resolve({ output: '{}' });
    }
    terminate() {
      terminated();
    }
  },
}));

function sender(id: number) {
  return { id, once: vi.fn(), removeListener: vi.fn(), isDestroyed: vi.fn(() => false) };
}

beforeEach(() => {
  vi.resetModules();
  handlers.clear();
  terminated.mockClear();
  inspectMode.reject = true;
});

const cases = [
  { language: 'go', fileName: 'main.go', module: '../../src/main/ipc/goDebugger' },
  { language: 'rust', fileName: 'main.rs', module: '../../src/main/ipc/rustDebugger' },
  { language: 'python', fileName: 'main.py', module: '../../src/main/ipc/pythonDebugger' },
] as const;

describe('debugger IPC session lifecycle', () => {
  it.each(cases)('removes the $language session when the first paused inspect rejects', async ({
    language,
    fileName,
    module,
  }) => {
    const ipc = (await import(module)) as Record<string, () => void>;
    const register = Object.entries(ipc).find(([name]) => /^register.*Handlers$/u.test(name))?.[1];
    register?.();
    const owner = sender(5);
    const sessionId = `${language}-inspect-failure`;

    const started = await handlers.get(`debugger:${language}:start`)?.(
      { sender: owner },
      { sessionId, tabId: 'tab', fileName, source: 'x = 1\n', breakpoints: [3] }
    );

    expect(started).toMatchObject({
      kind: 'error',
      reason: 'command-failed',
      message: inspectFailure.message,
    });
    expect(terminated).toHaveBeenCalled();
    await expect(
      handlers.get(`debugger:${language}:stop`)?.({ sender: owner }, sessionId)
    ).resolves.toEqual({ kind: 'error', reason: 'session-not-found' });
  });

  it.each(cases)('ends the paused $language session when its renderer reloads', async ({
    language,
    fileName,
    module,
  }) => {
    inspectMode.reject = false;
    const ipc = (await import(module)) as Record<string, () => void>;
    const register = Object.entries(ipc).find(([name]) => /^register.*Handlers$/u.test(name))?.[1];
    register?.();
    const owner = Object.assign(new EventEmitter(), { id: 6, isDestroyed: () => false });
    const sessionId = `${language}-reload`;

    await expect(
      handlers.get(`debugger:${language}:start`)?.(
        { sender: owner },
        { sessionId, tabId: 'tab', fileName, source: 'x = 1\n', breakpoints: [3] }
      )
    ).resolves.toMatchObject({ kind: 'paused', sessionId });

    owner.emit('did-navigate');
    expect(terminated).toHaveBeenCalled();
    await expect(
      handlers.get(`debugger:${language}:stop`)?.({ sender: owner }, sessionId)
    ).resolves.toEqual({ kind: 'error', reason: 'session-not-found' });
  });
});
