import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGlobalShortcuts, type AppOverlay } from '@/hooks/useGlobalShortcuts';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';
import { useUtilityOutputStore } from '@/stores/utilityOutputStore';

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
    openDeveloperUtilities: vi.fn(),
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
    useUtilityOutputStore.getState().clearProvider();
    useUIStore.setState({ statusNotice: null });
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'Win32',
    });
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

  it('opens Developer Utilities from Mod+K', () => {
    const calls = renderShortcuts();
    dispatchKeyDown({ key: 'k', ctrlKey: true });
    expect(calls.openDeveloperUtilities).toHaveBeenCalledTimes(1);
    expect(calls.toggleOverlay).not.toHaveBeenCalledWith('utilities');
  });

  it('includes the active utility shortcut in copy success notices', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    useSettingsStore
      .getState()
      .setShortcutOverride('utility-copy-output', [{ tokens: ['Mod', 'Alt', 'C'] }]);
    useUtilityOutputStore.getState().setProvider(() => 'copied text');

    renderShortcuts();
    dispatchKeyDown({ key: 'c', ctrlKey: true, altKey: true });

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('copied text'));
    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'success',
      messageKey: 'utilities.toast.copyOutputSuccess',
      values: { shortcut: 'Ctrl+Alt+C' },
    });
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
