/**
 * RL-020 Slice 4 fold B — module-level popover-opener handle.
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
});
