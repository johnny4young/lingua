import { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const mocked = { ...actual, execFile: mocks.execFile };
  return { ...mocked, default: mocked };
});
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
beforeEach(() => {
  vi.resetModules();
  mocks.execFile.mockReset();
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
});
afterEach(() => { Object.defineProperty(process, 'platform', platform); });

describe('Windows native process-tree termination', () => {
  it.each(['SIGTERM', 'SIGKILL'] as const)('targets the tree before killing its parent for %s', async signal => {
    const child = Object.assign(new ChildProcess(), { pid: 98765 });
    const kill = vi.spyOn(child, 'kill').mockReturnValue(true);
    const { killProcessTree } = await import('../../src/main/runners/processTree');
    killProcessTree(child, signal);
    expect(mocks.execFile).toHaveBeenCalledWith('taskkill', ['/pid', '98765', '/T', '/F'], expect.any(Function));
    expect(kill).not.toHaveBeenCalled();
  });

  it('never targets the PID of a child that has already exited', async () => {
    const child = Object.assign(new ChildProcess(), { pid: 98765, exitCode: 0 });
    const kill = vi.spyOn(child, 'kill').mockReturnValue(true);
    const { killProcessTree } = await import('../../src/main/runners/processTree');
    killProcessTree(child, 'SIGKILL');
    expect(mocks.execFile).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
  });

  it('still targets a child double that does not report exit state', async () => {
    const child = Object.assign(new EventEmitter(), { pid: 98765, kill: vi.fn(() => true) });
    const { killProcessTree } = await import('../../src/main/runners/processTree');
    killProcessTree(child as unknown as ChildProcess, 'SIGTERM');
    expect(mocks.execFile).toHaveBeenCalledWith('taskkill', ['/pid', '98765', '/T', '/F'], expect.any(Function));
  });

  it('falls back to the direct child if taskkill fails asynchronously', async () => {
    mocks.execFile.mockImplementation((_command, _args, callback) => {
      callback(new Error('taskkill unavailable'));
    });
    const child = Object.assign(new ChildProcess(), { pid: 98765 });
    const kill = vi.spyOn(child, 'kill').mockReturnValue(true);
    const { killProcessTree } = await import('../../src/main/runners/processTree');
    killProcessTree(child, 'SIGKILL');
    expect(kill).toHaveBeenCalledWith('SIGKILL');
  });
});
