/**
 * IT2-F4 — the one-shot pending-input consumer.
 *
 * Locks the handoff contract between the smart-paste router and a
 * utility panel: the seed applies exactly once (fresh mount AND
 * already-mounted panel), clears itself, and never leaks into a panel
 * with a different utility id.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePendingUtilityInput } from '../../../src/renderer/components/DeveloperUtilities/usePendingUtilityInput';
import { useUtilityHistoryStore } from '../../../src/renderer/stores/utilityHistoryStore';

beforeEach(() => {
  useUtilityHistoryStore.setState({ pendingUtilityInput: null }, false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('usePendingUtilityInput', () => {
  it('applies a seed that was set BEFORE mount, then clears the slot', () => {
    useUtilityHistoryStore
      .getState()
      .setPendingUtilityInput({ utilityId: 'jwt', input: 'aaa.bbb.ccc' });
    const apply = vi.fn();
    renderHook(() => usePendingUtilityInput('jwt', apply));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith('aaa.bbb.ccc');
    expect(useUtilityHistoryStore.getState().pendingUtilityInput).toBeNull();
  });

  it('applies a seed that arrives while the panel is ALREADY mounted', () => {
    const apply = vi.fn();
    renderHook(() => usePendingUtilityInput('color', apply));
    expect(apply).not.toHaveBeenCalled();
    act(() => {
      useUtilityHistoryStore
        .getState()
        .setPendingUtilityInput({ utilityId: 'color', input: '#4f46e5' });
    });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith('#4f46e5');
    expect(useUtilityHistoryStore.getState().pendingUtilityInput).toBeNull();
  });

  it('ignores a seed addressed to a different utility', () => {
    const apply = vi.fn();
    renderHook(() => usePendingUtilityInput('uuid', apply));
    act(() => {
      useUtilityHistoryStore
        .getState()
        .setPendingUtilityInput({ utilityId: 'jwt', input: 'aaa.bbb.ccc' });
    });
    expect(apply).not.toHaveBeenCalled();
    // The slot stays for the right panel to consume.
    expect(useUtilityHistoryStore.getState().pendingUtilityInput).not.toBeNull();
  });

  it('does not replay the seed on re-render after consuming it', () => {
    useUtilityHistoryStore
      .getState()
      .setPendingUtilityInput({ utilityId: 'json', input: '{"a":1}' });
    const apply = vi.fn();
    const { rerender } = renderHook(() => usePendingUtilityInput('json', apply));
    rerender();
    rerender();
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
