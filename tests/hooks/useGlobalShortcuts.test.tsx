import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGlobalShortcuts, type AppOverlay } from '@/hooks/useGlobalShortcuts';
import { useSettingsStore } from '@/stores/settingsStore';

interface HarnessOptions {
  overlay?: AppOverlay;
}

function renderShortcuts(options: HarnessOptions = {}) {
  const calls = {
    run: vi.fn(),
    stop: vi.fn(),
    saveActiveTab: vi.fn(),
    saveActiveTabAs: vi.fn(),
    openFileFromDisk: vi.fn(),
    closeActiveTab: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleConsole: vi.fn(),
    toggleOverlay: vi.fn(),
    closeOverlay: vi.fn(),
  };

  renderHook(() =>
    useGlobalShortcuts({
      isRunning: false,
      overlay: options.overlay ?? 'none',
      ...calls,
    })
  );

  return calls;
}

function dispatchKeyDown(init: KeyboardEventInit & { key: string }) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  });
}

describe('useGlobalShortcuts', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetShortcutOverrides();
  });

  it('dispatches the catalog default for toggle-sidebar (Mod+B)', () => {
    const calls = renderShortcuts();
    dispatchKeyDown({ key: 'b', ctrlKey: true });
    expect(calls.toggleSidebar).toHaveBeenCalledTimes(1);
  });

  it('routes a rebound combo to the correct action and skips the old one', () => {
    useSettingsStore
      .getState()
      .setShortcutOverride('view-toggle-sidebar', [{ tokens: ['Mod', 'Shift', 'J'] }]);

    const calls = renderShortcuts();

    dispatchKeyDown({ key: 'b', ctrlKey: true });
    expect(calls.toggleSidebar).not.toHaveBeenCalled();

    dispatchKeyDown({ key: 'j', ctrlKey: true, shiftKey: true });
    expect(calls.toggleSidebar).toHaveBeenCalledTimes(1);
  });

  it('only fires closeOverlay on Escape when an overlay is open', () => {
    const closed = renderShortcuts({ overlay: 'none' });
    dispatchKeyDown({ key: 'Escape' });
    expect(closed.closeOverlay).not.toHaveBeenCalled();

    const open = renderShortcuts({ overlay: 'settings' });
    dispatchKeyDown({ key: 'Escape' });
    expect(open.closeOverlay).toHaveBeenCalledTimes(1);
  });
});
