/**
 * internal — Rust compile + run env merge under the minimal allowlist.
 *
 * Same shape as go-compiler.test.ts, minus the runner-owned keys:
 * Rust does not claim any env variables for itself, so the user env
 * is the last tier in the merge.
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  mockHandle: vi.fn(),
}));

const cpMocks = vi.hoisted(() => {
  const execFileAsync = vi.fn();
  const execFile = Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: execFileAsync,
  });
  return { execFile, execFileAsync, spawn: vi.fn() };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMocks.mockHandle,
  },
}));

vi.mock('node:child_process', () => ({
  default: { execFile: cpMocks.execFile, spawn: cpMocks.spawn },
  execFile: cpMocks.execFile,
  spawn: cpMocks.spawn,
}));

import { registerRustHandlers, resolveRustRunEnv } from '../../src/main/rust-compiler';

describe('main rust compiler env resolver (internal minimal allowlist)', () => {
  const SECRET = 'LINGUA_SMOKE_SECRET';
  const INJECTED = 'LINGUA_TEST_RUST_INJECT';
  const ALLOWED = 'CARGO_HOME';
  const savedAllowed = process.env[ALLOWED];

  beforeEach(() => {
    process.env[SECRET] = '__lingua_smoke_secret__';
    process.env[ALLOWED] = '/home/test/.cargo';
    delete process.env[INJECTED];
  });

  afterEach(() => {
    delete process.env[SECRET];
    delete process.env[INJECTED];
    if (savedAllowed === undefined) {
      delete process.env[ALLOWED];
    } else {
      process.env[ALLOWED] = savedAllowed;
    }
  });

  it('drops non-allowlisted host keys (the secret-leak gate)', () => {
    const resolved = resolveRustRunEnv();
    expect('LINGUA_SMOKE_SECRET' in resolved).toBe(false);
    expect(resolved[ALLOWED]).toBe('/home/test/.cargo');
  });

  it('layers user env on top of the allowlisted host env', () => {
    const resolved = resolveRustRunEnv({ [INJECTED]: 'user-value' });
    expect(resolved[INJECTED]).toBe('user-value');
    expect(resolved[ALLOWED]).toBe('/home/test/.cargo');
  });

  it('lets user env override allowlisted host keys', () => {
    const resolved = resolveRustRunEnv({ [ALLOWED]: '/override/cargo' });
    expect(resolved[ALLOWED]).toBe('/override/cargo');
  });

  it('drops non-string user values defensively', () => {
    const resolved = resolveRustRunEnv({
      [INJECTED]: 'ok',
      // @ts-expect-error — simulate a tampered IPC payload
      BAD: 42,
    });
    expect(resolved[INJECTED]).toBe('ok');
    expect('BAD' in resolved).toBe(false);
  });

  it('produces only the allowlisted host env when userEnv is undefined', () => {
    const resolved = resolveRustRunEnv();
    expect(resolved[ALLOWED]).toBe('/home/test/.cargo');
    expect('LINGUA_SMOKE_SECRET' in resolved).toBe(false);
  });

  it('lets user-set RUSTFLAGS / RUSTC_WRAPPER through (no runner-owned overrides for Rust)', () => {
    // The user explicitly opts into RUSTFLAGS via the internal user env
    // tier; the resolver must not strip it. Compare to Go where GOOS
    // / GOARCH are runner-owned.
    const resolved = resolveRustRunEnv({
      RUSTC_WRAPPER: '/usr/local/bin/sccache',
      RUSTFLAGS: '-C opt-level=0',
    });
    expect(resolved.RUSTC_WRAPPER).toBe('/usr/local/bin/sccache');
    expect(resolved.RUSTFLAGS).toBe('-C opt-level=0');
  });
});

describe('main rust compiler IPC registration', () => {
  beforeEach(() => {
    electronMocks.mockHandle.mockClear();
  });

  it('registers rust IPC handlers', () => {
    registerRustHandlers();

    expect(electronMocks.mockHandle).toHaveBeenCalledWith(
      'rust:detect',
      expect.any(Function)
    );
    expect(electronMocks.mockHandle).toHaveBeenCalledWith(
      'rust:run',
      expect.any(Function)
    );
  });
});

type RustRunHandler = (
  event: unknown,
  sourceCode: string,
  userEnv?: Record<string, string>
) => Promise<{ success: boolean; exitCode: number }>;

function createRunChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
    pid?: number;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => true);
  return child;
}

describe('rust:run compile + execute contract', () => {
  beforeEach(() => {
    electronMocks.mockHandle.mockClear();
    cpMocks.execFileAsync.mockReset();
    cpMocks.spawn.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function handlerFor(channel: string): RustRunHandler {
    const entry = electronMocks.mockHandle.mock.calls.find(
      (call) => call[0] === channel
    );
    if (!entry) throw new Error(`Missing handler for ${channel}`);
    return entry[1] as RustRunHandler;
  }

  it('compiles with --edition 2021 and tears the run down via SIGTERM then SIGKILL on timeout', async () => {
    vi.useFakeTimers();
    // First execFileAsync call = rustc --version (detect); second = compile.
    cpMocks.execFileAsync.mockResolvedValue({ stdout: 'rustc 1.80.0', stderr: '' });
    const child = createRunChild();
    cpMocks.spawn.mockReturnValue(child);

    registerRustHandlers();
    const run = handlerFor('rust:run');
    const promise = run({}, 'fn main() { loop {} }');

    await vi.waitFor(() => expect(cpMocks.spawn).toHaveBeenCalledTimes(1));

    // The compile invocation must pin the edition: rustc defaults to 2015
    // without the flag while rustfmt formats as 2021 — the regression this
    // test locks (shared RUST_EDITION constant).
    const compileCall = cpMocks.execFileAsync.mock.calls.find(
      (call) => Array.isArray(call[1]) && call[1].includes('-o')
    );
    expect(compileCall).toBeDefined();
    expect(compileCall![1].slice(0, 2)).toEqual(['--edition', '2021']);

    // POSIX: the user binary is spawned as a process-group leader so a
    // timeout can fell the whole tree, not only the direct child.
    if (process.platform !== 'win32') {
      expect(cpMocks.spawn).toHaveBeenCalledWith(
        expect.any(String),
        [],
        expect.objectContaining({ detached: true })
      );
    }

    // Run timeout (30s) sends SIGTERM; the 200ms escalation window then
    // sends SIGKILL — spawn's old built-in timeout only ever SIGTERMed,
    // which a signal-ignoring binary survives forever.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    await vi.advanceTimersByTimeAsync(200);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    child.emit('close', null);
    await expect(promise).resolves.toMatchObject({
      success: false,
      exitCode: -1,
    });
  });
});
