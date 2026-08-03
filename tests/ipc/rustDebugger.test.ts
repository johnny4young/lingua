import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const lldbFixturePath = path.join(process.cwd(), 'tests', '__fixtures__', 'fake-lldb-dap.mjs');
const rustcFixturePath = path.join(process.cwd(), 'tests', '__fixtures__', 'fake-rustc.mjs');
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
  chmodSync(lldbFixturePath, 0o755);
  chmodSync(rustcFixturePath, 0o755);
  binDir = mkdtempSync(path.join(tmpdir(), 'lingua-fake-rust-debug-'));
  for (const [name, fixture] of [
    [process.platform === 'win32' ? 'lldb-dap.exe' : 'lldb-dap', lldbFixturePath],
    [process.platform === 'win32' ? 'rustc.exe' : 'rustc', rustcFixturePath],
  ] as const) {
    const wrapper = path.join(binDir, name);
    writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`);
    chmodSync(wrapper, 0o755);
  }
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
  const { registerRustDebuggerHandlers } = await import('../../src/main/ipc/rustDebugger');
  registerRustDebuggerHandlers();
});

afterEach(async () => {
  const { disposeRustDebuggerSessions } = await import('../../src/main/ipc/rustDebugger');
  disposeRustDebuggerSessions();
});

describe('Rust debugger IPC lifecycle', () => {
  it('classifies macOS Developer Tools diagnostics case-insensitively', async () => {
    const { classifyRustDebuggerStartFailure } = await import('../../src/main/ipc/rustDebugger');

    expect(
      classifyRustDebuggerStartFailure(new Error('Not allowed to attach to process'), 'darwin')
    ).toBe('permission-required');
    expect(
      classifyRustDebuggerStartFailure(new Error('Operation not permitted'), 'darwin')
    ).toBe('permission-required');
    expect(classifyRustDebuggerStartFailure(new Error('build failed'), 'linux')).toBe(
      'command-failed'
    );
  });

  it('starts at a breakpoint, inspects state, steps, and finishes', async () => {
    const owner = sender(31);
    const start = handlers.get('debugger:rust:start');
    const command = handlers.get('debugger:rust:command');
    const started = await start?.(
      { sender: owner },
      {
        tabId: 'rust-tab',
        fileName: 'main.rs',
        source: 'fn main() {\n    let value = 2;\n    println!("{value}");\n}\n',
        breakpoints: [3],
        watches: ['value * 2'],
      }
    );

    expect(started).toMatchObject({
      kind: 'paused',
      frame: {
        tabId: 'rust-tab',
        line: 3,
        locals: { value: '2' },
        watchResults: { 'value * 2': { value: '4' } },
      },
    });
    if (!started || typeof started !== 'object' || !('sessionId' in started)) {
      throw new Error('Expected a started Rust debugger session');
    }
    await expect(command?.({ sender: owner }, started.sessionId, 'step-over')).resolves.toMatchObject({
      kind: 'paused',
      frame: { line: 4, reason: 'step' },
    });
    await expect(command?.({ sender: owner }, started.sessionId, 'continue')).resolves.toMatchObject({
      kind: 'finished',
      output: expect.stringContaining('result 2'),
    });
  });

  it('rejects missing breakpoints and commands from a different owner', async () => {
    const owner = sender(41);
    const start = handlers.get('debugger:rust:start');
    const command = handlers.get('debugger:rust:command');
    await expect(
      start?.(
        { sender: owner },
        { tabId: 'rust-tab', fileName: 'main.rs', source: 'fn main() {}\n', breakpoints: [] }
      )
    ).resolves.toEqual({ kind: 'error', reason: 'no-breakpoints' });

    const started = await start?.(
      { sender: owner },
      {
        tabId: 'rust-tab',
        fileName: 'main.rs',
        source: 'fn main() {\n    println!("2");\n}\n',
        breakpoints: [2],
        watches: [],
      }
    );
    if (!started || typeof started !== 'object' || !('sessionId' in started)) {
      throw new Error('Expected a started Rust debugger session');
    }
    await expect(command?.({ sender: sender(42) }, started.sessionId, 'continue')).resolves.toEqual({
      kind: 'error',
      reason: 'session-not-found',
    });
  });

  it('returns bounded compiler diagnostics without starting LLDB', async () => {
    const start = handlers.get('debugger:rust:start');
    await expect(
      start?.(
        { sender: sender(51) },
        {
          tabId: 'rust-tab',
          fileName: 'my-file.rs',
          source: 'compile_error!("fixture");\nfn main() {}\n',
          breakpoints: [2],
          watches: [],
        }
      )
    ).resolves.toMatchObject({
      kind: 'error',
      reason: 'compile-failed',
      output: expect.stringContaining('fixture compile failure'),
    });
  });
});
