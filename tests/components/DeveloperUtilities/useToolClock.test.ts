import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useToolClock } from '../../../src/renderer/components/DeveloperUtilities/useToolClock';

describe('useToolClock', () => {
  afterEach(() => vi.useRealTimers());

  it('ticks every second within a minute of the target and every 30 s farther out', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const { result, rerender } = renderHook(({ target }) => useToolClock('input', true, target), {
      initialProps: { target: 100_000 as number | null },
    });

    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current).toBe(101_000);

    rerender({ target: 10_000_000 });
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current).toBe(101_000);
    act(() => vi.advanceTimersByTime(29_000));
    expect(result.current).toBe(131_000);
  });
});
