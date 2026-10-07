import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFile: vi.fn(() => {
    throw new Error('Unexpected real process in output fixture');
  }),
}));
vi.mock('node:child_process', () => ({
  default: { spawn: mocks.spawn, execFile: mocks.execFile },
  spawn: mocks.spawn,
  execFile: mocks.execFile,
}));

import { installNativeDependencies } from '../../src/main/nativeDependencyInstall';
import { disposeNativeRuns } from '../../src/main/runners/nativeRunLifecycle';
import { spawnNativeRun } from '../../src/main/runners/spawnNativeRun';
import { MAX_NATIVE_STDERR_BYTES } from '../../src/shared/runnerLimits';

const streams = ['stdout', 'stderr'] as const;
const marker = '[cut]';

function fakeChild() {
  const pipe = () =>
    Object.assign(new EventEmitter(), {
      resume: vi.fn(),
      destroy: vi.fn(),
    });
  return Object.assign(new EventEmitter(), {
    stdout: pipe(),
    stderr: pipe(),
    stdin: Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() }),
    kill: vi.fn(() => true),
    // No PID: every process operation is confined to these test doubles.
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.spawn.mockReset();
  mocks.execFile.mockClear();
});
afterEach(() => {
  disposeNativeRuns();
  vi.useRealTimers();
});

