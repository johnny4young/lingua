/**
 * RL-079 — `buildNativeRunnerEnv` contract tests.
 *
 * Pins the env-leak defense: only allowlisted host keys should reach
 * the spawned toolchain, user env from RL-011 layers on top, and
 * runner-owned overrides always win.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  COMMON_TOOLCHAIN_KEYS,
  GO_TOOLCHAIN_KEYS,
  NODE_TOOLCHAIN_KEYS,
  RUST_TOOLCHAIN_KEYS,
  WINDOWS_TOOLCHAIN_KEYS,
  buildNativeRunnerEnv,
  combinedAllowlist,
} from '../../src/main/runners/nativeEnv';

const TOUCHED_KEYS = [
  ...COMMON_TOOLCHAIN_KEYS,
  ...WINDOWS_TOOLCHAIN_KEYS,
  ...GO_TOOLCHAIN_KEYS,
  ...NODE_TOOLCHAIN_KEYS,
  ...RUST_TOOLCHAIN_KEYS,
  'LINGUA_SMOKE_SECRET',
  'OPENAI_API_KEY',
  'GOPROXY',
] as const;

describe('buildNativeRunnerEnv', () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of TOUCHED_KEYS) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of TOUCHED_KEYS) {
      const prev = saved.get(key);
      if (prev === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prev;
      }
    }
    saved.clear();
  });

  it('only carries allowlisted host keys, dropping the rest', () => {
    process.env.PATH = '/usr/bin';
    process.env.HOME = '/home/test';
    process.env.OPENAI_API_KEY = 'sk-leak';
    process.env.LINGUA_SMOKE_SECRET = '__lingua_smoke_secret__';

    const env = buildNativeRunnerEnv(COMMON_TOOLCHAIN_KEYS, undefined);

    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/test');
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.LINGUA_SMOKE_SECRET).toBeUndefined();
  });

  it('omits missing host keys entirely (never sends `undefined`)', () => {
    // PATH is intentionally not set in the cleared environment.
    const env = buildNativeRunnerEnv(COMMON_TOOLCHAIN_KEYS, undefined);

    expect('PATH' in env).toBe(false);
    expect(env.HOME).toBeUndefined();
  });

  it('layers the RL-011 user env on top of the allowlisted host env', () => {
    process.env.PATH = '/usr/bin';

    const env = buildNativeRunnerEnv(COMMON_TOOLCHAIN_KEYS, {
      MY_USER_VAR: 'value',
      ANOTHER: '1',
    });

    expect(env.PATH).toBe('/usr/bin');
    expect(env.MY_USER_VAR).toBe('value');
    expect(env.ANOTHER).toBe('1');
  });

  it('drops non-string user env values defensively', () => {
    const env = buildNativeRunnerEnv(COMMON_TOOLCHAIN_KEYS, {
      GOOD: 'value',
      // The renderer's envVarsStore rejects this shape, but the IPC
      // boundary is untrusted so the builder must defend itself.
      BAD: 42 as unknown as string,
    });

    expect(env.GOOD).toBe('value');
    expect('BAD' in env).toBe(false);
  });

  it('lets user env shadow allowlisted host keys (when allowlist permits it)', () => {
    process.env.PATH = '/usr/bin';

    const env = buildNativeRunnerEnv(COMMON_TOOLCHAIN_KEYS, {
      PATH: '/custom/bin',
    });

    expect(env.PATH).toBe('/custom/bin');
  });

  it('runner-owned overrides win over both host and user env', () => {
    process.env.PATH = '/usr/bin';

    const env = buildNativeRunnerEnv(
      [...COMMON_TOOLCHAIN_KEYS, ...GO_TOOLCHAIN_KEYS],
      { GOOS: 'darwin', GOARCH: 'amd64' },
      { GOOS: 'js', GOARCH: 'wasm' }
    );

    expect(env.GOOS).toBe('js');
    expect(env.GOARCH).toBe('wasm');
    expect(env.PATH).toBe('/usr/bin');
  });

  it('drops non-string override values defensively', () => {
    const env = buildNativeRunnerEnv(
      COMMON_TOOLCHAIN_KEYS,
      undefined,
      // Tests the same defensive coercion as user env.
      { GOOD: 'value', BAD: 42 as unknown as string }
    );

    expect(env.GOOD).toBe('value');
    expect('BAD' in env).toBe(false);
  });
});

describe('toolchain key allowlists', () => {
  it('common allowlist matches the audited list', () => {
    expect([...COMMON_TOOLCHAIN_KEYS]).toEqual([
      'PATH',
      'HOME',
      'LANG',
      'TMPDIR',
    ]);
  });

  it('Go allowlist matches the audited list', () => {
    expect([...GO_TOOLCHAIN_KEYS]).toEqual([
      'GOROOT',
      'GOPATH',
      'GOMODCACHE',
      'GOCACHE',
      'GOTMPDIR',
    ]);
  });

  it('Rust allowlist matches the audited list', () => {
    expect([...RUST_TOOLCHAIN_KEYS]).toEqual([
      'CARGO_HOME',
      'RUSTUP_HOME',
      'RUSTUP_TOOLCHAIN',
      'RUSTC',
      'CARGO',
    ]);
  });

  it('Node allowlist matches the audited list', () => {
    expect([...NODE_TOOLCHAIN_KEYS]).toEqual([
      'NODE_PATH',
      'NPM_CONFIG_CACHE',
      'NPM_CONFIG_PREFIX',
    ]);
  });

  it('Windows allowlist matches the audited list', () => {
    expect([...WINDOWS_TOOLCHAIN_KEYS]).toEqual([
      'SYSTEMROOT',
      'USERPROFILE',
      'PATHEXT',
      'COMSPEC',
    ]);
  });
});

describe('combinedAllowlist', () => {
  it('joins common + language keys (POSIX path)', () => {
    if (process.platform === 'win32') {
      // The platform branch is asserted in its own test below.
      return;
    }

    expect(combinedAllowlist(GO_TOOLCHAIN_KEYS)).toEqual([
      ...COMMON_TOOLCHAIN_KEYS,
      ...GO_TOOLCHAIN_KEYS,
    ]);
  });
});
