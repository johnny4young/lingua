import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNow } from '../../src/renderer/hooks/useNow';

describe('useNow', () => {
  afterEach(() => vi.useRealTimers());

  it('ticks only while active and reads the clock again when the reset key changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { result, rerender } = renderHook(({ active, reset }) => useNow(active, Date.now, 30_000, reset), {
      initialProps: { active: true, reset: 'a' as unknown },
    });
    expect(result.current).toBe(1_000);

    act(() => vi.advanceTimersByTime(30_000));
    expect(result.current).toBe(31_000);

    vi.setSystemTime(40_000);
    rerender({ active: true, reset: 'b' });
    expect(result.current).toBe(40_000);

    rerender({ active: false, reset: 'b' });
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBe(40_000);
  });

  it('keeps the plain 100 ms clock untouched when no reset key is given', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);
    const { result, rerender } = renderHook(({ active }) => useNow(active), { initialProps: { active: false } });
    vi.setSystemTime(9_000);
    rerender({ active: true });
    expect(result.current).toBe(5_000);
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe(9_100);
  });
});
