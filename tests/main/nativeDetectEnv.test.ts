import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ handle: vi.fn(), spawnNative: vi.fn() }));

vi.mock('../../src/main/runners/spawnNativeRun', () => ({ spawnNativeRun: mocks.spawnNative }));

vi.mock('electron', () => ({
  ipcMain: {
    handle: mocks.handle,
  },
}));

import { registerGoHandlers } from '../../src/main/go-compiler';
import { registerRustHandlers } from '../../src/main/rust-compiler';

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
    mocks.handle.mockReset();
    mocks.spawnNative.mockReset();
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
    mocks.spawnNative.mockImplementation(async ({ args }) => ({
      stdout: args[0] === 'version' ? 'go version go1.22.0 darwin/arm64\n' : '/usr/local/go\n',
      stderr: '', exitCode: 0, timedOut: false, killed: false,
    }));
    registerGoHandlers();

    const detect = handlerFor<[unknown, Record<string, string>], GoDetectResult>('go:detect');
    const result = await detect({}, { GOPATH: '/tmp/go-path' });

    expect(result.installed).toBe(true);
    expect(mocks.spawnNative).toHaveBeenCalledTimes(2);
    for (const call of mocks.spawnNative.mock.calls) {
      const options = call[0] as { env?: NodeJS.ProcessEnv };
      expect(options.env?.PATH).toBe('/usr/bin');
      expect(options.env?.GOPATH).toBe('/tmp/go-path');
      expect(options.env?.LINGUA_SMOKE_SECRET).toBeUndefined();
    }
  });

  it('filters host secrets from the Rust detection subprocess', async () => {
    mocks.spawnNative.mockResolvedValue({ stdout: 'rustc 1.78.0\n', stderr: '', exitCode: 0, timedOut: false, killed: false });
    registerRustHandlers();

    const detect = handlerFor<[unknown, Record<string, string>], RustDetectResult>('rust:detect');
    const result = await detect({}, { CARGO_HOME: '/tmp/cargo-home' });

    expect(result.installed).toBe(true);
    expect(mocks.spawnNative).toHaveBeenCalledTimes(1);
    const options = mocks.spawnNative.mock.calls[0]![0] as { env?: NodeJS.ProcessEnv };
    expect(options.env?.PATH).toBe('/usr/bin');
    expect(options.env?.CARGO_HOME).toBe('/tmp/cargo-home');
    expect(options.env?.LINGUA_SMOKE_SECRET).toBeUndefined();
  });

  it.each([
    ['go:detect', registerGoHandlers],
    ['rust:detect', registerRustHandlers],
  ] as const)('separates absent binaries from failed %s probes', async (channel, register) => {
    register();
    const detect = handlerFor<[unknown, Record<string, string>], GoDetectResult | RustDetectResult>(channel);
    mocks.spawnNative.mockResolvedValueOnce({
      stdout: '', stderr: '', exitCode: -1, timedOut: false, killed: false,
      spawnError: Object.assign(new Error('not found'), { code: 'ENOENT' }),
    });
    expect(await detect({}, {})).toMatchObject({ installed: false, reason: 'missing' });

    mocks.spawnNative.mockResolvedValueOnce({
      stdout: '', stderr: '', exitCode: -1, timedOut: true, killed: false,
    });
    expect(await detect({}, {})).toMatchObject({ installed: false, reason: 'check-failed' });
  });
});
