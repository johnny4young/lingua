/**
 * RL-079 — Rust compile + run env merge under the minimal allowlist.
 *
 * Same shape as go-compiler.test.ts, minus the runner-owned keys:
 * Rust does not claim any env variables for itself, so the user env
 * is the last tier in the merge.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  mockHandle: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMocks.mockHandle,
  },
}));

import { registerRustHandlers, resolveRustRunEnv } from '../../src/main/rust-compiler';

describe('main rust compiler env resolver (RL-079 minimal allowlist)', () => {
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
    // The user explicitly opts into RUSTFLAGS via the RL-011 user env
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
