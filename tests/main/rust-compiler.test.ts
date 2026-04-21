/**
 * RL-011 Slice D second increment — Rust compile + run env merge.
 *
 * Same contract as go-compiler.test.ts, minus the runner-owned keys:
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

describe('main rust compiler env resolver (RL-011 Slice D)', () => {
  const PRESERVED = 'LINGUA_TEST_RUST_KEEP';
  const INJECTED = 'LINGUA_TEST_RUST_INJECT';

  beforeEach(() => {
    process.env[PRESERVED] = 'host-value';
    delete process.env[INJECTED];
  });

  afterEach(() => {
    delete process.env[PRESERVED];
    delete process.env[INJECTED];
  });

  it('spreads process.env underneath the user env so host values stay visible', () => {
    const resolved = resolveRustRunEnv({ [INJECTED]: 'user-value' });
    expect(resolved[PRESERVED]).toBe('host-value');
    expect(resolved[INJECTED]).toBe('user-value');
  });

  it('lets the user env override overlapping host keys (user wins over host)', () => {
    const resolved = resolveRustRunEnv({ [PRESERVED]: 'overridden-by-user' });
    expect(resolved[PRESERVED]).toBe('overridden-by-user');
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

  it('produces just the host env when userEnv is undefined', () => {
    const resolved = resolveRustRunEnv();
    expect(resolved[PRESERVED]).toBe('host-value');
  });

  it('does not clobber or inject any runner-owned key (Rust has none)', () => {
    // The contract with Go pins GOOS/GOARCH as runner-owned. Rust
    // intentionally has no equivalent — assert that the resolver
    // leaves any key the user picked intact, even when it happens to
    // look env-y.
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
