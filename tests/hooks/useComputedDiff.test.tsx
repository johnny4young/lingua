import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useComputedDiff } from '../../src/renderer/hooks/useComputedDiff';

const { computeDiffOffThreadMock } = vi.hoisted(() => ({
  computeDiffOffThreadMock: vi.fn(),
}));

vi.mock('../../src/renderer/runtime/utilityComputeClient', () => ({
  computeDiffOffThread: (...args: unknown[]) => computeDiffOffThreadMock(...args),
}));

describe('useComputedDiff', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', class WorkerStub {});
    computeDiffOffThreadMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('does not expose a completed worker result for newer inputs', async () => {
    const firstSegments = [{ kind: 'equal' as const, text: 'first' }];
    let resolveSecond: ((value: typeof firstSegments) => void) | undefined;
    computeDiffOffThreadMock
      .mockResolvedValueOnce(firstSegments)
      .mockImplementationOnce(
        () =>
          new Promise<typeof firstSegments>((resolve) => {
            resolveSecond = resolve;
          })
      );
    const first = 'a'.repeat(4_100);
    const second = 'b'.repeat(4_100);
    const { result, rerender } = renderHook(
      ({ left }) => useComputedDiff(left, '', 'line'),
      { initialProps: { left: first } }
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toEqual(firstSegments);

    rerender({ left: second });
    expect(result.current).toEqual([]);

    await act(async () => {
      resolveSecond?.([{ kind: 'add', text: 'second' }]);
      await Promise.resolve();
    });
    expect(result.current).toEqual([{ kind: 'add', text: 'second' }]);
  });
});
