import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectBundle } from '../../src/renderer/hooks/useProjectBundle';
import { useUIStore } from '../../src/renderer/stores/uiStore';

const mocks = vi.hoisted(() => ({
  loadRuntime: vi.fn(),
}));

vi.mock('../../src/renderer/hooks/projectBundleRuntimeLoader', () => ({
  loadProjectBundleRuntime: mocks.loadRuntime,
}));

const initialUiState = useUIStore.getState();

describe('useProjectBundle lazy runtime', () => {
  beforeEach(() => {
    mocks.loadRuntime.mockReset();
    useUIStore.setState(initialUiState, true);
    vi.restoreAllMocks();
  });

  it('does not load the runtime until an action is requested', async () => {
    const exportProjectBundle = vi.fn().mockResolvedValue(undefined);
    mocks.loadRuntime.mockResolvedValue({
      exportProjectBundle,
      importProjectBundle: vi.fn(),
    });

    const { result } = renderHook(() => useProjectBundle());

    expect(mocks.loadRuntime).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.exportProjectBundle();
    });

    expect(mocks.loadRuntime).toHaveBeenCalledTimes(1);
    expect(exportProjectBundle).toHaveBeenCalledTimes(1);
  });

  it('surfaces localized recovery when the runtime chunk cannot load', async () => {
    const error = new Error('project bundle chunk unavailable');
    const importProjectBundle = vi.fn().mockResolvedValue(undefined);
    mocks.loadRuntime
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({
        exportProjectBundle: vi.fn(),
        importProjectBundle,
      });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { result } = renderHook(() => useProjectBundle());
    await act(async () => {
      await result.current.importProjectBundle(new Uint8Array([1]));
    });

    expect(consoleError).toHaveBeenCalledWith(
      '[project-bundle] failed to load the project bundle runtime',
      error
    );
    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'error',
      messageKey: 'projectBundle.load.failed',
    });

    await act(async () => {
      await result.current.importProjectBundle(new Uint8Array([2]));
    });
    expect(mocks.loadRuntime).toHaveBeenCalledTimes(2);
    expect(importProjectBundle).toHaveBeenCalledWith(new Uint8Array([2]));
  });
});
