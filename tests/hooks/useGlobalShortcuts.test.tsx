import { act, renderHook, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import {
  takePendingClipboardApply,
  useClipboardOnFocus,
} from '@/hooks/useClipboardOnFocus';
import { useGlobalShortcuts, type AppOverlay } from '@/hooks/useGlobalShortcuts';
import { setActiveEditor } from '@/runtime/editorAccess';
import { setActiveDebugWorker } from '@/runtime/debuggerWorkerBridge';
import { useEditorStore } from '@/stores/editorStore';
import { useDebuggerStore } from '@/stores/debuggerStore';
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
    cycleRuntimeMode: vi.fn(),
    cycleWorkflowMode: vi.fn(),
    toggleRecentRunsPopover: vi.fn(),
    toggleCompareWithSnapshot: vi.fn(),
    toggleVariableInspector: vi.fn(),
    toggleStdinPanel: vi.fn(),
    exportLatestCapsule: vi.fn(),
    copyShareLink: vi.fn(),
    replayOnboarding: vi.fn(),
    showDependenciesPanel: vi.fn(),
    resetFloatingPositions: vi.fn(),
    toggleVariableInspectorSurface: vi.fn(),
    openImportOverlay: vi.fn(),
    openRecipesOverlay: vi.fn(),
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
  let event!: KeyboardEvent;
  act(() => {
    event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    window.dispatchEvent(event);
  });
  return event;
}

function mockClipboardRead(value: string) {
  const readText = vi.fn().mockResolvedValue(value);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { readText },
  });
  return readText;
}

describe('useGlobalShortcuts', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetShortcutOverrides();
    useDebuggerStore.setState({
      breakpoints: {},
      breakpointOrder: [],
      watches: [],
      session: null,
      pausedFrame: null,
    });
    useEditorStore.setState({
      tabs: [],
      activeTabId: null,
      pendingReveal: null,
    });
    setActiveEditor(null);
    setActiveDebugWorker(null);
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
    // `Mod+Shift+U` is a free combo in the production catalog —
    // verified by `tests/data/keyboardShortcuts.test.ts`. The earlier
    // choice was `Mod+Shift+J` but RL-025 Slice A bound that to
    // `view-show-dependencies`; the follow-up `Mod+Shift+Y` was taken
    // by RL-094 Slice 2 (capsule import overlay). U remains free, so
    // first-match-wins iteration in `useGlobalShortcuts` still routes
    // the overridden combo to the right action.
    useSettingsStore
      .getState()
      .setShortcutOverride('view-toggle-sidebar', [{ tokens: ['Mod', 'Shift', 'U'] }]);

    const calls = renderShortcuts();

    dispatchKeyDown({ key: 'b', ctrlKey: true });
    expect(calls.toggleSidebar).not.toHaveBeenCalled();

    dispatchKeyDown({ key: 'u', ctrlKey: true, shiftKey: true });
    expect(calls.toggleSidebar).toHaveBeenCalledTimes(1);
  });

  it('opens Developer Utilities from Mod+K', () => {
    const calls = renderShortcuts();
    dispatchKeyDown({ key: 'k', ctrlKey: true });
    expect(calls.openDeveloperUtilities).toHaveBeenCalledTimes(1);
    expect(calls.toggleOverlay).not.toHaveBeenCalledWith('utilities');
  });

  it('toggles Recent Runs from Mod+Alt+H', () => {
    // RL-024 Slice 2 — moved from Mod+Shift+H to Mod+Alt+H so the
    // VSCode-parity Mod+Shift+H binding can map to project-replace.
    const calls = renderShortcuts();
    dispatchKeyDown({ key: 'h', ctrlKey: true, altKey: true });
    expect(calls.toggleRecentRunsPopover).toHaveBeenCalledTimes(1);
  });

  it('opens Project Replace from Mod+Shift+H', () => {
    // RL-024 Slice 2 — VSCode-parity binding for replace-in-files.
    const calls = renderShortcuts();
    dispatchKeyDown({ key: 'h', ctrlKey: true, shiftKey: true });
    expect(calls.toggleOverlay).toHaveBeenCalledWith('replace');
  });

  // RL-093 polish #8 — the new Stdin / floating-position shortcuts
  // ship with FloatingActionPill + StdinInputPanel; tests guard the
  // dispatch path so a future override change can't silently strip
  // the binding.
  it('toggles the Stdin panel from Mod+Shift+E', () => {
    const calls = renderShortcuts();
    dispatchKeyDown({ key: 'e', ctrlKey: true, shiftKey: true });
    expect(calls.toggleStdinPanel).toHaveBeenCalledTimes(1);
  });

  it('exports the latest run capsule from Mod+Shift+X', () => {
    const calls = renderShortcuts();
    dispatchKeyDown({ key: 'x', ctrlKey: true, shiftKey: true });
    expect(calls.exportLatestCapsule).toHaveBeenCalledTimes(1);
  });

  it('resets floating positions from Mod+Shift+0', () => {
    const calls = renderShortcuts();
    dispatchKeyDown({ key: '0', ctrlKey: true, shiftKey: true });
    expect(calls.resetFloatingPositions).toHaveBeenCalledTimes(1);
  });

  it('toggles the variable inspector surface from Mod+Shift+V', () => {
    const calls = renderShortcuts();
    dispatchKeyDown({ key: 'v', ctrlKey: true, shiftKey: true });
    expect(calls.toggleVariableInspectorSurface).toHaveBeenCalledTimes(1);
  });

  it('opens the Import overlay from Mod+Alt+I', () => {
    const calls = renderShortcuts();
    dispatchKeyDown({ key: 'i', ctrlKey: true, altKey: true });
    expect(calls.openImportOverlay).toHaveBeenCalledTimes(1);
  });

  it('opens the Recipes overlay from Mod+Alt+L', () => {
    const calls = renderShortcuts();
    dispatchKeyDown({ key: 'l', ctrlKey: true, altKey: true });
    expect(calls.openRecipesOverlay).toHaveBeenCalledTimes(1);
  });

  it('includes the active utility shortcut in copy success notices', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    // RL-094 Slice 3 — Mod+Alt+C is now the default capsule-browse
    // binding (`overlay-capsule-list`), so this fixture's "free combo"
    // moved to Mod+Alt+J to keep exercising a custom override without a
    // catalog collision (same precedent as the Slice 2 Mod+Shift+Y→U
    // move).
    useSettingsStore
      .getState()
      .setShortcutOverride('utility-copy-output', [{ tokens: ['Mod', 'Alt', 'J'] }]);
    useUtilityOutputStore.getState().setProvider(() => 'copied text');

    renderShortcuts();
    dispatchKeyDown({ key: 'j', ctrlKey: true, altKey: true });

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('copied text'));
    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'success',
      messageKey: 'utilities.toast.copyOutputSuccess',
      values: { shortcut: 'Ctrl+Alt+J' },
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

  it('does not steal debugger function keys when no paused session exists', () => {
    renderShortcuts();
    const event = dispatchKeyDown({ key: 'F5' });
    expect(event.defaultPrevented).toBe(false);
  });

  it('routes debugger function keys only while paused', () => {
    const postMessage = vi.fn();
    setActiveDebugWorker({ postMessage } as unknown as Worker);
    useDebuggerStore.setState({
      session: { runtime: 'js', tabId: 'tab-1', attachedAt: 1 },
      pausedFrame: {
        tabId: 'tab-1',
        line: 2,
        reason: 'user-breakpoint',
        locals: {},
        callStack: [],
        watchResults: {},
      },
    });

    renderShortcuts();
    const event = dispatchKeyDown({ key: 'F10' });

    expect(event.defaultPrevented).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({ type: 'step', mode: 'over' });
    expect(useDebuggerStore.getState().pausedFrame).toBeNull();
  });

  it('toggles a breakpoint from Mod+Shift+B only on debugger-capable languages', () => {
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-js',
          name: 'untitled.js',
          language: 'javascript',
          content: 'console.log(1);',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-js',
    });
    setActiveEditor({
      getPosition: () => ({ lineNumber: 3, column: 1 }),
    } as never);

    renderShortcuts();
    const event = dispatchKeyDown({ key: 'b', ctrlKey: true, shiftKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(useDebuggerStore.getState().breakpoints['tab-js:3']).toMatchObject({
      tabId: 'tab-js',
      line: 3,
    });
  });

  it('does not steal Mod+Shift+B or create breakpoints on planned debugger languages', () => {
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-py',
          name: 'untitled.py',
          language: 'python',
          content: 'print(1)',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-py',
    });
    setActiveEditor({
      getPosition: () => ({ lineNumber: 2, column: 1 }),
    } as never);

    renderShortcuts();
    const event = dispatchKeyDown({ key: 'b', ctrlKey: true, shiftKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(useDebuggerStore.getState().breakpoints).toEqual({});
  });
});

