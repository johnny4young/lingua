import { useEffect } from 'react';
import {
  Boxes,
  Bug,
  Eye,
  GitBranch,
  GraduationCap,
  MessageSquare,
  Terminal,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ConsolePanel } from '../Console';
import { DebuggerDrawer } from '../Debugger/DebuggerDrawer';
import { BrowserPreviewPanel } from '../BrowserPreview';
import { StdinInputPanel } from '../Editor/StdinInputPanel';
import { VariableInspectorPanel } from '../Editor/VariableInspectorPanel';
import { DependenciesPanel } from '../Dependencies/DependenciesPanel';
import { useDependenciesPanelAvailable } from '../Dependencies/useDependenciesPanelAvailable';
import { useGitDiffTabAvailable } from '../Editor/useGitDiffTabAvailable';
import { GitDiffPanel } from '../Editor/GitDiffPanel';
import { RecipeRunPanel } from '../Recipes/RecipeRunPanel';
import { getRecipeById } from '../../data/recipes';
import { registerBrowserPreviewActivator } from '../../runtime/browserPreviewBridge';
import { languageHasRuntimeModes } from '../../../shared/runtimeModes';
import { isWorkerRunnerLanguage } from '../../../shared/languageFamilies';
import { Tooltip } from '../ui/chrome';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { getActiveTab, useEditorStore } from '../../stores/editorStore';
import { useResultStore } from '../../stores/resultStore';
import { useDebuggerStore } from '../../stores/debuggerStore';
import { cn } from '../../utils/cn';

/**
 * RL-131 (AUDIT-11) — the bottom console/debugger/preview/stdin/variables/
 * dependencies/git-diff/recipe drawer, extracted verbatim from `AppLayout.tsx`.
 * `debuggerAvailable` is computed by the shell (via `useLayoutAvailability`) and
 * passed in; every other availability gate + the `effectiveTab` resolution
 * ladder are unchanged from the inline original.
 */
