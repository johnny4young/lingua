import { describe, expect, it, vi } from 'vitest';
import { syncUserEnvInPyodide } from '@/workers/python-worker-env';

describe('python-worker env sync helper', () => {
  it('syncs current vars and removes keys that disappeared since the previous run', async () => {
    const set = vi.fn();
    const del = vi.fn();
    const runPythonAsync = vi.fn().mockResolvedValue(undefined);

    const nextKeys = await syncUserEnvInPyodide(
      {
        runPythonAsync,
        globals: { set, delete: del },
      } as never,
      { SHARED: 'tab', TAB_ONLY: '1' },
      ['SHARED', 'OLD_ONLY']
    );

    expect(nextKeys).toEqual(['SHARED', 'TAB_ONLY']);
    expect(set).toHaveBeenCalledWith('_LINGUA_USER_ENV', {
      SHARED: 'tab',
      TAB_ONLY: '1',
    });
    expect(set).toHaveBeenCalledWith('_LINGUA_PREV_ENV_KEYS', ['SHARED', 'OLD_ONLY']);
    expect(runPythonAsync).toHaveBeenCalledTimes(1);
    expect(runPythonAsync.mock.calls[0][0]).toContain('os.environ.pop(_k, None)');
    expect(runPythonAsync.mock.calls[0][0]).toContain('_LINGUA_PREV_ENV_KEYS');
    expect(del).toHaveBeenCalledWith('_LINGUA_USER_ENV');
    expect(del).toHaveBeenCalledWith('_LINGUA_PREV_ENV_KEYS');
  });

  it('still runs the sync when the next env is empty but stale keys must be cleared', async () => {
    const runPythonAsync = vi.fn().mockResolvedValue(undefined);

    const nextKeys = await syncUserEnvInPyodide(
      {
        runPythonAsync,
        globals: { set: vi.fn(), delete: vi.fn() },
      } as never,
      {},
      ['STALE_KEY']
    );

    expect(nextKeys).toEqual([]);
    expect(runPythonAsync).toHaveBeenCalledTimes(1);
  });

  it('keeps the fast path when there is no current env and no stale keys', async () => {
    const runPythonAsync = vi.fn().mockResolvedValue(undefined);

    const nextKeys = await syncUserEnvInPyodide(
      {
        runPythonAsync,
        globals: { set: vi.fn(), delete: vi.fn() },
      } as never,
      {},
      []
    );

    expect(nextKeys).toEqual([]);
    expect(runPythonAsync).not.toHaveBeenCalled();
  });
});
