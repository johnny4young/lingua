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