export function BottomPanel({ debuggerAvailable }: { debuggerAvailable: boolean }) {
  const { t } = useTranslation();
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const activeLanguage = useEditorStore(
    (s) => getActiveTab(s)?.language
  );
  const activeRuntimeMode = useEditorStore(
    (s) => getActiveTab(s)?.runtimeMode
  );
  const activeVariableInspectorEnabled = useEditorStore(
    (s) => getActiveTab(s)?.variableInspectorEnabled === true
  );
  // RL-019 Slice 3 — the Browser preview tab is only relevant for
  // JS/TS tabs whose runtime mode is `browser-preview`. Other tabs
  // hide the tab button entirely.
  const browserPreviewAvailable =
    languageHasRuntimeModes(activeLanguage) && activeRuntimeMode === 'browser-preview';
  // RL-020 Slice 6 — the Input tab is offered for JS / TS / Python
  // tabs whose runtime mode is NOT `browser-preview` (the iframe
  // sandbox has no stdin surface). The user can also hide it
  // globally via Settings → Editor (fold D).
  const showStdinPanelSetting = useSettingsStore((state) => state.showStdinPanel);
  const variableInspectorSurface = useSettingsStore(
    (state) => state.variableInspectorSurface,
  );
  const scopeSnapshot = useResultStore((state) => state.scopeSnapshot);
  const stdinAvailable =
    showStdinPanelSetting &&
    activeRuntimeMode !== 'browser-preview' &&
    isWorkerRunnerLanguage(activeLanguage);
  // RL-093 Slice 3 — bottom-panel Variables tab is only offered when:
  // the user picked the bottom surface, the language supports the
  // inspector, a scope snapshot exists, and the per-tab flag is on.
  // Mirrors `FloatingVariablesCard`'s gate so the two surfaces show /
  // hide in lock-step.
  const variablesAvailable =
    variableInspectorSurface === 'bottom' &&
    activeVariableInspectorEnabled &&
    activeRuntimeMode !== 'node' &&
    isWorkerRunnerLanguage(activeLanguage) &&
    scopeSnapshot !== null &&
    scopeSnapshot.language === activeLanguage;
  const consoleVisible = useUIStore((state) => state.consoleVisible);
  const activeBottomPanel = useUIStore((state) => state.activeBottomPanel);
  const openBottomPanel = useUIStore((state) => state.openBottomPanel);
  const setActiveBottomPanel = useUIStore((state) => state.setActiveBottomPanel);
  // RL-044 Slice 2b-β-α — Prerequisite fix surfaced during validation.
  // The "hide bottom panel" affordance disappeared from the header
  // some time ago (no chevron / X button to collapse the console
  // surface — users had to find the `Cmd+\` shortcut). Re-add a
  // close button at the right edge of the tablist so the toggle is
  // discoverable; pair it with the restore strip in MainContent
  // that surfaces when the panel is hidden.
  const setConsoleVisible = useUIStore((state) => state.setConsoleVisible);

  // RL-019 Slice 3 — register the activator so the
  // BrowserPreviewRunner can switch to the preview tab before it
  // assigns `srcdoc`. Cleanup clears the registration when the
  // panel unmounts.
  useEffect(() => {
    registerBrowserPreviewActivator(openBottomPanel);
    return () => registerBrowserPreviewActivator(null);
  }, [openBottomPanel]);
  const activeBreakpointCount = useDebuggerStore((state) => {
    if (!activeTabId) return 0;
    let count = 0;
    for (const bp of Object.values(state.breakpoints)) {
      if (bp.tabId === activeTabId) count += 1;
    }
    return count;
  });
  const enabledBreakpointCount = useDebuggerStore((state) => {
    if (!activeTabId) return 0;
    let count = 0;
    for (const bp of Object.values(state.breakpoints)) {
      if (bp.tabId === activeTabId && bp.enabled !== false) count += 1;
    }
    return count;
  });
  const dependenciesAvailable = useDependenciesPanelAvailable();
  const gitDiffAvailable = useGitDiffTabAvailable();
  // RL-039 Slice B — gate the `recipe` bottom-panel tab on the
  // persisted tab binding, not the transient recipeStore Map. The
  // Map only owns run results / in-flight state; the tab field is
  // what survives session restore and explicit unbind.
  const activeRecipeBindingId = useEditorStore((state) => {
    if (!state.activeTabId) return null;
    return (
      getActiveTab(state)?.recipeBindingId ??
      null
    );
  });
  const recipeTabAvailable =
    activeRecipeBindingId !== null && getRecipeById(activeRecipeBindingId) !== undefined;
  const effectiveTab:
    | 'console'
    | 'debugger'
    | 'browser-preview'
    | 'stdin'
    | 'variables'
    | 'dependencies'
    | 'git-diff'
    | 'recipe' =
    variablesAvailable && activeBottomPanel === 'variables'
      ? 'variables'
      : browserPreviewAvailable && (activeBottomPanel === 'browser-preview' || !consoleVisible)
        ? 'browser-preview'
        : debuggerAvailable && (!consoleVisible || activeBottomPanel === 'debugger')
          ? 'debugger'
          : stdinAvailable && activeBottomPanel === 'stdin'
            ? 'stdin'
            : dependenciesAvailable && activeBottomPanel === 'dependencies'
              ? 'dependencies'
              : gitDiffAvailable && activeBottomPanel === 'git-diff'
                ? 'git-diff'
                // RL-039 Slice B — Recipes Run + Test panel. Only when
                // the active tab is bound (the overlay's "open recipe"
                // confirm flips here automatically).
                : recipeTabAvailable && activeBottomPanel === 'recipe'
                  ? 'recipe'
                  : 'console';

  useEffect(() => {
    if (activeBottomPanel === 'debugger' && !debuggerAvailable) {
      setActiveBottomPanel('console');
    }
    if (activeBottomPanel === 'browser-preview' && !browserPreviewAvailable) {
      setActiveBottomPanel('console');
    }
    if (activeBottomPanel === 'stdin' && !stdinAvailable) {
      setActiveBottomPanel('console');
    }
    if (activeBottomPanel === 'variables' && !variablesAvailable) {
      setActiveBottomPanel('console');
    }
    if (activeBottomPanel === 'dependencies' && !dependenciesAvailable) {
      setActiveBottomPanel('console');
    }
    if (activeBottomPanel === 'git-diff' && !gitDiffAvailable) {
      setActiveBottomPanel('console');
    }
    if (activeBottomPanel === 'recipe' && !recipeTabAvailable) {
      setActiveBottomPanel('console');
    }
  }, [
    activeBottomPanel,
    debuggerAvailable,
    browserPreviewAvailable,
    stdinAvailable,
    variablesAvailable,
    dependenciesAvailable,
    gitDiffAvailable,
    recipeTabAvailable,
    setActiveBottomPanel,
  ]);

  const selectTab = (
    tab:
      | 'console'
      | 'debugger'
      | 'browser-preview'
      | 'stdin'
      | 'variables'
      | 'dependencies'
      | 'git-diff'
      | 'recipe'
  ) => {
    if (tab === 'debugger' && !debuggerAvailable) return;
    if (tab === 'browser-preview' && !browserPreviewAvailable) return;
    if (tab === 'stdin' && !stdinAvailable) return;
    if (tab === 'variables' && !variablesAvailable) return;
    if (tab === 'dependencies' && !dependenciesAvailable) return;
    if (tab === 'git-diff' && !gitDiffAvailable) return;
    if (tab === 'recipe' && !recipeTabAvailable) return;
    openBottomPanel(tab);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background/65">
      <div
        role="tablist"
        aria-label={t('bottomPanel.tabs.label')}
        className="surface-header flex h-11 shrink-0 items-end gap-1 border-b border-border-strong/70 bg-surface-strong/70 px-2 pt-1"
      >
        <Tooltip content={t('bottomPanel.tabs.consoleHint')} side="bottom">
          <button
            type="button"
            role="tab"
            data-testid="bottom-panel-console-tab"
            aria-selected={effectiveTab === 'console'}
            onClick={() => selectTab('console')}
            className={cn(
              'relative -mb-px inline-flex h-10 items-center gap-2 rounded-t-md border border-border/70 border-b-border/80 bg-surface/45 px-3 text-[11px] font-bold uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
              effectiveTab === 'console'
                ? 'border-border-strong border-t-primary border-b-background bg-background text-foreground shadow-[0_1px_0_0_var(--app-background)]'
                : 'text-muted hover:border-border-strong/80 hover:bg-background/70 hover:text-foreground'
            )}
          >
            <Terminal size={12} aria-hidden="true" />
            {t('bottomPanel.tabs.console')}
          </button>
        </Tooltip>
        {debuggerAvailable ? (
          <Tooltip
            content={t('bottomPanel.tabs.debuggerHint', {
              enabled: enabledBreakpointCount,
              count: activeBreakpointCount,
            })}
            side="bottom"
          >
            <button
              type="button"
              role="tab"
              data-testid="bottom-panel-debugger-tab"
              aria-selected={effectiveTab === 'debugger'}
              onClick={() => selectTab('debugger')}
              className={cn(
                'relative -mb-px inline-flex h-10 items-center gap-2 rounded-t-md border border-border/70 border-b-border/80 bg-surface/45 px-3 text-[11px] font-bold uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                effectiveTab === 'debugger'
                  ? 'border-border-strong border-t-danger border-b-background bg-background text-danger shadow-[0_1px_0_0_var(--app-background)]'
                  : 'text-muted hover:border-border-strong/80 hover:bg-background/70 hover:text-danger'
              )}
            >
              <Bug size={12} aria-hidden="true" />
              {t('bottomPanel.tabs.debugger')}
              {activeBreakpointCount > 0 ? (
                <span
                  data-testid="bottom-panel-debugger-count"
                  className={cn(
                    'rounded border px-1.5 py-0.5 text-[10px] leading-none',
                    enabledBreakpointCount > 0
                      ? 'border-danger/30 bg-danger/10 text-danger'
                      : 'border-border/70 bg-surface text-muted'
                  )}
                >
                  {activeBreakpointCount}
                </span>
              ) : null}
            </button>
          </Tooltip>
        ) : null}
        {browserPreviewAvailable ? (
          <Tooltip content={t('bottomPanel.tabs.browserPreviewHint')} side="bottom">
            <button
              type="button"
              role="tab"
              data-testid="bottom-panel-browser-preview-tab"
              aria-selected={effectiveTab === 'browser-preview'}
              onClick={() => selectTab('browser-preview')}
              className={cn(
                'relative -mb-px inline-flex h-10 items-center gap-2 rounded-t-md border border-border/70 border-b-border/80 bg-surface/45 px-3 text-[11px] font-bold uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                effectiveTab === 'browser-preview'
                  ? 'border-border-strong border-t-primary border-b-background bg-background text-primary shadow-[0_1px_0_0_var(--app-background)]'
                  : 'text-muted hover:border-border-strong/80 hover:bg-background/70 hover:text-foreground'
              )}
            >
              <Eye size={12} aria-hidden="true" />
              {t('bottomPanel.tabs.browserPreview')}
            </button>
          </Tooltip>
        ) : null}
        {stdinAvailable ? (
          <Tooltip content={t('stdin.tab.hint')} side="bottom">
            <button
              type="button"
              role="tab"
              data-testid="bottom-panel-stdin-tab"
              aria-selected={effectiveTab === 'stdin'}
              onClick={() => selectTab('stdin')}
              className={cn(
                'relative -mb-px inline-flex h-10 items-center gap-2 rounded-t-md border border-border/70 border-b-border/80 bg-surface/45 px-3 text-[11px] font-bold uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                effectiveTab === 'stdin'
                  ? 'border-border-strong border-t-primary border-b-background bg-background text-foreground shadow-[0_1px_0_0_var(--app-background)]'
                  : 'text-muted hover:border-border-strong/80 hover:bg-background/70 hover:text-foreground'
              )}
            >
              <MessageSquare size={12} aria-hidden="true" />
              {t('stdin.tab.label')}
            </button>
          </Tooltip>
        ) : null}
        {variablesAvailable ? (
          <Tooltip content={t('bottomPanel.tabs.variablesHint')} side="bottom">
            <button
              type="button"
              role="tab"
              data-testid="bottom-panel-variables-tab"
              aria-selected={effectiveTab === 'variables'}
              onClick={() => selectTab('variables')}
              className={cn(
                'relative -mb-px inline-flex h-10 items-center gap-2 rounded-t-md border border-border/70 border-b-border/80 bg-surface/45 px-3 text-[11px] font-bold uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                effectiveTab === 'variables'
                  ? 'border-border-strong border-t-primary border-b-background bg-background text-foreground shadow-[0_1px_0_0_var(--app-background)]'
                  : 'text-muted hover:border-border-strong/80 hover:bg-background/70 hover:text-foreground'
              )}
            >
              <Eye size={12} aria-hidden="true" />
              {t('bottomPanel.tabs.variables')}
            </button>
          </Tooltip>
        ) : null}
        {dependenciesAvailable ? (
          <Tooltip content={t('dependencies.tab.hint')} side="bottom">
            <button
              type="button"
              role="tab"
              data-testid="bottom-panel-dependencies-tab"
              aria-selected={effectiveTab === 'dependencies'}
              onClick={() => selectTab('dependencies')}
              className={cn(
                'relative -mb-px inline-flex h-10 items-center gap-2 rounded-t-md border border-border/70 border-b-border/80 bg-surface/45 px-3 text-[11px] font-bold uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                effectiveTab === 'dependencies'
                  ? 'border-border-strong border-t-primary border-b-background bg-background text-foreground shadow-[0_1px_0_0_var(--app-background)]'
                  : 'text-muted hover:border-border-strong/80 hover:bg-background/70 hover:text-foreground'
              )}
            >
              <Boxes size={12} aria-hidden="true" />
              {t('dependencies.tab.label')}
            </button>
          </Tooltip>
        ) : null}
        {gitDiffAvailable ? (
          <Tooltip content={t('editor.git.diffPanel.tabHint')} side="bottom">
            <button
              type="button"
              role="tab"
              data-testid="bottom-panel-git-diff-tab"
              aria-selected={effectiveTab === 'git-diff'}
              onClick={() => selectTab('git-diff')}
              className={cn(
                'relative -mb-px inline-flex h-10 items-center gap-2 rounded-t-md border border-border/70 border-b-border/80 bg-surface/45 px-3 text-[11px] font-bold uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                effectiveTab === 'git-diff'
                  ? 'border-border-strong border-t-primary border-b-background bg-background text-foreground shadow-[0_1px_0_0_var(--app-background)]'
                  : 'text-muted hover:border-border-strong/80 hover:bg-background/70 hover:text-foreground'
              )}
            >
              <GitBranch size={12} aria-hidden="true" />
              {t('editor.git.diffPanel.tabLabel')}
            </button>
          </Tooltip>
        ) : null}
        {/* MOV.02 (FASE 3) — the HTTP + SQL workspace dock tabs were
            removed. Both surfaces are now full-screen `FileTab`s mounted
            in the editor area (see EditorArea's activeSqlTabId /
            activeHttpTabId branches). The dock keeps only ephemeral
            streams + contextual panels. */}
        {/* RL-039 Slice B — Recipes Run + Test tab. Only mounts when
            the active tab has a recipe binding (the overlay's open-
            recipe confirm sets the binding + flips the panel here). */}
        {recipeTabAvailable ? (
          <Tooltip content={t('recipes.tab.hint')} side="bottom">
            <button
              type="button"
              role="tab"
              data-testid="bottom-panel-recipe-tab"
              aria-selected={effectiveTab === 'recipe'}
              onClick={() => selectTab('recipe')}
              className={cn(
                'relative -mb-px inline-flex h-10 items-center gap-2 rounded-t-md border border-border/70 border-b-border/80 bg-surface/45 px-3 text-[11px] font-bold uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                effectiveTab === 'recipe'
                  ? 'border-border-strong border-t-primary border-b-background bg-background text-foreground shadow-[0_1px_0_0_var(--app-background)]'
                  : 'text-muted hover:border-border-strong/80 hover:bg-background/70 hover:text-foreground'
              )}
            >
              <GraduationCap size={12} aria-hidden="true" />
              {t('recipes.tab.label')}
            </button>
          </Tooltip>
        ) : null}
        <Tooltip content={t('bottomPanel.actions.hide')} side="bottom">
          <button
            type="button"
            data-testid="bottom-panel-hide"
            aria-label={t('bottomPanel.actions.hide')}
            onClick={() => setConsoleVisible(false)}
            className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-fg-subtle hover:border-border-strong/70 hover:bg-background/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {effectiveTab === 'debugger' ? (
          <DebuggerDrawer activeTabId={activeTabId ?? null} activeLanguage={activeLanguage} />
        ) : effectiveTab === 'browser-preview' ? (
          <BrowserPreviewPanel />
        ) : effectiveTab === 'stdin' ? (
          <StdinInputPanel />
        ) : effectiveTab === 'variables' ? (
          <VariableInspectorPanel language={activeLanguage ?? 'javascript'} />
        ) : effectiveTab === 'dependencies' ? (
          <DependenciesPanel />
        ) : effectiveTab === 'git-diff' ? (
          <GitDiffPanel />
        ) : effectiveTab === 'recipe' ? (
          <RecipeRunPanel />
        ) : (
          <ConsolePanel />
        )}
      </div>
    </div>
  );
}
