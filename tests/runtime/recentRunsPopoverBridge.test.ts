/**
 * module-level popover-opener handle.
 *
 * Locks:
 *   - `toggleRecentRunsPopover` returns `false` when no opener is
 *     registered (no pill mounted) and never throws.
 *   - When an opener is registered, the toggle invokes it and
 *     returns `true`.
 *   - Setting the opener to `null` clears the registration; the next
 *     toggle is a no-op again.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  openRecentRunsPopoverWhenReady,
  setRecentRunsPopoverOpener,
  toggleRecentRunsPopover,
} from '@/runtime/recentRunsPopoverBridge';

afterEach(() => {
  setRecentRunsPopoverOpener(null);
});

describe('recentRunsPopoverBridge', () => {
  it('returns false when no opener is registered', () => {
    expect(toggleRecentRunsPopover()).toBe(false);
  });

  it('invokes the registered opener and returns true', () => {
    const opener = vi.fn();
    setRecentRunsPopoverOpener(opener);
    expect(toggleRecentRunsPopover()).toBe(true);
    expect(opener).toHaveBeenCalledTimes(1);
  });

  it('returns false again after the opener is cleared', () => {
    const opener = vi.fn();
    setRecentRunsPopoverOpener(opener);
    setRecentRunsPopoverOpener(null);
    expect(toggleRecentRunsPopover()).toBe(false);
    expect(opener).not.toHaveBeenCalled();
  });

  it('opens once when an opener registers after a queued request', () => {
    const opener = vi.fn();
    openRecentRunsPopoverWhenReady();
    setRecentRunsPopoverOpener(opener);
    expect(opener).toHaveBeenCalledTimes(1);
    setRecentRunsPopoverOpener(null);
    setRecentRunsPopoverOpener(opener);
    expect(opener).toHaveBeenCalledTimes(1);
  });

  it('drops a queued open that no meter picked up in time', () => {
    vi.useFakeTimers();
    try {
      const opener = vi.fn();
      openRecentRunsPopoverWhenReady();
      vi.advanceTimersByTime(2_500);
      setRecentRunsPopoverOpener(opener);
      expect(opener).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