describe('native run UTF-8 output budgets', () => {
  it.each([
    { name: 'ordinary ASCII', value: 'x'.repeat(96), cap: 32, expected: 'x'.repeat(27) + marker },
    { name: 'CJK', value: '漢'.repeat(11), cap: 32, expected: '漢'.repeat(9) + marker },
    { name: 'emoji', value: '😀'.repeat(9), cap: 32, expected: '😀'.repeat(6) + marker },
    {
      name: 'mixed code points and BOM',
      value: '\uFEFFé漢😀xyz',
      cap: 12,
      expected: '\uFEFFé' + marker,
    },
  ])(
    'clips $name on both pipes and preserves observer/drain ownership',
    async ({ value, cap, expected }) => {
      const child = fakeChild();
      mocks.spawn.mockReturnValue(child);
      const observers = { stdout: vi.fn(), stderr: vi.fn() };
      const pending = spawnNativeRun({
        command: 'mock-native-run',
        args: [],
        env: {},
        timeoutMs: 1_000,
        killEscalationMs: 200,
        maxOutputBytes: cap,
        stdoutTruncationMarker: marker,
        stderrTruncationMarker: marker,
        onStdout: observers.stdout,
        onStderr: observers.stderr,
      });
      for (const stream of streams) {
        child[stream].emit('data', Buffer.from(value));
        expect(observers[stream]).toHaveBeenCalledExactlyOnceWith(value);
        expect(child[stream].listenerCount('data')).toBe(0);
        expect(child[stream].resume).toHaveBeenCalledTimes(1);
        expect(child[stream].destroy).not.toHaveBeenCalled();
        child[stream].emit('data', Buffer.from('TAIL'));
        expect(observers[stream]).toHaveBeenCalledTimes(1);
      }
      child.emit('close', 0);
      const result = await pending;
      for (const stream of streams) {
        expect(Buffer.byteLength(result[stream], 'utf8')).toBeLessThanOrEqual(cap);
        // Boolean equality avoids printing a megabyte-long diff on regression.
        expect(result[stream] === expected).toBe(true);
      }
      expect(result).toMatchObject({ exitCode: 0, timedOut: false, killed: false });
      disposeNativeRuns();
      expect(child.kill).not.toHaveBeenCalled();
      expect(mocks.execFile).not.toHaveBeenCalled();
    }
  );

  it.each(['single chunk', 'split first code point', 'one byte per chunk'])(
    'keeps split characters intact: %s',
    async mode => {
      const child = fakeChild();
      mocks.spawn.mockReturnValue(child);
      const pending = spawnNativeRun({
        command: 'mock-native-run',
        args: [],
        env: {},
        timeoutMs: 1_000,
        killEscalationMs: 200,
        maxOutputBytes: 14,
        stdoutTruncationMarker: marker,
        stderrTruncationMarker: marker,
      });
      const bytes = Buffer.from('😀漢éabcdefgh');
      const chunks =
        mode === 'single chunk'
          ? [bytes]
          : mode === 'split first code point'
            ? [bytes.subarray(0, 1), bytes.subarray(1)]
            : Array.from(bytes, (_, index) => bytes.subarray(index, index + 1));
      for (const stream of streams) {
        for (const chunk of chunks) child[stream].emit('data', chunk);
      }
      child.emit('close', 0);
      const result = await pending;
      for (const stream of streams) {
        expect(result[stream]).toBe('😀漢é' + marker);
        expect(Buffer.byteLength(result[stream], 'utf8')).toBe(14);
        expect(child[stream].resume).toHaveBeenCalledTimes(1);
      }
      expect(child.kill).not.toHaveBeenCalled();
    }
  );

  it('leaves exact-limit Unicode untouched until another decoded character arrives', async () => {
    const child = fakeChild();
    mocks.spawn.mockReturnValue(child);
    const pending = spawnNativeRun({
      command: 'mock-native-run',
      args: [],
      env: {},
      timeoutMs: 1_000,
      killEscalationMs: 200,
      maxOutputBytes: 10,
      stdoutTruncationMarker: marker,
      stderrTruncationMarker: marker,
    });
    const exact = 'é漢😀x';
    for (const stream of streams) {
      child[stream].emit('data', Buffer.from(exact));
      expect(child[stream].listenerCount('data')).toBe(1);
      expect(child[stream].resume).not.toHaveBeenCalled();
    }
    // A partial UTF-8 code point is decoder state, not captured output.
    const extra = Buffer.from('漢');
    child.stdout.emit('data', extra.subarray(0, 1));
    expect(child.stdout.listenerCount('data')).toBe(1);
    child.stdout.emit('data', extra.subarray(1));
    expect(child.stdout.listenerCount('data')).toBe(0);
    child.emit('close', 0);
    const result = await pending;
    expect(result.stdout).toBe('é漢' + marker);
    expect(result.stderr).toBe(exact);
    expect(Buffer.byteLength(result.stdout, 'utf8')).toBe(10);
    expect(child.stderr.resume).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it.each([
    { cap: 0, stdoutMarker: '[cut]', stderrMarker: '😀', stdout: '', stderr: '' },
    { cap: 2.5, stdoutMarker: '[cut]', stderrMarker: '😀', stdout: '[c', stderr: 'ab' },
    { cap: 3, stdoutMarker: '[cut]', stderrMarker: '😀!', stdout: '[cu', stderr: 'abc' },
    { cap: 5, stdoutMarker: '😀漢', stderrMarker: '', stdout: 'a😀', stderr: 'abcde' },
    { cap: 7, stdoutMarker: 'é漢', stderrMarker: '漢😀', stdout: 'abé漢', stderr: '漢😀' },
  ])('bounds caller markers independently at $cap bytes', async fixture => {
    const child = fakeChild();
    mocks.spawn.mockReturnValue(child);
    const pending = spawnNativeRun({
      command: 'mock-native-run',
      args: [],
      env: {},
      timeoutMs: 1_000,
      killEscalationMs: 200,
      maxOutputBytes: fixture.cap,
      stdoutTruncationMarker: fixture.stdoutMarker,
      stderrTruncationMarker: fixture.stderrMarker,
    });
    for (const stream of streams) child[stream].emit('data', Buffer.from('abcdefghijkl'));
    child.emit('close', 0);
    const result = await pending;
    for (const stream of streams) {
      expect(result[stream]).toBe(fixture[stream]);
      expect(Buffer.byteLength(result[stream], 'utf8')).toBeLessThanOrEqual(fixture.cap);
      expect(child[stream].listenerCount('data')).toBe(0);
      expect(child[stream].resume).toHaveBeenCalledTimes(1);
    }
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('clipping leaves Stop and final process release owned by the supervisor', async () => {
    const child = fakeChild();
    mocks.spawn.mockReturnValue(child);
    const controller = new AbortController();
    const pending = spawnNativeRun({
      command: 'mock-native-run',
      args: [],
      env: {},
      timeoutMs: 1_000,
      killEscalationMs: 200,
      maxOutputBytes: 8,
      stdoutTruncationMarker: marker,
      stderrTruncationMarker: marker,
      signal: controller.signal,
    });
    child.stdout.emit('data', Buffer.from('😀'.repeat(3)));
    expect(child.kill).not.toHaveBeenCalled();
    controller.abort();
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
    child.emit('close', 0);
    const result = await pending;
    expect(result).toMatchObject({ stdout: marker, stderr: '', killed: true, timedOut: false });
    expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
    const kills = child.kill.mock.calls.length;
    disposeNativeRuns();
    vi.advanceTimersByTime(2_000);
    expect(child.kill).toHaveBeenCalledTimes(kills);
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it('counts replacement text bytes rather than malformed raw input bytes', async () => {
    const child = fakeChild();
    mocks.spawn.mockReturnValue(child);
    const pending = spawnNativeRun({
      command: 'mock-native-run',
      args: [],
      env: {},
      timeoutMs: 1_000,
      killEscalationMs: 200,
      maxOutputBytes: 6,
      stdoutTruncationMarker: '!',
      stderrTruncationMarker: '!',
    });
    for (const stream of streams) {
      // Each invalid byte becomes a complete U+FFFD (three UTF-8 bytes).
      child[stream].emit('data', Buffer.from([0xff, 0xff]));
      expect(child[stream].listenerCount('data')).toBe(1);
      child[stream].emit('data', Buffer.from('x'));
    }
    child.emit('close', 0);
    const result = await pending;
    for (const stream of streams) {
      expect(result[stream]).toBe('\uFFFD!');
      expect(Buffer.byteLength(result[stream], 'utf8')).toBe(4);
      expect(child[stream].resume).toHaveBeenCalledTimes(1);
    }
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe('native install UTF-8 output budgets', () => {
  const cap = MAX_NATIVE_STDERR_BYTES;
  it.each([
    { name: 'ASCII', unit: 'x', width: 1 },
    { name: 'CJK', unit: '漢', width: 3 },
    { name: 'emoji', unit: '😀', width: 4 },
  ])(
    'bounds $name on both pipes without changing install listener ownership',
    async ({ unit, width }) => {
      const child = fakeChild();
      mocks.spawn.mockReturnValue(child);
      const pending = installNativeDependencies({
        language: 'rust',
        specifiers: ['serde'],
        cwd: '/mock-project',
        platform: 'linux',
        skipManifestCheck: true,
        spawnImpl: mocks.spawn as never,
      });
      const bytes = Buffer.from(unit.repeat(Math.floor(cap / width) + 1));
      for (const stream of streams) {
        // Exercise the actual streaming decoder inside the first character.
        child[stream].emit('data', bytes.subarray(0, 1));
        child[stream].emit('data', bytes.subarray(1));
        expect(child[stream].listenerCount('data')).toBe(1);
        expect(child[stream].resume).not.toHaveBeenCalled();
        expect(child[stream].destroy).not.toHaveBeenCalled();
        child[stream].emit('data', Buffer.from('TAIL'));
      }
      child.emit('close', 0);
      const result = await pending;
      for (const stream of streams) {
        const suffix = `\n[${stream} truncated]`;
        const expected =
          unit.repeat(Math.floor((cap - Buffer.byteLength(suffix)) / width)) + suffix;
        expect(result[stream]).toBe(expected);
        expect(Buffer.byteLength(result[stream], 'utf8')).toBeLessThanOrEqual(cap);
      }
      expect(result).toMatchObject({ status: 'success', exitCode: 0 });
      disposeNativeRuns();
      expect(child.kill).not.toHaveBeenCalled();
      expect(mocks.execFile).not.toHaveBeenCalled();
    }
  );

  it('keeps exact-limit emoji output and the other pipe independent', async () => {
    const child = fakeChild();
    mocks.spawn.mockReturnValue(child);
    const pending = installNativeDependencies({
      language: 'rust',
      specifiers: ['serde'],
      cwd: '/mock-project',
      platform: 'linux',
      skipManifestCheck: true,
      spawnImpl: mocks.spawn as never,
    });
    const exact = '😀'.repeat(cap / 4);
    child.stdout.emit('data', Buffer.from(exact));
    child.stderr.emit('data', Buffer.from('é漢😀'));
    child.emit('close', 0);
    const result = await pending;
    expect(result.stdout).toBe(exact);
    expect(Buffer.byteLength(result.stdout, 'utf8')).toBe(cap);
    expect(result.stderr).toBe('é漢😀');
    expect(child.kill).not.toHaveBeenCalled();
    expect(mocks.execFile).not.toHaveBeenCalled();
  });
});
