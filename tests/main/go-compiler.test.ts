import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const electronMocks = vi.hoisted(() => ({
  mockHandle: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMocks.mockHandle,
  },
}));

import {
  getWasmExecCandidatePaths,
  readWasmExecJs,
  registerGoHandlers,
  resolveGoCompileEnv,
} from '../../src/main/go-compiler';

describe('main go compiler helpers', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lingua-go-root-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('returns candidate paths in preferred lookup order', () => {
    expect(getWasmExecCandidatePaths('/usr/local/go')).toEqual([
      path.join('/usr/local/go', 'lib', 'wasm', 'wasm_exec.js'),
      path.join('/usr/local/go', 'misc', 'wasm', 'wasm_exec.js'),
    ]);
  });

  it('prefers the modern lib/wasm path when available', async () => {
    const libPath = path.join(tempRoot, 'lib', 'wasm');
    const miscPath = path.join(tempRoot, 'misc', 'wasm');
    await mkdir(libPath, { recursive: true });
    await mkdir(miscPath, { recursive: true });
    await writeFile(path.join(libPath, 'wasm_exec.js'), 'lib-runtime', 'utf8');
    await writeFile(path.join(miscPath, 'wasm_exec.js'), 'misc-runtime', 'utf8');

    const result = await readWasmExecJs(tempRoot);

    expect(result.path).toBe(path.join(libPath, 'wasm_exec.js'));
    expect(result.source).toBe('lib-runtime');
  });

  it('falls back to the legacy misc/wasm path when needed', async () => {
    const miscPath = path.join(tempRoot, 'misc', 'wasm');
    await mkdir(miscPath, { recursive: true });
    await writeFile(path.join(miscPath, 'wasm_exec.js'), 'misc-runtime', 'utf8');

    const result = await readWasmExecJs(tempRoot);

    expect(result.path).toBe(path.join(miscPath, 'wasm_exec.js'));
    expect(result.source).toBe('misc-runtime');
  });

  it('throws an actionable error when the runtime cannot be found', async () => {
    await expect(readWasmExecJs(tempRoot)).rejects.toThrow(
      new RegExp(`Go WASM runtime not found for GOROOT "${tempRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`)
    );
    await expect(readWasmExecJs(tempRoot)).rejects.toThrow(/lib\/wasm\/wasm_exec\.js/);
    await expect(readWasmExecJs(tempRoot)).rejects.toThrow(/misc\/wasm\/wasm_exec\.js/);
  });
});

describe('main go compiler env resolver (RL-079 minimal allowlist)', () => {
  const SECRET = 'LINGUA_SMOKE_SECRET';
  const INJECTED = 'LINGUA_TEST_FIXTURE_INJECT';
  const ALLOWED = 'GOROOT';
  const savedAllowed = process.env[ALLOWED];

  beforeEach(() => {
    // Seed a sentinel secret + an allowlisted host key. The new
    // contract should drop the secret and surface the allowlisted key.
    process.env[SECRET] = '__lingua_smoke_secret__';
    process.env[ALLOWED] = '/usr/local/go';
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
    const resolved = resolveGoCompileEnv();
    expect('LINGUA_SMOKE_SECRET' in resolved).toBe(false);
    expect(resolved[ALLOWED]).toBe('/usr/local/go');
  });

  it('layers user env on top of the allowlisted host env', () => {
    const resolved = resolveGoCompileEnv({ [INJECTED]: 'user-value' });
    expect(resolved[INJECTED]).toBe('user-value');
    expect(resolved[ALLOWED]).toBe('/usr/local/go');
  });

  it('lets user env override allowlisted host keys', () => {
    const resolved = resolveGoCompileEnv({ [ALLOWED]: '/override/go' });
    expect(resolved[ALLOWED]).toBe('/override/go');
  });

  it('refuses to let userEnv overwrite GOOS / GOARCH — runner-owned overrides win', () => {
    const resolved = resolveGoCompileEnv({
      GOOS: 'linux',
      GOARCH: 'amd64',
      [INJECTED]: 'still-here',
    });
    expect(resolved.GOOS).toBe('js');
    expect(resolved.GOARCH).toBe('wasm');
    expect(resolved[INJECTED]).toBe('still-here');
  });

  it('drops non-string user values defensively', () => {
    const resolved = resolveGoCompileEnv({
      [INJECTED]: 'ok',
      // @ts-expect-error — simulate a tampered IPC payload
      BAD: 42,
    });
    expect(resolved[INJECTED]).toBe('ok');
    expect('BAD' in resolved).toBe(false);
  });

  it('produces GOOS=js / GOARCH=wasm even when userEnv is undefined', () => {
    const resolved = resolveGoCompileEnv();
    expect(resolved.GOOS).toBe('js');
    expect(resolved.GOARCH).toBe('wasm');
  });
});

describe('main go compiler IPC registration', () => {
  beforeEach(() => {
    electronMocks.mockHandle.mockClear();
  });

  it('registers go IPC handlers', () => {
    registerGoHandlers();

    expect(electronMocks.mockHandle).toHaveBeenCalledWith(
      'go:detect',
      expect.any(Function)
    );
    expect(electronMocks.mockHandle).toHaveBeenCalledWith(
      'go:compile',
      expect.any(Function)
    );
  });
});
