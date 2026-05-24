/**
 * RL-025 Slice C — pythonWebInstaller service unit tests.
 *
 * Pins the postMessage protocol shape, the 90s soft timeout (fold F),
 * the loaded-packages query, and the closed-enum mapping for the
 * `'unsupported-wheel'` failure reason.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Module-level worker stub so the service module sees a consistent
// shape across every import. The runnerManager mock returns this
// stub via `getOrEnsurePyodideWorker`.
class FakeWorker extends EventTarget {
  postMessage = vi.fn();
}

const fakeWorker = new FakeWorker();
const mockRunner = {
  getOrEnsurePyodideWorker: vi.fn(async () => fakeWorker as unknown as Worker),
};

vi.mock('../../../src/renderer/runners', () => ({
  runnerManager: {
    getPythonRunner: () => mockRunner,
  },
}));

describe('pythonWebInstaller', () => {
  beforeEach(async () => {
    vi.useRealTimers();
    fakeWorker.postMessage.mockReset();
    mockRunner.getOrEnsurePyodideWorker.mockClear();
    mockRunner.getOrEnsurePyodideWorker.mockResolvedValue(
      fakeWorker as unknown as Worker
    );
    const mod = await import(
      '../../../src/renderer/services/pythonWebInstaller'
    );
    mod.__resetPythonInstallerForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('listLoadedPackages dispatches list-loaded message and resolves with reply', async () => {
    const { listLoadedPackages } = await import(
      '../../../src/renderer/services/pythonWebInstaller'
    );
    const promise = listLoadedPackages();
    await vi.waitFor(() => {
      expect(fakeWorker.postMessage).toHaveBeenCalled();
    });
    const [posted] = fakeWorker.postMessage.mock.calls[0]!;
    expect(posted.type).toBe('dependencies:list-loaded');
    expect(typeof posted.requestId).toBe('string');
    fakeWorker.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'dependencies:list-loaded:reply',
          requestId: posted.requestId,
          packages: ['numpy', 'requests'],
        },
      })
    );
    const result = await promise;
    expect(result).toEqual(['numpy', 'requests']);
  });

  it('listLoadedPackages returns empty array on a 5s soft timeout', async () => {
    vi.useFakeTimers();
    const { listLoadedPackages } = await import(
      '../../../src/renderer/services/pythonWebInstaller'
    );
    const promise = listLoadedPackages();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await promise).toEqual([]);
  });

  it('installPython dispatches dependencies:install + resolves on done', async () => {
    const { installPython } = await import(
      '../../../src/renderer/services/pythonWebInstaller'
    );
    const logEntries: Array<{ stream: string; chunk: string }> = [];
    const promise = installPython({
      runId: 'r1',
      specifiers: ['requests'],
      onLog: (chunk) =>
        logEntries.push({ stream: chunk.stream, chunk: chunk.chunk }),
    });
    await vi.waitFor(() => {
      expect(fakeWorker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'dependencies:install',
          runId: 'r1',
          specifiers: ['requests'],
        })
      );
    });
    fakeWorker.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'dependencies:install:log',
          runId: 'r1',
          stream: 'stdout',
          chunk: 'Installing requests via micropip...\n',
        },
      })
    );
    fakeWorker.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'dependencies:install:done',
          runId: 'r1',
          statuses: { requests: 'installed' },
          outcome: 'success',
          failureReason: null,
        },
      })
    );
    const result = await promise;
    expect(result.outcome).toBe('success');
    expect(result.statuses.requests).toBe('installed');
    expect(logEntries).toEqual([
      { stream: 'stdout', chunk: 'Installing requests via micropip...\n' },
    ]);
  });

  it('installPython surfaces unsupported-wheel failureReason intact', async () => {
    const { installPython } = await import(
      '../../../src/renderer/services/pythonWebInstaller'
    );
    const promise = installPython({
      runId: 'r2',
      specifiers: ['psycopg2'],
    });
    await vi.waitFor(() => {
      expect(fakeWorker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ runId: 'r2' })
      );
    });
    fakeWorker.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'dependencies:install:done',
          runId: 'r2',
          statuses: { psycopg2: 'failed' },
          outcome: 'failed',
          failureReason: 'unsupported-wheel',
        },
      })
    );
    const result = await promise;
    expect(result.outcome).toBe('failed');
    expect(result.failureReason).toBe('unsupported-wheel');
    expect(result.statuses.psycopg2).toBe('failed');
  });

  it('installPython times out after 90s with timed-out outcome (fold F)', async () => {
    vi.useFakeTimers();
    const { installPython } = await import(
      '../../../src/renderer/services/pythonWebInstaller'
    );
    const promise = installPython({
      runId: 'r3',
      specifiers: ['hangy'],
    });
    // Let the install message land before we advance the timer.
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(90 * 1000);
    const result = await promise;
    expect(result.outcome).toBe('timed-out');
    expect(result.failureReason).toBe('timeout');
    expect(result.statuses.hangy).toBe('failed');
  });

  it('returns a failed result when no python runner is registered', async () => {
    // Restore the mock for this case to return null.
    vi.doMock('../../../src/renderer/runners', () => ({
      runnerManager: {
        getPythonRunner: () => null,
      },
    }));
    vi.resetModules();
    const { installPython } = await import(
      '../../../src/renderer/services/pythonWebInstaller'
    );
    const result = await installPython({
      runId: 'r4',
      specifiers: ['anything'],
    });
    expect(result.outcome).toBe('failed');
    expect(result.failureReason).toBe('unknown');
  });
});
