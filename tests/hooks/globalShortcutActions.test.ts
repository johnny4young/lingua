import { describe, expect, it, vi } from 'vitest';
import { KEYBOARD_SHORTCUTS } from '@/data/keyboardShortcuts';
import { buildGlobalShortcutActions } from '@/hooks/globalShortcutActions';
import type { UseGlobalShortcutsOptions } from '@/hooks/globalShortcutTypes';

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
    const missing = KEYBOARD_SHORTCUTS.filter(
      definition => definition.id !== 'overlay-close' && !actions[definition.id]
    ).map(definition => definition.id);

    expect(missing).toEqual([]);
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
});