describe('useClipboardOnFocus', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
    useSettingsStore.setState({ utilitiesClipboardOnFocusConsent: 'granted' }, false);
    useUIStore.setState({ statusNotice: null });
    takePendingClipboardApply();
  });

  it('does not read the clipboard when the toolbar has no apply target setter', async () => {
    const readText = mockClipboardRead('Lingua');

    renderHook(() =>
      useClipboardOnFocus('hash', () => true, vi.fn(), { enabled: false })
    );

    await Promise.resolve();
    expect(readText).not.toHaveBeenCalled();
    expect(takePendingClipboardApply()).toBeNull();
  });

  it('exposes a pending clipboard apply while mounted', async () => {
    mockClipboardRead('{"a":1}');
    const applyClipboardValue = vi.fn();

    renderHook(() =>
      useClipboardOnFocus(
        'json',
        (value) => value.startsWith('{'),
        applyClipboardValue
      )
    );

    await waitFor(() => {
      expect(useUIStore.getState().statusNotice).toMatchObject({
        tone: 'info',
        messageKey: 'utilities.toast.clipboardDetected',
      });
    });

    const pending = takePendingClipboardApply();
    expect(pending).toMatchObject({
      utilityId: 'json',
      value: '{"a":1}',
    });
    pending?.applyClipboardValue(pending.value);
    expect(applyClipboardValue).toHaveBeenCalledWith('{"a":1}');
  });

  it('clears stale pending clipboard values on unmount', async () => {
    mockClipboardRead('{"stale":true}');
    const applyClipboardValue = vi.fn();

    const { unmount } = renderHook(() =>
      useClipboardOnFocus(
        'json',
        (value) => value.startsWith('{'),
        applyClipboardValue
      )
    );

    await waitFor(() => {
      expect(useUIStore.getState().statusNotice?.messageKey).toBe(
        'utilities.toast.clipboardDetected'
      );
    });

    unmount();

    expect(takePendingClipboardApply()).toBeNull();
  });
});
