import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, default: { ...actual, spawn: mocks.spawn }, spawn: mocks.spawn };
});

it('observes an LLDB spawn error before exposing its transport', async () => {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true),
  });
  mocks.spawn.mockReturnValue(child);
  const { RustDebugSession } = await import('../../src/main/rustDebugger');
  const session = new RustDebugSession({ lldbDapPath: '/missing/lldb-dap', scriptPath: '/fixture/main.rs', binaryPath: '/fixture/main', cwd: '/fixture', env: {} });
  const outcome = session.start([3]).catch(error => error);
  try {
    expect(child.listenerCount('error')).toBeGreaterThan(0);
    child.emit('error', new Error('ENOENT missing adapter'));
    expect((await outcome).message).toContain('ENOENT missing adapter');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  } finally {
    child.stdout.destroy(); child.stdin.destroy(); child.stderr.destroy();
    await outcome;
    session.terminate();
  }
});
