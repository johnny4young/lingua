// SPDX-License-Identifier: MIT
import { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }));
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: mocks.spawn, execFile: mocks.execFile };
});
import { executeCliPlan } from '../../../src/cli/runtime/execution';

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
beforeEach(() => {
  mocks.spawn.mockReset();
  mocks.execFile.mockReset();
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(process, 'platform', platform);
});

it.each([false, true])(
  'requests Windows tree termination before parent death (taskkill failure: %s)',
  async fails => {
    const child = Object.assign(new ChildProcess(), {
      pid: 98765,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    const kill = vi.spyOn(child, 'kill').mockReturnValue(true);
    mocks.spawn.mockReturnValue(child);
    if (fails)
      mocks.execFile.mockImplementation((_command, _args, callback) =>
        callback(new Error('taskkill unavailable'))
      );
    const pending = executeCliPlan(
      {
        displayTarget: 'synthetic-windows',
        runtime: 'node',
        cwd: process.cwd(),
        steps: [{ command: 'node', args: [], kind: 'execute' }],
      },
      { env: {}, timeoutMs: 1000 }
    );
    process.emit('SIGINT');
    try {
      expect(mocks.execFile).toHaveBeenCalledWith(
        'taskkill',
        ['/pid', '98765', '/T', '/F'],
        expect.any(Function)
      );
      if (fails) expect(kill).toHaveBeenCalledWith('SIGTERM');
      else expect(kill).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(child, 'signalCode', { value: 'SIGTERM', configurable: true });
      child.emit('exit', null, 'SIGTERM');
      child.emit('close', null, 'SIGTERM');
      expect((await pending).status).toBe('stopped');
      expect(mocks.execFile).toHaveBeenCalledTimes(1);
    }
  }
);
