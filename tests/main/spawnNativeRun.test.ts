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

  it('stops receiving after the output cap: detaches the data listener and resumes the pipe', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter & { resume: ReturnType<typeof vi.fn> };
      stderr: EventEmitter & { resume: ReturnType<typeof vi.fn> };
      stdin: { on: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = Object.assign(new EventEmitter(), { resume: vi.fn() });
    child.stderr = Object.assign(new EventEmitter(), { resume: vi.fn() });
    child.stdin = { on: vi.fn(), end: vi.fn() };
    child.kill = vi.fn(() => true);
    mocks.spawn.mockReturnValue(child);

    const onStdout = vi.fn();
    const { spawnNativeRun } = await import('../../src/main/runners/spawnNativeRun');
    const promise = spawnNativeRun({
      command: 'node',
      args: ['-e', 'while(true) console.log("x")'],
      env: {},
      timeoutMs: 1_000,
      killEscalationMs: 200,
      maxOutputBytes: 16,
      stdoutTruncationMarker: '\n[stdout truncated]',
      stderrTruncationMarker: '\n[stderr truncated]',
      onStdout,
    });

    // First oversized chunk crosses the cap: the handler must truncate,
    // detach itself, and hand the pipe to resume() so a flooding child
    // no longer costs Buffer decodes in the parent.
    child.stdout.emit('data', Buffer.from('x'.repeat(64)));
    expect(child.stdout.listenerCount('data')).toBe(0);
    expect(child.stdout.resume).toHaveBeenCalledTimes(1);
    const streamedCallsAfterCap = onStdout.mock.calls.length;

    // A flood after the cap is invisible: no listener, no streaming
    // callback, no growth of the captured buffer.
    child.stdout.emit('data', Buffer.from('y'.repeat(1024)));
    expect(onStdout.mock.calls.length).toBe(streamedCallsAfterCap);

    child.emit('close', 0);
    const result = await promise;
    expect(result.stdout.endsWith('\n[stdout truncated]')).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(16 + '\n[stdout truncated]'.length);
    expect(result.stdout).not.toContain('y');
    // stderr never crossed the cap — its listener stays attached.
    expect(child.stderr.listenerCount('data')).toBe(1);
    expect(child.stderr.resume).not.toHaveBeenCalled();
  });
});
