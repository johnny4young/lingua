import { describe, expect, it, vi } from 'vitest';
import { KEYBOARD_SHORTCUTS } from '@/data/keyboardShortcuts';
import { buildGlobalShortcutActions } from '@/hooks/globalShortcutActions';
import type { UseGlobalShortcutsOptions } from '@/hooks/globalShortcutTypes';
import { useEditorStore } from '@/stores/editorStore';
import { useExplainPanelStore } from '@/stores/explainPanelStore';
import { setActiveEditor } from '@/runtime/editorAccess';

function options(isRunning = false): UseGlobalShortcutsOptions {
  const callback = () => undefined;
  return {
    isRunning,
    overlay: 'none',
    run: vi.fn(),
    stop: vi.fn(),
    saveActiveTab: callback,
    saveActiveTabAs: callback,
    openFileFromDisk: callback,
    closeActiveTab: callback,
    toggleSidebar: callback,
    toggleConsole: callback,
    toggleOverlay: callback,
    openDeveloperUtilities: callback,
    closeOverlay: callback,
    toggleHttpWorkspace: callback,
    toggleSqlWorkspace: callback,
    openUtilityPipelines: callback,
    openImportOverlay: callback,
    exportProjectBundle: callback,
    openRecipesOverlay: callback,
    openNewNotebook: callback,
    cycleRuntimeMode: callback,
    cycleWorkflowMode: callback,
    toggleRecentRunsPopover: callback,
    toggleCompareWithSnapshot: callback,
    toggleVariableInspector: callback,
    toggleStdinPanel: callback,
    resetFloatingPositions: callback,
    toggleVariableInspectorSurface: callback,
    exportLatestCapsule: callback,
    copyShareLink: callback,
    replayOnboarding: callback,
    showDependenciesPanel: callback,
  };
}

describe('buildGlobalShortcutActions', () => {
  it('registers every dispatchable catalog entry', () => {
    const actions = buildGlobalShortcutActions(options());
    // The jump to an explained error is bound only while the panel has one (covered below).
    const missing = KEYBOARD_SHORTCUTS.filter(
      definition => definition.id !== 'overlay-close' && definition.id !== 'ai-jump-to-error' && !actions[definition.id]
    ).map(definition => definition.id);

    expect(missing).toEqual([]);
  });

  it('binds Cmd/Ctrl+J only while the explain panel has an error on the active tab', () => {
    useEditorStore.getState().restoreTabs([{ id: 'jump-tab', name: 'a.js', language: 'javascript', content: '' }] as never, 'jump-tab');
    useExplainPanelStore.setState({ target: null });
    expect(buildGlobalShortcutActions(options())['ai-jump-to-error']).toBeUndefined();
    useExplainPanelStore.setState({ target: { tabId: 'jump-tab', errorMessage: 'TypeError: x', line: 2, column: 5 } });
    const editor = { revealLineInCenter: vi.fn(), setPosition: vi.fn(), focus: vi.fn() };
    setActiveEditor(editor as never);
    buildGlobalShortcutActions(options())['ai-jump-to-error']?.(new KeyboardEvent('keydown'));
    expect(editor.revealLineInCenter).toHaveBeenCalledWith(2);
    expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 2, column: 5 });
    expect(editor.focus).toHaveBeenCalled();
    setActiveEditor(null);
    useExplainPanelStore.setState({ target: { tabId: 'another-tab', errorMessage: 'TypeError: x', line: 2, column: 5 } });
    expect(buildGlobalShortcutActions(options())['ai-jump-to-error']).toBeUndefined();
    useExplainPanelStore.setState({ target: null });
    useEditorStore.getState().restoreTabs([], null);
  });

  it('routes the run toggle to run or stop from the current state', () => {
    const idle = options(false);
    buildGlobalShortcutActions(idle)['run-toggle']?.(new KeyboardEvent('keydown'));
    expect(idle.run).toHaveBeenCalledTimes(1);
    expect(idle.stop).not.toHaveBeenCalled();

    const running = options(true);
    buildGlobalShortcutActions(running)['run-toggle']?.(new KeyboardEvent('keydown'));
    expect(running.stop).toHaveBeenCalledTimes(1);
    expect(running.run).not.toHaveBeenCalled();
  });

  it('runs the active workspace tab when focus is outside its editor', () => {
    const previous = useEditorStore.getState();
    useEditorStore.setState({
      tabs: [{ id: 'http', name: 'HTTP', language: 'http', content: '', kind: 'http' }],
      activeTabId: 'http',
    } as Partial<typeof previous>);
    try {
      const idle = options(false);
      buildGlobalShortcutActions(idle)['run-toggle']?.(new KeyboardEvent('keydown'));
      expect(idle.run).toHaveBeenCalledTimes(1);
    } finally {
      useEditorStore.setState({ tabs: previous.tabs, activeTabId: previous.activeTabId });
    }
  });
});
