import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankPipeline } from '../../src/shared/utilityPipeline';

const { mockRun } = vi.hoisted(() => ({ mockRun: vi.fn() }));
vi.mock('../../src/renderer/runtime/utilityPipelineRunner', () => ({ runUtilityPipeline: mockRun }));

import { useUtilityPipelineRun } from '../../src/renderer/hooks/useUtilityPipelineRun';

describe('useUtilityPipelineRun', () => {
  const pipeline = createBlankPipeline({ id: 'p', name: 'p' });
  const start = () => {
    let settle: (outcome: unknown) => void = () => {};
    mockRun.mockImplementationOnce(() => new Promise((resolve) => (settle = resolve)));
    return (outcome: unknown) => settle(outcome);
  };
  const lastSignal = (): AbortSignal => mockRun.mock.lastCall?.[0].signal;

  beforeEach(() => mockRun.mockReset());

  it('aborts the run in flight on reset, and on a new run', () => {
    const { result } = renderHook(() => useUtilityPipelineRun());
    start();
    act(() => void result.current.run(pipeline, 'a'));
    const first = lastSignal();
    start();
    act(() => void result.current.run(pipeline, 'b'));
    expect(first.aborted).toBe(true);
    const second = lastSignal();
    expect(second.aborted).toBe(false);
    act(() => result.current.reset());
    expect(second.aborted).toBe(true);
  });

  it('aborts on unmount and drops the outcome of that run', async () => {
    const { result, unmount } = renderHook(() => useUtilityPipelineRun());
    const settle = start();
    let returned: unknown = 'pending';
    act(() => {
      void result.current.run(pipeline, 'a').then((outcome) => (returned = outcome));
    });
    unmount();
    expect(lastSignal().aborted).toBe(true);
    settle({ status: 'all-ok', results: [], durationMs: 0 });
    await vi.waitFor(() => expect(returned).toBeNull());
  });
});
