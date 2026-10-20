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

export interface LayoutAvailability {
  /** Which dock tabs apply to the active tab. Console always applies. */
  tabs: DockTabAvailability;
  /** False in the editor-only layout and on full-screen Utilities tabs. */
  dockShown: boolean;
  /** The dock body is open: the user opened it, or a live session claims it. */
  dockExpanded: boolean;
  /** A debug session runs for the active tab, so its tab claims a hidden dock. */
  debuggerLive: boolean;
}

/**
 * One source for every dock gate, read by the shell (whether the dock is
 * open) and by the dock (which tabs it lists). Primitive selectors keep a
 * keystroke from re-rendering the shell.
 */
export function useLayoutAvailability(): LayoutAvailability {
  const layoutPreset = useSettingsStore(s => s.layoutPreset);
  const showStdinPanel = useSettingsStore(s => s.showStdinPanel);
  const variableInspectorSurface = useSettingsStore(s => s.variableInspectorSurface);
  const consoleVisible = useUIStore(s => s.consoleVisible);
  const activeTabId = useEditorStore(s => s.activeTabId);
  const activeKind = useEditorStore(s => getActiveTab(s)?.kind);
  const language = useEditorStore(s => getActiveTab(s)?.language);
  const runtimeMode = useEditorStore(s => getActiveTab(s)?.runtimeMode);
  const recipeBindingId = useEditorStore(s => getActiveTab(s)?.recipeBindingId ?? null);
  const debuggerLive = useDebuggerStore(s => s.session !== null && s.session.tabId === activeTabId);
  const hasBreakpoints = useDebuggerStore(s =>
    activeTabId ? Object.values(s.breakpoints).some(bp => bp.tabId === activeTabId) : false
  );
  const comparableCount = useResultStore(s => comparableSnapshotCountFor(s, language));
  const hasScope = useResultStore(s => hasScopeSnapshotFor(s, language, runtimeMode));
  const hasProject = useProjectStore(s => s.currentProject !== null);
  const dependencies = useDependenciesPanelAvailable();
  const gitDiff = useGitDiffTabAvailable();

  const workerLanguage = isWorkerRunnerLanguage(language);
  const browserPreview = languageHasRuntimeModes(language) && runtimeMode === 'browser-preview';
  const debuggerTab = languageSupportsDebugger(language) && (debuggerLive || hasBreakpoints);
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
    debugger: debuggerTab,
    'browser-preview': browserPreview,
    dependencies,
    'git-diff': gitDiff,
    recipe: recipeBindingId !== null && isBundledRecipeId(recipeBindingId),
  };
  const dockShown = layoutPreset !== 'editor-only' && activeKind !== 'utilities';

  return {
    tabs,
    dockShown,
    dockExpanded: dockShown && (consoleVisible || browserPreview || (debuggerTab && debuggerLive)),
    debuggerLive,
  };
}
