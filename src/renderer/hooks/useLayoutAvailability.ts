import { getActiveTab, useEditorStore } from '../stores/editorStore';
import { useUIStore } from '../stores/uiStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useDebuggerStore } from '../stores/debuggerStore';
import { hasScopeSnapshotFor, useResultStore } from '../stores/resultStore';
import { languageHasRuntimeModes } from '../../shared/runtimeModes';
import { isWorkerRunnerLanguage } from '../../shared/languageFamilies';
import { languageSupportsDebugger } from '../utils/languageMeta';
import { getRecipeById } from '../data/recipes';

/**
 * RL-131 (AUDIT-11) — the bottom-panel availability gates the shell needs to
 * decide whether the console drawer (and which body inside it) should mount.
 * Each flag is `true` only when the active tab + settings + run-snapshot state
 * make that surface relevant; `editor-only` layout forces them all off.
 */
export interface LayoutAvailability {
  /** Console drawer is visible (and not suppressed by the editor-only layout). */
  showConsole: boolean;
  /** Debugger tab/body is relevant for the active tab. Also the `debuggerAvailable` prop for BottomPanel. */
  showDebuggerPanel: boolean;
  /** Browser-preview body is relevant (JS/TS tab in `browser-preview` runtime). */
  showBrowserPreviewPanel: boolean;
  /** Stdin body should stay mounted (focused via palette while the drawer is otherwise empty). */
  showStdinTabBody: boolean;
  /** Bottom Variables body should stay mounted (surface=bottom + capture available). */
  showVariablesTabBody: boolean;
  /** Recipe body should stay mounted (active tab is recipe-bound). */
  showRecipeTabBody: boolean;
}

/**
 * RL-131 (AUDIT-11) — the AppLayout-root availability gate cluster, extracted
 * verbatim from `AppLayout`. Computes the six MainContent gates from the editor
 * / UI / settings / result / debugger stores. Moved as-is (same derivations,
 * same RL-122 primitive `hasScopeSnapshotFor` subscription) so the resolved gate
 * values are identical to the inline original; only the store reads are now
 * fine-grained selectors rather than whole-store destructures, which can only
 * reduce re-renders, never change a gate's value.
 */
export function useLayoutAvailability(): LayoutAvailability {
  const layoutPreset = useSettingsStore((s) => s.layoutPreset);
  const consoleVisible = useUIStore((s) => s.consoleVisible);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const activeLanguage = useEditorStore((s) => getActiveTab(s)?.language);
  const activeRuntimeMode = useEditorStore((s) => getActiveTab(s)?.runtimeMode);
  // Slice 2 — debugger is baseline; the Settings toggle is gone.
  const debuggerEnabled = true;
  const debuggerSession = useDebuggerStore((state) => state.session);
  const activeBreakpointCount = useDebuggerStore((state) => {
    if (!activeTabId) return 0;
    let count = 0;
    for (const bp of Object.values(state.breakpoints)) {
      if (bp.tabId === activeTabId) count += 1;
    }
    return count;
  });

  const showConsole = consoleVisible && layoutPreset !== 'editor-only';
  const showDebuggerPanel =
    layoutPreset !== 'editor-only' &&
    debuggerEnabled &&
    languageSupportsDebugger(activeLanguage) &&
    (debuggerSession?.tabId === activeTabId || (consoleVisible && activeBreakpointCount > 0));
  const showBrowserPreviewPanel =
    layoutPreset !== 'editor-only' &&
    languageHasRuntimeModes(activeLanguage) &&
    activeRuntimeMode === 'browser-preview';
  // RL-020 Slice 6 — when the user focuses the stdin tab from the
  // command palette while the console drawer is collapsed,
  // `openBottomPanel('stdin')` flips `activeBottomPanel` but does
  // NOT set `consoleVisible: true` reliably across navigation. We
  // include the stdin body in the MainContent gate so the bottom
  // drawer renders for stdin even when none of the other panes is
  // shown.
  const activeBottomPanelForLayout = useUIStore((state) => state.activeBottomPanel);
  const showStdinPanelSetting = useSettingsStore((state) => state.showStdinPanel);
  const variableInspectorSurfaceForLayout = useSettingsStore(
    (state) => state.variableInspectorSurface,
  );
  const activeVariableInspectorEnabled = useEditorStore(
    (s) => getActiveTab(s)?.variableInspectorEnabled === true,
  );
  // RL-122 — the bottom Variables drawer only needs the availability
  // boolean, not the raw scope object; subscribe to the primitive so a
  // scope replacement that does not change availability is a no-op here.
  const hasScopeForActiveLayout = useResultStore((state) =>
    hasScopeSnapshotFor(state, activeLanguage, activeRuntimeMode),
  );
  const showStdinTabBody =
    layoutPreset !== 'editor-only' &&
    showStdinPanelSetting &&
    activeBottomPanelForLayout === 'stdin' &&
    activeRuntimeMode !== 'browser-preview' &&
    isWorkerRunnerLanguage(activeLanguage);
  // RL-093 Slice 3 — mirror BottomPanel.variablesAvailable so the
  // MainContent gate keeps the drawer mounted when Variables is the
  // sole reason to show it (no console, no debugger, no stdin).
  const showVariablesTabBody =
    layoutPreset !== 'editor-only' &&
    variableInspectorSurfaceForLayout === 'bottom' &&
    activeVariableInspectorEnabled &&
    activeBottomPanelForLayout === 'variables' &&
    isWorkerRunnerLanguage(activeLanguage) &&
    hasScopeForActiveLayout;
  const activeRecipeBindingIdForLayout = useEditorStore((state) => {
    if (!state.activeTabId) return null;
    return getActiveTab(state)?.recipeBindingId ?? null;
  });
  const showRecipeTabBody =
    layoutPreset !== 'editor-only' &&
    activeBottomPanelForLayout === 'recipe' &&
    activeRecipeBindingIdForLayout !== null &&
    getRecipeById(activeRecipeBindingIdForLayout) !== undefined;

  return {
    showConsole,
    showDebuggerPanel,
    showBrowserPreviewPanel,
    showStdinTabBody,
    showVariablesTabBody,
    showRecipeTabBody,
  };
}
