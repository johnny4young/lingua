import { claimCapsuleListSurface } from '../components/CapsuleList/capsuleListSurface';
import { getActiveEditorCursorLine } from '../runtime/editorAccess';
import { isDebugWorkerActive, postDebuggerMessage } from '../runtime/debuggerWorkerBridge';
import { useDebuggerStore } from '../stores/debuggerStore';
import { getActiveTab, useEditorStore } from '../stores/editorStore';
import { languageSupportsDebugger } from '../utils/languageMeta';
import { runUtilityApplyFromInput, writeUtilityOutputToClipboard } from './globalShortcutUtilities';
import type { ShortcutHandler, UseGlobalShortcutsOptions } from './globalShortcutTypes';

/** Build the catalog-id action map from the current App callbacks. */
export function buildGlobalShortcutActions(
  options: UseGlobalShortcutsOptions
): Record<string, ShortcutHandler> {
  return {
    'run-toggle': () => {
      if (options.isRunning) options.stop();
      else void options.run();
    },
    'run-cycle-runtime-mode': () => options.cycleRuntimeMode(),
    'run-cycle-workflow-mode': () => options.cycleWorkflowMode(),
    'run-toggle-recent-runs': () => options.toggleRecentRunsPopover(),
    'run-toggle-compare-snapshot': () => options.toggleCompareWithSnapshot(),
    'run-toggle-variable-inspector': () => options.toggleVariableInspector(),
    'editor-toggle-stdin-panel': () => options.toggleStdinPanel(),
    'run-export-capsule': () => options.exportLatestCapsule(),
    'run-copy-share-link': () => options.copyShareLink(),
    'onboarding-replay': () => options.replayOnboarding(),
    'view-show-dependencies': () => options.showDependenciesPanel(),
    'ui-reset-floating-positions': () => options.resetFloatingPositions(),
    'view-toggle-variable-inspector-surface': () => options.toggleVariableInspectorSurface(),
    'file-save': () => void options.saveActiveTab(),
    'file-save-as': () => void options.saveActiveTabAs(),
    'file-open': () => void options.openFileFromDisk(),
    'file-close-tab': () => void options.closeActiveTab(),
    'overlay-capsule-import': () => options.toggleOverlay('capsule-import'),
    'overlay-capsule-list': () => {
      claimCapsuleListSurface('shortcut');
      options.toggleOverlay('capsule-list');
    },
    'nav-quick-open': () => options.toggleOverlay('quick-open'),
    'nav-go-to-symbol': () => options.toggleOverlay('go-to-symbol'),
    'nav-project-search': () => options.toggleOverlay('search'),
    'nav-project-replace': () => options.toggleOverlay('replace'),
    'workspace-toggle-http': () => options.toggleHttpWorkspace(),
    'workspace-toggle-sql': () => options.toggleSqlWorkspace(),
    'action-open-utility-pipelines': () => options.openUtilityPipelines(),
    'action-open-import-overlay': () => options.openImportOverlay(),
    'action-export-project-bundle': () => options.exportProjectBundle(),
    'action-open-recipes': () => options.openRecipesOverlay(),
    'action-new-notebook': () => options.openNewNotebook(),
    'overlay-command-palette': () => options.toggleOverlay('palette'),
    'overlay-settings': () => options.toggleOverlay('settings'),
    'overlay-developer-utilities': () => options.openDeveloperUtilities(),
    'view-toggle-sidebar': () => options.toggleSidebar(),
    'view-toggle-console': () => options.toggleConsole(),
    'utility-copy-output': () => void writeUtilityOutputToClipboard('copy'),
    'utility-replace-clipboard': () => void writeUtilityOutputToClipboard('replace'),
    'utility-apply-from-input': () => runUtilityApplyFromInput(),
    'debugger-toggle-breakpoint': () => {
      const activeTab = getActiveDebuggerTab();
      if (!activeTab) return;
      const line = getActiveEditorCursorLine();
      if (!line) return;
      useDebuggerStore.getState().toggleBreakpoint(activeTab.id, line);
    },
    'debugger-continue': () => resumeDebugger({ type: 'resume' }),
    'debugger-step-over': () => resumeDebugger({ type: 'step', mode: 'over' }),
    'debugger-step-into': () => resumeDebugger({ type: 'step', mode: 'into' }),
    'debugger-step-out': () => resumeDebugger({ type: 'step', mode: 'out' }),
  };
}

type DebuggerMessage = Parameters<typeof postDebuggerMessage>[0];

function resumeDebugger(message: DebuggerMessage): void {
  if (postDebuggerMessage(message)) {
    useDebuggerStore.getState().setPausedFrame(null);
  }
}

export function canDispatchDebuggerShortcut(id: string): boolean {
  if (id === 'debugger-toggle-breakpoint') {
    return getActiveDebuggerTab() !== null && getActiveEditorCursorLine() !== null;
  }
  if (!isDebugWorkerActive()) return false;
  const pausedFrame = useDebuggerStore.getState().pausedFrame;
  if (!pausedFrame) return false;
  return id !== 'debugger-step-out' || pausedFrame.callStack.length > 0;
}

function getActiveDebuggerTab(): { id: string; language: string } | null {
  const activeTab = getActiveTab(useEditorStore.getState());
  if (!activeTab || !languageSupportsDebugger(activeTab.language)) return null;
  return activeTab;
}
