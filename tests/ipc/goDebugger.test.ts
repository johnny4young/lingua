import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const fixturePath = path.join(process.cwd(), 'tests', '__fixtures__', 'fake-dlv.mjs');
let binDir: string;
let previousPath: string | undefined;

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
}));

function sender(id: number) {
  return { id, once: vi.fn(), isDestroyed: vi.fn(() => false) };
}

beforeAll(() => {
  chmodSync(fixturePath, 0o755);
  binDir = mkdtempSync(path.join(tmpdir(), 'lingua-fake-dlv-'));
  const wrapper = path.join(binDir, process.platform === 'win32' ? 'dlv.exe' : 'dlv');
  writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${fixturePath}" "$@"\n`);
  chmodSync(wrapper, 0o755);
  previousPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ''}`;
});

afterAll(() => {
  process.env.PATH = previousPath;
  rmSync(binDir, { recursive: true, force: true });
});

beforeEach(async () => {
  vi.resetModules();
  handlers.clear();
  const { registerGoDebuggerHandlers } = await import('../../src/main/ipc/goDebugger');
  registerGoDebuggerHandlers();
});

afterEach(async () => {
  const { disposeGoDebuggerSessions } = await import('../../src/main/ipc/goDebugger');
  disposeGoDebuggerSessions();
});

describe('Go debugger IPC lifecycle', () => {
  it('classifies macOS Developer Mode diagnostics case-insensitively', async () => {
    const { classifyGoDebuggerStartFailure } = await import('../../src/main/ipc/goDebugger');

    expect(
      classifyGoDebuggerStartFailure(new Error('Developer Mode is disabled'), 'darwin')
    ).toBe('permission-required');
    expect(
      classifyGoDebuggerStartFailure(new Error('Operation not permitted'), 'darwin')
    ).toBe('permission-required');
    expect(classifyGoDebuggerStartFailure(new Error('build failed'), 'linux')).toBe(
      'command-failed'
    );
  });

  it('starts at a breakpoint, inspects state, steps, and finishes', async () => {
    const owner = sender(31);
    const start = handlers.get('debugger:go:start');
    const command = handlers.get('debugger:go:command');
    const started = await start?.(
      { sender: owner },
      {
        tabId: 'go-tab',
        fileName: 'main.go',
        source: 'package main\nfunc main() {\n\tvalue := 2\n\tprintln(value)\n}\n',
        breakpoints: [4],
        watches: ['value * 2'],
      }
    );

    expect(started).toMatchObject({
      kind: 'paused',
      frame: {
        tabId: 'go-tab',
        line: 4,
        locals: { value: '2' },
        watchResults: { 'value * 2': { value: '4' } },
      },
    });
    if (!started || typeof started !== 'object' || !('sessionId' in started)) {
      throw new Error('Expected a started Go debugger session');
    }
    await expect(command?.({ sender: owner }, started.sessionId, 'step-over')).resolves.toMatchObject({
      kind: 'paused',
      frame: { line: 5, reason: 'step' },
    });
    await expect(command?.({ sender: owner }, started.sessionId, 'continue')).resolves.toMatchObject({
      kind: 'finished',
      output: expect.stringContaining('result 2'),
    });
  });

  it('rejects missing breakpoints and commands from a different owner', async () => {
    const owner = sender(41);
    const start = handlers.get('debugger:go:start');
    const command = handlers.get('debugger:go:command');
    await expect(
      start?.(
        { sender: owner },
        { tabId: 'go-tab', fileName: 'main.go', source: 'package main\n', breakpoints: [] }
      )
    ).resolves.toEqual({ kind: 'error', reason: 'no-breakpoints' });

    const started = await start?.(
      { sender: owner },
      {
        tabId: 'go-tab',
        fileName: 'main.go',
        source: 'package main\nfunc main() {\n\tprintln(2)\n}\n',
        breakpoints: [3],
        watches: [],
      }
    );
    if (!started || typeof started !== 'object' || !('sessionId' in started)) {
      throw new Error('Expected a started Go debugger session');
    }
    await expect(command?.({ sender: sender(42) }, started.sessionId, 'continue')).resolves.toEqual({
      kind: 'error',
      reason: 'session-not-found',
    });
  });
});
