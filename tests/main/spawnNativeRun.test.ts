import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  default: {
    spawn: mocks.spawn,
    execFile: mocks.execFile,
  },
  spawn: mocks.spawn,
  execFile: mocks.execFile,
}));

describe('spawnNativeRun', () => {
  beforeEach(() => {
    mocks.spawn.mockReset();
    mocks.execFile.mockReset();
  });

  it('resolves a structured spawnError when spawn throws synchronously', async () => {
    mocks.spawn.mockImplementation(() => {
      throw new TypeError('invalid spawn options');
    });

    const { spawnNativeRun } = await import('../../src/main/runners/spawnNativeRun');
    const result = await spawnNativeRun({
      command: 'node',
      args: [],
      env: {},
      timeoutMs: 1_000,
      killEscalationMs: 200,
      maxOutputBytes: 1024,
      stdoutTruncationMarker: '\n[stdout truncated]',
      stderrTruncationMarker: '\n[stderr truncated]',
    });

    expect(result).toMatchObject({
      stdout: '',
      stderr: '',
      exitCode: -1,
      timedOut: false,
      killed: false,
    });
    expect(result.spawnError).toBeInstanceOf(TypeError);
    expect(result.spawnError?.message).toBe('invalid spawn options');
  });

  it('keeps resolving normally when the child closes', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: { on: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { on: vi.fn(), end: vi.fn() };
    child.kill = vi.fn(() => true);
    mocks.spawn.mockReturnValue(child);

    const { spawnNativeRun } = await import('../../src/main/runners/spawnNativeRun');
    const promise = spawnNativeRun({
      command: 'node',
      args: ['-e', 'console.log(1)'],
      env: {},
      timeoutMs: 1_000,
      killEscalationMs: 200,
      maxOutputBytes: 1024,
      stdoutTruncationMarker: '\n[stdout truncated]',
      stderrTruncationMarker: '\n[stderr truncated]',
    });

    child.stdout.emit('data', Buffer.from('ok\n'));
    child.emit('close', 0);

    await expect(promise).resolves.toMatchObject({
      stdout: 'ok\n',
      exitCode: 0,
      timedOut: false,
      killed: false,
    });
  });
});
