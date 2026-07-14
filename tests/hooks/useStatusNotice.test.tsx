import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStatusNotice } from '@/hooks/useStatusNotice';
import { useUIStore } from '@/stores/uiStore';

describe('useStatusNotice', () => {
  beforeEach(() => {
    useUIStore.setState({ statusNotice: null });
  });

  it('returns stable tone-safe actions without subscribing to notice state', () => {
    const { result, rerender } = renderHook(() => useStatusNotice());
    const first = result.current;

    rerender();
    expect(result.current).toBe(first);

    act(() => {
      result.current.error('notice.failed', { values: { name: 'demo.js' } });
    });

    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'error',
      messageKey: 'notice.failed',
      values: { name: 'demo.js' },
    });
  });
});
