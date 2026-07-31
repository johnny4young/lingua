import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRunner } from '../../src/renderer/hooks/useRunner';
import { useUIStore } from '../../src/renderer/stores/uiStore';

const mocks = vi.hoisted(() => ({
  loadController: vi.fn(),
  runActiveTab: vi.fn(),
}));

vi.mock('../../src/renderer/hooks/manualRunControllerLoader', () => ({
  loadManualRunController: mocks.loadController,
}));

describe('useRunner activation boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUIStore.setState({ statusNotice: null });
    mocks.loadController.mockResolvedValue({
      runActiveTab: mocks.runActiveTab,
    });
  });

  it('does not load manual-run orchestration while controls are idle', () => {
    renderHook(() => useRunner());

    expect(mocks.loadController).not.toHaveBeenCalled();
  });

  it('loads the controller on Run and forwards the requested mode', async () => {
    const { result } = renderHook(() => useRunner());

    await act(async () => {
      await result.current.run({ debug: true, recordHistory: false });
    });

    expect(mocks.loadController).toHaveBeenCalledOnce();
    expect(mocks.runActiveTab).toHaveBeenCalledWith(expect.any(Function), {
      debug: true,
      recordHistory: false,
    });
  });

  it('turns a failed chunk request into localized recovery and retries later', async () => {
    mocks.loadController
      .mockRejectedValueOnce(new Error('chunk unavailable'))
      .mockResolvedValueOnce({ runActiveTab: mocks.runActiveTab });
    const { result } = renderHook(() => useRunner());

    await act(async () => {
      await result.current.run();
    });

    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'error',
      messageKey: 'runtime.manualRun.loadFailed',
    });
    expect(mocks.runActiveTab).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.run();
    });

    expect(mocks.loadController).toHaveBeenCalledTimes(2);
    expect(mocks.runActiveTab).toHaveBeenCalledOnce();
  });
});
