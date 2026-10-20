import { getActiveTab, useEditorStore } from '../stores/editorStore';
import { useUIStore } from '../stores/uiStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useDebuggerStore } from '../stores/debuggerStore';
import {
  comparableSnapshotCountFor,
  hasScopeSnapshotFor,
  useResultStore,
} from '../stores/resultStore';
import { useProjectStore } from '../stores/projectStore';
import { languageHasRuntimeModes } from '../../shared/runtimeModes';
import { isWorkerRunnerLanguage } from '../../shared/languageFamilies';
import { executionModeForLanguage, languageSupportsDebugger } from '../utils/languageMeta';
import { isBundledRecipeId } from '../data/recipes/recipeIds';
import { useDependenciesPanelAvailable } from '../components/Dependencies/useDependenciesPanelAvailable';
import { useGitDiffTabAvailable } from '../components/Editor/useGitDiffTabAvailable';
import type { DockTabAvailability } from '../components/Layout/dockTabs';

export interface DockShell {
  /** False in the editor-only layout and on full-screen Utilities tabs. */
  dockShown: boolean;
  /** The dock body is open: the user opened it, or a live session claims it. */
  dockExpanded: boolean;
  /** A debug session runs for the active tab, so its tab claims a hidden dock. */
  debuggerLive: boolean;
}

export interface LayoutAvailability extends DockShell {
  /** Which dock tabs apply to the active tab. Console always applies. */
  tabs: DockTabAvailability;
}

/**
 * Whether the dock shows and whether its body is open: the only gates the
 * shell needs, so a tab gate flipping does not re-render the whole layout.
 */
export function useDockShell(): DockShell {
  const layoutPreset = useSettingsStore(s => s.layoutPreset);
  const consoleVisible = useUIStore(s => s.consoleVisible);
  const activeTabId = useEditorStore(s => s.activeTabId);
  const activeKind = useEditorStore(s => getActiveTab(s)?.kind);
  const language = useEditorStore(s => getActiveTab(s)?.language);
  const runtimeMode = useEditorStore(s => getActiveTab(s)?.runtimeMode);
  const debuggerLive = useDebuggerStore(s => s.session !== null && s.session.tabId === activeTabId);
  const browserPreview = languageHasRuntimeModes(language) && runtimeMode === 'browser-preview';
  const dockShown = layoutPreset !== 'editor-only' && activeKind !== 'utilities';
  const claimed = browserPreview || (debuggerLive && languageSupportsDebugger(language));
  return {
    dockShown,
    dockExpanded: dockShown && (consoleVisible || claimed),
    debuggerLive,
  };
}

/** Every dock gate: the shell gates plus which tabs the dock lists. */
export function useLayoutAvailability(): LayoutAvailability {
  const shell = useDockShell();
  const showStdinPanel = useSettingsStore(s => s.showStdinPanel);
  const variableInspectorSurface = useSettingsStore(s => s.variableInspectorSurface);
  const activeTabId = useEditorStore(s => s.activeTabId);
  const language = useEditorStore(s => getActiveTab(s)?.language);
  const runtimeMode = useEditorStore(s => getActiveTab(s)?.runtimeMode);
  const recipeBindingId = useEditorStore(s => getActiveTab(s)?.recipeBindingId ?? null);
  const hasBreakpoints = useDebuggerStore(s =>
    activeTabId ? Object.values(s.breakpoints).some(bp => bp.tabId === activeTabId) : false
  );
  const comparableCount = useResultStore(s => comparableSnapshotCountFor(s, language));
  const hasScope = useResultStore(s => hasScopeSnapshotFor(s, language, runtimeMode));
  const hasProject = useProjectStore(s => s.currentProject !== null);
  const dependencies = useDependenciesPanelAvailable();
  const gitDiff = useGitDiffTabAvailable();

  const workerLanguage = isWorkerRunnerLanguage(language);
  const runMode = language !== undefined && executionModeForLanguage(language) === 'run';
  const tabs: DockTabAvailability = {
    stdin: showStdinPanel && runtimeMode !== 'browser-preview' && workerLanguage,
    compare: runMode && comparableCount > 0,
    variables:
      variableInspectorSurface === 'bottom' &&
      runMode &&
      runtimeMode !== 'node' &&
      workerLanguage &&
      hasScope,
    'project-terminal': hasProject && window.lingua?.projectTerminal !== undefined,
    debugger: languageSupportsDebugger(language) && (shell.debuggerLive || hasBreakpoints),
    'browser-preview': languageHasRuntimeModes(language) && runtimeMode === 'browser-preview',
    dependencies,
    'git-diff': gitDiff,
    recipe: recipeBindingId !== null && isBundledRecipeId(recipeBindingId),
  };

  return { tabs, ...shell };
}
