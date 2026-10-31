import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ showOpenDialog: vi.fn(), fromWebContents: vi.fn(), blocked: vi.fn() }));
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  dialog: { showOpenDialog: mocks.showOpenDialog },
}));

vi.mock('../../src/main/ipc/permissions', () => ({ blockedPathFamily: mocks.blocked }));

import {
  chooseToolchainBinary,
  chosenToolchainBinaries,
  configureToolchainBinaryStore,
  displayToolchainPath,
  findToolchain,
  toolchainSearchDirs,
  validateToolchainBinary,
  withBinaryDirOnPath,
} from '../../src/main/runners/toolchainBinary';

describe('toolchain binary search', () => {
  it('lists the install folders a GUI launch misses, per platform', () => {
    expect(toolchainSearchDirs('go', '/Users/dev', 'darwin', {})).toEqual([
      '/usr/local/go/bin', '/Users/dev/go/bin', '/opt/homebrew/bin', '/usr/local/bin',
    ]);
    expect(toolchainSearchDirs('go', '/home/dev', 'linux', {})).toEqual([
      '/usr/local/go/bin', '/home/dev/go/bin', '/usr/local/bin', '/snap/bin',
    ]);
    expect(toolchainSearchDirs('rust', '/home/dev', 'linux', { CARGO_HOME: '/opt/cargo' })).toEqual([
      '/opt/cargo/bin', '/usr/local/bin',
    ]);
    expect(toolchainSearchDirs('rust', 'C:\\Users\\dev', 'win32', {})).toEqual(['C:\\Users\\dev\\.cargo\\bin']);
    expect(toolchainSearchDirs('go', 'C:\\Users\\dev', 'win32', { ProgramFiles: 'D:\\Apps' })[0]).toBe('D:\\Apps\\Go\\bin');
  });

  it('prints home folders as ~ so the account name never reaches the UI', () => {
    const home = os.homedir();
    expect(displayToolchainPath(path.join(home, '.cargo', 'bin'))).toBe(`~${path.sep}.cargo${path.sep}bin`);
    expect(displayToolchainPath(home)).toBe('~');
    expect(displayToolchainPath('/usr/local/go/bin')).toBe('/usr/local/go/bin');
    expect(displayToolchainPath(`${home}-other/bin`)).toBe(`${home}-other/bin`);
  });

  it('takes the first candidate that answers and reports missing only when none exists', async () => {
    const probe = vi.fn(async (command: string) =>
      command === 'go' ? ({ kind: 'missing' } as const) : ({ kind: 'found', value: command } as const)
    );
    expect(await findToolchain(['go', '/usr/local/go/bin/go', '/opt/go'], probe)).toEqual({
      kind: 'found', value: '/usr/local/go/bin/go', command: '/usr/local/go/bin/go',
    });
    expect(probe).toHaveBeenCalledTimes(2);

    expect(await findToolchain(['go'], async () => ({ kind: 'missing' }) as const)).toEqual({ kind: 'missing' });
    // A broken binary is not an absent one: Run stays available and the error shows.
    expect(
      await findToolchain(['/chosen/go', 'go'], async command =>
        command === 'go' ? { kind: 'missing' } : { kind: 'failed', timedOut: true }
      )
    ).toEqual({ kind: 'failed', timedOut: true });
  });

  it('stops probing once the run is cancelled', async () => {
    const controller = new AbortController();
    const probe = vi.fn(async () => {
      controller.abort();
      return { kind: 'missing' } as const;
    });
    expect(await findToolchain(['go', '/usr/local/go/bin/go'], probe, controller.signal)).toEqual({ kind: 'failed' });
    expect(probe).toHaveBeenCalledOnce();
  });

  it('puts an absolute binary folder first on PATH once', () => {
    const env = { PATH: ['/usr/bin', '/bin'].join(path.delimiter) };
    const withDir = withBinaryDirOnPath(env, '/opt/go/bin/go');
    expect(withDir.PATH?.split(path.delimiter)).toEqual(['/opt/go/bin', '/usr/bin', '/bin']);
    expect(withBinaryDirOnPath(withDir, '/opt/go/bin/go')).toBe(withDir);
    expect(withBinaryDirOnPath(env, 'go')).toBe(env);
  });
});

