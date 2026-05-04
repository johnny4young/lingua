import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const execFileAsync = vi.fn();
  const execFile = Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: execFileAsync,
  });
  return {
    execFile,
    execFileAsync,
    handle: vi.fn(),
  };
});

vi.mock('node:child_process', () => ({
  default: {
    execFile: mocks.execFile,
    spawn: vi.fn(),
  },
  execFile: mocks.execFile,
  spawn: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: mocks.handle,
  },
}));

import { registerGoHandlers } from '../../src/main/go-compiler';
import { registerRustHandlers } from '../../src/main/rust-compiler';

function completeExecFile(
  stdoutByCommand: Record<string, string>
): typeof mocks.execFileAsync {
  return mocks.execFileAsync.mockImplementation(
    async (command: string, args: string[], _options: unknown) => {
      const key = [command, ...args].join(' ');
      return { stdout: stdoutByCommand[key] ?? '', stderr: '' };
    }
  );
}

function handlerFor<TArgs extends unknown[], TResult>(
  channel: string
): (...args: TArgs) => Promise<TResult> {
  const match = mocks.handle.mock.calls.find(([name]) => name === channel);
  if (!match) {
    throw new Error(`Missing IPC handler for ${channel}`);
  }
  return match[1] as (...args: TArgs) => Promise<TResult>;
}

describe('native toolchain detection env', () => {
  const savedEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    mocks.execFile.mockReset();
    mocks.execFileAsync.mockReset();
    mocks.handle.mockReset();
    for (const key of ['PATH', 'LINGUA_SMOKE_SECRET']) {
      savedEnv.set(key, process.env[key]);
    }
    process.env.PATH = '/usr/bin';
    process.env.LINGUA_SMOKE_SECRET = '__lingua_smoke_secret__';
  });

  afterEach(() => {
    for (const [key, value] of savedEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    savedEnv.clear();
  });

  it('filters host secrets from the Go detection subprocesses', async () => {
    completeExecFile({
      'go version': 'go version go1.22.0 darwin/arm64\n',
      'go env GOROOT': '/usr/local/go\n',
    });
    registerGoHandlers();

    const detect = handlerFor<[unknown, Record<string, string>], GoDetectResult>('go:detect');
    const result = await detect(null, { GOPATH: '/tmp/go-path' });

    expect(result.installed).toBe(true);
    expect(mocks.execFileAsync).toHaveBeenCalledTimes(2);
    for (const call of mocks.execFileAsync.mock.calls) {
      const options = call[2] as { env?: NodeJS.ProcessEnv };
      expect(options.env?.PATH).toBe('/usr/bin');
      expect(options.env?.GOPATH).toBe('/tmp/go-path');
      expect(options.env?.LINGUA_SMOKE_SECRET).toBeUndefined();
    }
  });

  it('filters host secrets from the Rust detection subprocess', async () => {
    completeExecFile({
      'rustc --version': 'rustc 1.78.0\n',
    });
    registerRustHandlers();

    const detect = handlerFor<[unknown, Record<string, string>], RustDetectResult>('rust:detect');
    const result = await detect(null, { CARGO_HOME: '/tmp/cargo-home' });

    expect(result.installed).toBe(true);
    expect(mocks.execFileAsync).toHaveBeenCalledTimes(1);
    const options = mocks.execFileAsync.mock.calls[0][2] as { env?: NodeJS.ProcessEnv };
    expect(options.env?.PATH).toBe('/usr/bin');
    expect(options.env?.CARGO_HOME).toBe('/tmp/cargo-home');
    expect(options.env?.LINGUA_SMOKE_SECRET).toBeUndefined();
  });
});
