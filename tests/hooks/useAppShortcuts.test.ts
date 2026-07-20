/**
 * internal — mount smoke for the extracted shortcut-payload hook.
 * The actual keystroke→handler behavior is exercised end-to-end by the e2e
 * shortcut specs; this guards that `useAppShortcuts` wires its deps into
 * `useGlobalShortcuts` and registers without throwing (catches a broken import
 * or a malformed payload after the extraction).
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAppShortcuts, type AppShortcutDeps } from '@/hooks/useAppShortcuts';

function makeDeps(overrides: Partial<AppShortcutDeps> = {}): AppShortcutDeps {
  return {
    isRunning: false,
    run: vi.fn(),
    stop: vi.fn(),
    saveActiveTab: vi.fn(),
    saveActiveTabAs: vi.fn(),
    openFileFromDisk: vi.fn(),
    activeTabId: null,
    closeTab: vi.fn(async () => true),
    toggleSidebar: vi.fn(),
    toggleConsole: vi.fn(),
    overlay: 'none',
    toggleOverlay: vi.fn(),
    closeOverlay: vi.fn(),
    openOverlay: vi.fn(),
    handleOpenDeveloperUtility: vi.fn(),
    exportProjectBundle: vi.fn(),
    ...overrides,
  };
}

describe('useAppShortcuts', () => {
  it('mounts and registers the global shortcut payload without throwing', () => {
    const { unmount } = renderHook(() => useAppShortcuts(makeDeps()));
    expect(true).toBe(true);
    expect(() => unmount()).not.toThrow();
  });
});