describe('chosen toolchain binary', () => {
  let root: string;
  let binDir: string;

  async function executable(name: string, mode = 0o755) {
    const file = path.join(binDir, name);
    await writeFile(file, '#!/bin/sh\n');
    await chmod(file, mode);
    return file;
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'lingua-toolchain-'));
    binDir = path.join(root, 'bin');
    await mkdir(binDir);
    configureToolchainBinaryStore(path.join(root, 'userData'));
    mocks.showOpenDialog.mockReset();
    mocks.fromWebContents.mockReset().mockReturnValue(null);
    mocks.blocked.mockReset().mockReturnValue(null);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it.skipIf(process.platform === 'win32')('keeps only an executable file with the toolchain name that answers its version', async () => {
    const verify = vi.fn(async () => 'rustc 1.90.0');
    expect(await validateToolchainBinary('rust', 'bin/rustc', verify)).toEqual({ status: 'invalid', reason: 'not-executable' });
    expect(await validateToolchainBinary('rust', await executable('rustc', 0o644), verify)).toEqual({ status: 'invalid', reason: 'not-executable' });
    expect(await validateToolchainBinary('rust', binDir, verify)).toEqual({ status: 'invalid', reason: 'not-executable' });
    expect(await validateToolchainBinary('rust', await executable('ls'), verify)).toEqual({ status: 'invalid', reason: 'wrong-name' });
    expect(verify).not.toHaveBeenCalled();

    const rustc = await executable('rustc');
    expect(await validateToolchainBinary('rust', rustc, async () => null)).toEqual({ status: 'invalid', reason: 'check-failed' });
    expect(await validateToolchainBinary('rust', rustc, verify)).toEqual({ status: 'saved', version: 'rustc 1.90.0' });
    expect(verify).toHaveBeenCalledWith(rustc);
  });

  it.skipIf(process.platform === 'win32')('refuses credential and app-data folders but not system toolchain folders', async () => {
    const go = await executable('go');
    const verify = vi.fn(async () => 'go version go1.22');
    mocks.blocked.mockReturnValueOnce('credentials');
    expect(await validateToolchainBinary('go', go, verify)).toEqual({ status: 'invalid', reason: 'blocked' });
    mocks.blocked.mockReturnValueOnce('app-data');
    expect(await validateToolchainBinary('go', go, verify)).toEqual({ status: 'invalid', reason: 'blocked' });
    expect(verify).not.toHaveBeenCalled();
    // /usr and Program Files are protected for file access, yet that is where toolchains live.
    mocks.blocked.mockReturnValueOnce('system');
    expect(await validateToolchainBinary('go', go, verify)).toEqual({ status: 'saved', version: 'go version go1.22' });
  });

  it.skipIf(process.platform === 'win32')('saves the picked path with owner-only permissions and ignores a cancel', async () => {
    const sender = {} as Electron.WebContents;
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await chooseToolchainBinary('go', sender, async () => 'go version')).toEqual({ status: 'canceled' });
    expect(await chosenToolchainBinaries.get('go')).toBeUndefined();

    const go = await executable('go');
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [go] });
    expect(await chooseToolchainBinary('go', sender, async () => 'go version go1.22')).toEqual({
      status: 'saved', version: 'go version go1.22',
    });
    expect(await chosenToolchainBinaries.get('go')).toBe(go);
    const file = path.join(root, 'userData', 'toolchain-binaries.json');
    expect(JSON.parse(await readFile(file, 'utf-8'))).toEqual({ version: 1, go });
    expect((await stat(file)).mode & 0o777).toBe(0o600);

    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [await executable('ls')] });
    expect(await chooseToolchainBinary('go', sender, async () => 'go version')).toEqual({ status: 'invalid', reason: 'wrong-name' });
    expect(await chosenToolchainBinaries.get('go')).toBe(go);
  });

  it('drops a tampered store entry that is not an absolute path', async () => {
    await mkdir(path.join(root, 'userData'), { recursive: true });
    await writeFile(path.join(root, 'userData', 'toolchain-binaries.json'), JSON.stringify({ go: 'go', rust: 42 }));
    configureToolchainBinaryStore(path.join(root, 'userData'));
    expect(await chosenToolchainBinaries.get('go')).toBeUndefined();
    expect(await chosenToolchainBinaries.get('rust')).toBeUndefined();
  });
});
