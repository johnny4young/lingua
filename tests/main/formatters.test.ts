/**
 * Registration smoke test for the main-process formatter handlers. The
 * subprocess interop (spawn → stdin → stdout/stderr) is covered end-to-end
 * in the renderer's formatter unit suite where the IPC bridge is mocked.
 * Here we only verify that the main module registers the expected IPC
 * channels and exposes a cache reset helper for lifecycle control.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const ipcHandlers = new Map<string, unknown>();
const execFileMock = vi.fn();
const spawnMock = vi.fn();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: unknown) => {
      ipcHandlers.set(channel, handler);
    },
  },
}));

vi.mock('node:child_process', async () => ({
  execFile: execFileMock,
  spawn: spawnMock,
  default: {
    execFile: execFileMock,
    spawn: spawnMock,
  },
}));

function createSpawnProcess({
  stdout = '',
  stderr = '',
  exitCode = 0,
}: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: {
      on: (event: string, handler: (...args: unknown[]) => void) => void;
      end: (source: string, encoding: BufferEncoding) => void;
    };
  };

  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    on: vi.fn(),
    end: vi.fn((_source: string, _encoding: BufferEncoding) => {
      if (stdout) {
        child.stdout.emit('data', Buffer.from(stdout));
      }
      if (stderr) {
        child.stderr.emit('data', Buffer.from(stderr));
      }
      child.emit('close', exitCode);
    }),
  };

  return child;
}

describe('main/formatters', () => {
  beforeEach(() => {
    ipcHandlers.clear();
    execFileMock.mockReset();
    spawnMock.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers the gofmt, rustfmt, and python IPC handlers', async () => {
    const { registerFormatterHandlers } = await import('../../src/main/formatters');
    registerFormatterHandlers();

    expect(ipcHandlers.get('format:gofmt')).toBeTypeOf('function');
    expect(ipcHandlers.get('format:rustfmt')).toBeTypeOf('function');
    expect(ipcHandlers.get('format:python')).toBeTypeOf('function');
  });

  it('exposes a cache reset helper for test lifecycles', async () => {
    const { resetFormatterAvailabilityCache } = await import('../../src/main/formatters');
    expect(() => resetFormatterAvailabilityCache()).not.toThrow();
  });

  it('falls back to black when ruff is unavailable for Python formatting', async () => {
    execFileMock.mockImplementation(
      (binary: string, _args: readonly string[], callback: (error: Error | null) => void) => {
        if (binary === 'ruff') {
          callback(new Error('not found'));
          return;
        }
        callback(null);
      }
    );
    spawnMock.mockImplementation((binary: string) =>
      createSpawnProcess({
        stdout: binary === 'black' ? 'x = 1\n' : '',
      })
    );

    const { registerFormatterHandlers } = await import('../../src/main/formatters');
    registerFormatterHandlers();

    const pythonHandler = ipcHandlers.get('format:python') as
      | ((event: unknown, source: string) => Promise<FormatIpcResult>)
      | undefined;

    expect(pythonHandler).toBeTypeOf('function');
    const result = await pythonHandler?.({}, 'x=1');

    expect(execFileMock).toHaveBeenNthCalledWith(1, 'ruff', ['--version'], expect.any(Function));
    expect(execFileMock).toHaveBeenNthCalledWith(2, 'black', ['--version'], expect.any(Function));
    expect(spawnMock).toHaveBeenCalledWith(
      'black',
      ['--quiet', '-'],
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'], timeout: 15_000 })
    );
    expect(result).toEqual({
      available: true,
      success: true,
      formatted: 'x = 1\n',
    });
  });

  it('returns binary-missing for Python when neither ruff nor black is installed', async () => {
    execFileMock.mockImplementation(
      (_binary: string, _args: readonly string[], callback: (error: Error | null) => void) => {
        callback(new Error('not found'));
      }
    );

    const { registerFormatterHandlers } = await import('../../src/main/formatters');
    registerFormatterHandlers();

    const pythonHandler = ipcHandlers.get('format:python') as
      | ((event: unknown, source: string) => Promise<FormatIpcResult>)
      | undefined;

    expect(pythonHandler).toBeTypeOf('function');
    const result = await pythonHandler?.({}, 'print(1)');

    expect(spawnMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      available: false,
      reason: 'binary-missing',
      error:
        'No Python formatter available on PATH. Install ruff (https://docs.astral.sh/ruff/) or black (https://pypi.org/project/black/) to enable Python formatting.',
    });
  });
});
