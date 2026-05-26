import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  Boxes,
  Bug,
  ChevronUp,
  Clock3,
  Eye,
  GitBranch,
  GitCompare,
  Globe,
  MessageSquare,
  PanelLeft,
  Terminal,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { FileTree } from '../FileTree';
import { EditorTabs } from '../Editor/EditorTabs';
import { GitProjectBranchChip } from '../Editor/GitProjectBranchChip';
import { ResultPanel } from '../Editor/ResultPanel';
import { ConsolePanel } from '../Console';
import { DebuggerDrawer } from '../Debugger/DebuggerDrawer';
import { BrowserPreviewPanel } from '../BrowserPreview';
import { StdinInputPanel } from '../Editor/StdinInputPanel';
import { FloatingVariablesCard } from '../Editor/FloatingVariablesCard';
import { VariableInspectorPanel } from '../Editor/VariableInspectorPanel';
import { DependenciesPanel } from '../Dependencies/DependenciesPanel';
import { useDependenciesPanelAvailable } from '../Dependencies/useDependenciesPanelAvailable';
import { useGitDiffTabAvailable } from '../Editor/useGitDiffTabAvailable';
import { GitDiffPanel } from '../Editor/GitDiffPanel';
import { HttpWorkspacePanel } from '../HttpWorkspace';
import { AppChrome } from '../Chrome';
import { registerBrowserPreviewActivator } from '../../runtime/browserPreviewBridge';
import { languageHasRuntimeModes } from '../../../shared/runtimeModes';
import { Toolbar } from '../Toolbar';
import { FloatingActionPill } from '../Toolbar/FloatingActionPill';
import { IconButton, OverlayBackdrop, Tooltip } from '../ui/chrome';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { useEditorStore } from '../../stores/editorStore';
import { useResultStore } from '../../stores/resultStore';
import { useDebuggerStore } from '../../stores/debuggerStore';
import { executionModeForLanguage, languageSupportsDebugger } from '../../utils/languageMeta';
import { cn } from '../../utils/cn';
import { syncVariableInspectorSurfaceAfterToggle } from '../../utils/variableInspectorSurface';
import type { LayoutPreset } from '../../types';

const COMPACT_SHELL_BREAKPOINT = 1180;
const RESIZE_TARGET_MINIMUM_SIZE = { coarse: 24, fine: 24 } as const;

function getFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute('disabled') && element.tabIndex !== -1);
}

const CodeEditor = lazy(async () => {
  const module = await import('../Editor/CodeEditor');
  return { default: module.CodeEditor };
});

function useCompactShellLayout() {
  const [isCompact, setIsCompact] = useState(() => window.innerWidth < COMPACT_SHELL_BREAKPOINT);

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${COMPACT_SHELL_BREAKPOINT - 1}px)`);
    const update = () => setIsCompact(mediaQuery.matches);

    update();
    mediaQuery.addEventListener('change', update);

    return () => {
      mediaQuery.removeEventListener('change', update);
    };
  }, []);

  return isCompact;
}

function ResizeHandle({ orientation = 'vertical' }: { orientation?: 'vertical' | 'horizontal' }) {
  const isVertical = orientation === 'vertical';
  // RL-093 — keep the inner divider transparent so the editor +
  // result panel read as ONE canvas. The hit zone stays 3px wide
  // so power users can still resize, and the bar fades in on hover.
  return (
    <Separator
      className={`group relative flex items-center justify-center transition-colors ${
        isVertical
          ? '-mx-1 w-3 cursor-col-resize hover:bg-accent/5'
          : '-my-1 h-3 cursor-row-resize hover:bg-accent/5'
      }`}
    >
      <div
        className={`rounded-full bg-transparent transition-colors group-hover:bg-border-strong ${
          isVertical ? 'h-[78%] w-px' : 'h-px w-[78%]'
        }`}
      />
    </Separator>
  );
}

function countStdinLines(buffer: string | undefined): number {
  if (!buffer) return 0;
  const lines = buffer.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

function PanelChipsRow() {
  const { t } = useTranslation();
  const activeTab = useEditorStore((state) => {
    const tab = state.tabs.find((item) => item.id === state.activeTabId);
    return tab ?? null;
  });
  const setTabCompareEnabled = useEditorStore((state) => state.setTabCompareEnabled);
  const setTabVariableInspectorEnabled = useEditorStore(
    (state) => state.setTabVariableInspectorEnabled,
  );
  const showStdinPanel = useSettingsStore((state) => state.showStdinPanel);
  const variableInspectorSurface = useSettingsStore(
    (state) => state.variableInspectorSurface,
  );
  const activeBottomPanel = useUIStore((state) => state.activeBottomPanel);
  const consoleVisible = useUIStore((state) => state.consoleVisible);
  const openBottomPanel = useUIStore((state) => state.openBottomPanel);
  const setConsoleVisible = useUIStore((state) => state.setConsoleVisible);
  const snapshotRing = useResultStore((state) => state.snapshotRing);
  const scopeSnapshot = useResultStore((state) => state.scopeSnapshot);

  if (!activeTab) return null;

  const executionMode = executionModeForLanguage(activeTab.language);
  const stdinAvailable =
    showStdinPanel &&
    activeTab.runtimeMode !== 'browser-preview' &&
    (activeTab.language === 'javascript' ||
      activeTab.language === 'typescript' ||
      activeTab.language === 'python');
  const stdinLineCount = countStdinLines(activeTab.stdinBuffer);
  const compareAvailable =
    executionMode === 'run' &&
    snapshotRing.some((entry) => entry.language === activeTab.language);
  const variableAvailable =
    executionMode === 'run' &&
    activeTab.runtimeMode !== 'node' &&
    (activeTab.language === 'javascript' ||
      activeTab.language === 'typescript' ||
      activeTab.language === 'python') &&
    scopeSnapshot !== null &&
    scopeSnapshot.language === activeTab.language;

  const chips = [
    {
      id: 'stdin',
      icon: MessageSquare,
      label: t('panelChips.stdin'),
      badge: stdinLineCount > 0 ? String(stdinLineCount) : null,
      active: activeBottomPanel === 'stdin' && consoleVisible,
      disabled: !stdinAvailable,
      title: stdinAvailable ? t('panelChips.stdin.tooltip') : t('panelChips.stdin.disabled'),
      onClick: () => {
        if (activeBottomPanel === 'stdin' && consoleVisible) {
          setConsoleVisible(false);
        } else {
          openBottomPanel('stdin');
        }
      },
    },
    {
      id: 'history',
      icon: Clock3,
      label: t('panelChips.history'),
      badge: null,
      active: activeBottomPanel === 'console' && consoleVisible,
      disabled: false,
      title: t('panelChips.history.tooltip'),
      onClick: () => {
        if (activeBottomPanel === 'console' && consoleVisible) {
          setConsoleVisible(false);
        } else {
          openBottomPanel('console');
        }
      },
    },
    {
      id: 'compare',
      icon: GitCompare,
      label: t('panelChips.compare'),
      badge: compareAvailable
        ? String(snapshotRing.filter((entry) => entry.language === activeTab.language).length)
        : null,
      active: activeTab.compareWithSnapshotEnabled === true,
      disabled: !compareAvailable,
      title: compareAvailable
        ? t('panelChips.compare.tooltip')
        : t('compare.toggle.tooltipDisabled'),
      onClick: () =>
        setTabCompareEnabled(activeTab.id, activeTab.compareWithSnapshotEnabled !== true),
    },
    {
      id: 'variables',
      icon: Eye,
      label: t('panelChips.variables'),
      badge: variableAvailable ? String(scopeSnapshot?.variables.length ?? 0) : null,
      // RL-093 Slice 3 — when surface=bottom, active state mirrors the
      // bottom-panel tab selection so clicking the chip when the
      // bottom Variables tab is showing toggles the drawer off.
      active:
        variableInspectorSurface === 'bottom'
          ? activeBottomPanel === 'variables' && consoleVisible
          : activeTab.variableInspectorEnabled === true,
      disabled: !variableAvailable,
      title: variableAvailable
        ? t('panelChips.variables.tooltip')
        : t('variableInspector.toggle.tooltipDisabled'),
      onClick: () => {
        // RL-093 Slice 3 — bottom mode treats the drawer selection as the
        // visible toggle. If the per-tab flag is already true but the drawer
        // is not showing Variables, clicking the inactive chip must open the
        // Variables tab rather than silently turning the feature off.
        const variablesDrawerOpen =
          activeBottomPanel === 'variables' && consoleVisible;
        const nextEnabled =
          variableInspectorSurface === 'bottom'
            ? !variablesDrawerOpen
            : activeTab.variableInspectorEnabled !== true;
        setTabVariableInspectorEnabled(activeTab.id, nextEnabled);
        syncVariableInspectorSurfaceAfterToggle(nextEnabled);
      },
    },
  ] as const;

  return (
    <div className="panel-chip-row" role="toolbar" aria-label={t('panelChips.ariaLabel')}>
      {chips.map((chip) => {
        const Icon = chip.icon;
        return (
          <button
            key={chip.id}
            type="button"
            data-testid={`panel-chip-${chip.id}`}
            className={cn(
              'panel-chip',
              chip.active && 'panel-chip-active',
              chip.disabled && 'cursor-not-allowed opacity-45',
            )}
            aria-pressed={chip.active}
            disabled={chip.disabled}
            title={chip.title}
            onClick={chip.onClick}
          >
            <Icon size={11} aria-hidden />
            <span>{chip.label}</span>
            {chip.badge ? <span className="panel-chip-badge">{chip.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function EditorArea() {
  const hasTabs = useEditorStore((s) => s.tabs.length > 0);
  const { t } = useTranslation();
  const sidebarVisible = useUIStore((s) => s.sidebarVisible);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const editorResultsLayout = useDefaultLayout({
    id: 'lingua-editor-results-layout',
    panelIds: ['editor-panel', 'results-panel'],
    storage: localStorage,
  });

  return (
    <div id="guided-tour-editor" className="flex h-full flex-col">
      <div className="surface-header flex h-[34px] shrink-0 items-stretch overflow-hidden bg-surface-strong/72">
        <div className="flex h-full shrink-0 items-center border-r border-border/60 px-1.5">
          <IconButton
            onClick={toggleSidebar}
            active={sidebarVisible}
            tooltip={t('toolbar.sidebar.toggle')}
            tooltipSide="bottom"
            aria-controls="project-explorer"
            aria-expanded={sidebarVisible}
            data-testid="editor-sidebar-toggle"
            className="size-7 rounded-md"
          >
            <PanelLeft size={14} />
          </IconButton>
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <EditorTabs />
        </div>
        {/* RL-102 Slice 2 fold C — project-wide branch chip.
            Self-renders to null when no git posture; positioned at
            the right of the editor-tabs chrome so it never competes
            with the per-tab pills for space. */}
        <GitProjectBranchChip />
      </div>
      <PanelChipsRow />
      <div className="min-h-0 flex-1">
        {hasTabs ? (
          <>
            <Group
              orientation="horizontal"
              defaultLayout={editorResultsLayout.defaultLayout}
              onLayoutChanged={editorResultsLayout.onLayoutChanged}
              resizeTargetMinimumSize={RESIZE_TARGET_MINIMUM_SIZE}
              className="unified-editor-canvas relative overflow-visible"
            >
              <Panel
                id="editor-panel"
                defaultSize="75%"
                minSize={320}
                className="relative z-20 overflow-visible"
              >
                <div className="relative h-full overflow-visible">
                  <Suspense fallback={<EditorLoadingState />}>
                    <CodeEditor />
                  </Suspense>
                </div>
              </Panel>
              <ResizeHandle orientation="vertical" />
              <Panel
                id="results-panel"
                defaultSize="25%"
                minSize={220}
                className="relative z-10 overflow-hidden bg-[var(--color-editor-bg)]"
              >
                <ResultPanel />
              </Panel>
            </Group>
            <FloatingVariablesCard />
          </>
        ) : (
          <Suspense fallback={<EditorLoadingState />}>
            <CodeEditor />
          </Suspense>
        )}
      </div>
    </div>
  );
}

function EditorLoadingState() {
  const { t } = useTranslation();

  return (
    <div className="flex h-full items-center justify-center bg-background text-sm text-muted">
      {t('layout.loadingEditor')}
    </div>
  );
}

interface MainContentProps {
  showConsole: boolean;
  showDebuggerPanel: boolean;
  showBrowserPreviewPanel: boolean;
  /**
   * RL-020 Slice 6 — true when the active tab + Settings combination
   * permits the stdin panel AND the user has actively focused it via
   * the command palette / palette focus action. Without this term in
   * the `showBottomPanel` gate, `openBottomPanel('stdin')` from a
   * console-closed state would set the store flag but never mount
   * the panel.
   */
  showStdinTabBody: boolean;
  /**
   * RL-093 Slice 3 — true when surface=bottom + variables capture
   * available + active panel is 'variables'. Same shape as
   * `showStdinTabBody`: keeps the drawer mounted when Variables is
   * the only thing the user wants visible.
   */
  showVariablesTabBody: boolean;
  layoutPreset: LayoutPreset;
}

function BottomPanel({ debuggerAvailable }: { debuggerAvailable: boolean }) {
  const { t } = useTranslation();
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const activeLanguage = useEditorStore(
    (s) => s.tabs.find((tab) => tab.id === s.activeTabId)?.language
  );
  const activeRuntimeMode = useEditorStore(
    (s) => s.tabs.find((tab) => tab.id === s.activeTabId)?.runtimeMode
  );
  const activeVariableInspectorEnabled = useEditorStore(
    (s) => s.tabs.find((tab) => tab.id === s.activeTabId)?.variableInspectorEnabled === true
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
    (activeLanguage === 'javascript' ||
      activeLanguage === 'typescript' ||
      activeLanguage === 'python');
  // RL-093 Slice 3 — bottom-panel Variables tab is only offered when:
  // the user picked the bottom surface, the language supports the
  // inspector, a scope snapshot exists, and the per-tab flag is on.
  // Mirrors `FloatingVariablesCard`'s gate so the two surfaces show /
  // hide in lock-step.
  const variablesAvailable =
    variableInspectorSurface === 'bottom' &&
    activeVariableInspectorEnabled &&
    activeRuntimeMode !== 'node' &&
    (activeLanguage === 'javascript' ||
      activeLanguage === 'typescript' ||
      activeLanguage === 'python') &&
    scopeSnapshot !== null &&
    scopeSnapshot.language === activeLanguage;
  const consoleVisible = useUIStore((state) => state.consoleVisible);
  const activeBottomPanel = useUIStore((state) => state.activeBottomPanel);
  const httpWorkspaceTabVisible = useUIStore(
    (state) => state.httpWorkspaceTabVisible
  );
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
  const effectiveTab:
    | 'console'
    | 'debugger'
    | 'browser-preview'
    | 'stdin'
    | 'variables'
    | 'dependencies'
    | 'git-diff'
    | 'http' =
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
                // RL-097 Slice 1 — HTTP workspace tab. Always available
                // (no entitlement / folder gate); shows when explicitly
                // activated via Mod+Shift+K or the command palette.
                : activeBottomPanel === 'http'
                  ? 'http'
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
  }, [
    activeBottomPanel,
    debuggerAvailable,
    browserPreviewAvailable,
    stdinAvailable,
    variablesAvailable,
    dependenciesAvailable,
    gitDiffAvailable,
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
      | 'http'
  ) => {
    if (tab === 'debugger' && !debuggerAvailable) return;
    if (tab === 'browser-preview' && !browserPreviewAvailable) return;
    if (tab === 'stdin' && !stdinAvailable) return;
    if (tab === 'variables' && !variablesAvailable) return;
    if (tab === 'dependencies' && !dependenciesAvailable) return;
    if (tab === 'git-diff' && !gitDiffAvailable) return;
    // RL-097 — `'http'` is unconditional (always available).
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
        {/* RL-097 Slice 1 — HTTP workspace tab. Hidden on first boot;
            remains in the strip after first activation via Mod+Shift+K
            or the palette so the user can switch back from Console. */}
        {httpWorkspaceTabVisible || effectiveTab === 'http' ? (
          <Tooltip content={t('httpWorkspace.tab.hint')} side="bottom">
            <button
              type="button"
              role="tab"
              data-testid="bottom-panel-http-tab"
              aria-selected={effectiveTab === 'http'}
              onClick={() => selectTab('http')}
              className={cn(
                'relative -mb-px inline-flex h-10 items-center gap-2 rounded-t-md border border-border/70 border-b-border/80 bg-surface/45 px-3 text-[11px] font-bold uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                effectiveTab === 'http'
                  ? 'border-border-strong border-t-primary border-b-background bg-background text-foreground shadow-[0_1px_0_0_var(--app-background)]'
                  : 'text-muted hover:border-border-strong/80 hover:bg-background/70 hover:text-foreground'
              )}
            >
              <Globe size={12} aria-hidden="true" />
              {t('httpWorkspace.tab.label')}
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
        ) : effectiveTab === 'http' ? (
          <HttpWorkspacePanel />
        ) : (
          <ConsolePanel />
        )}
      </div>
    </div>
  );
}

function MainContent({
  showConsole,
  showDebuggerPanel,
  showBrowserPreviewPanel,
  showStdinTabBody,
  showVariablesTabBody,
  layoutPreset,
}: MainContentProps) {
  const verticalLayout = useDefaultLayout({
    id: 'lingua-main-vertical-layout',
    panelIds: ['workspace-panel', 'console-panel'],
    storage: localStorage,
  });
  const horizontalLayout = useDefaultLayout({
    id: 'lingua-main-horizontal-layout',
    panelIds: ['workspace-panel', 'console-panel'],
    storage: localStorage,
  });

  const showBottomPanel =
    showConsole ||
    showDebuggerPanel ||
    showBrowserPreviewPanel ||
    showStdinTabBody ||
    showVariablesTabBody;

  if (!showBottomPanel) return <EditorAreaWithConsoleRestoreStrip />;

  if (layoutPreset === 'vertical') {
    return (
      <Group
        orientation="horizontal"
        defaultLayout={verticalLayout.defaultLayout}
        onLayoutChanged={verticalLayout.onLayoutChanged}
        resizeTargetMinimumSize={RESIZE_TARGET_MINIMUM_SIZE}
      >
        <Panel id="workspace-panel" defaultSize="60%" minSize={420}>
          <EditorArea />
        </Panel>
        <ResizeHandle orientation="vertical" />
        <Panel id="console-panel" defaultSize="40%" minSize={260}>
          <BottomPanel debuggerAvailable={showDebuggerPanel} />
        </Panel>
      </Group>
    );
  }

  // horizontal (default)
  return (
    <Group
      orientation="vertical"
      defaultLayout={horizontalLayout.defaultLayout}
      onLayoutChanged={horizontalLayout.onLayoutChanged}
      resizeTargetMinimumSize={RESIZE_TARGET_MINIMUM_SIZE}
    >
      <Panel id="workspace-panel" defaultSize="70%" minSize={260}>
        <EditorArea />
      </Panel>
      <ResizeHandle orientation="horizontal" />
      <Panel id="console-panel" defaultSize="30%" minSize={160}>
        <BottomPanel debuggerAvailable={showDebuggerPanel} />
      </Panel>
    </Group>
  );
}

/**
 * RL-044 Slice 2b-β-α — Prerequisite fix surfaced during validation.
 *
 * Wraps `<EditorArea>` with a thin restore strip pinned to the bottom
 * when the console / bottom panel is hidden. Without it, hiding the
 * panel via `Cmd+\` or the new tablist close button left the user
 * with NO visible affordance to bring it back — only the keyboard
 * shortcut, which is undiscoverable. The strip is intentionally low
 * profile (24px, chevron-up + label) so it doesn't compete with the
 * editor surface but stays clickable.
 */
function EditorAreaWithConsoleRestoreStrip() {
  const { t } = useTranslation();
  const setConsoleVisible = useUIStore((state) => state.setConsoleVisible);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <EditorArea />
      </div>
      <button
        type="button"
        data-testid="bottom-panel-restore"
        onClick={() => setConsoleVisible(true)}
        className="flex h-6 shrink-0 items-center justify-center gap-2 border-t border-border-strong/60 bg-surface-strong/60 text-[10.5px] font-bold uppercase tracking-[0.14em] text-fg-subtle transition-colors hover:bg-surface-strong/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        aria-label={t('bottomPanel.actions.show')}
      >
        <ChevronUp size={12} aria-hidden="true" />
        {t('bottomPanel.tabs.console')}
        <span className="ml-1 text-fg-subtle">⌘\</span>
      </button>
    </div>
  );
}

interface AppLayoutProps {
  onOpenSettings?: () => void;
  onOpenPalette?: () => void;
  /**
   * RL-093 follow-up — toolbar action icons live in FloatingActionPill,
   * so keep the overlay callbacks flowing through this layout boundary.
   */
  onOpenQuickOpen?: () => void;
  onOpenSnippets?: () => void;
  onOpenUtilities?: () => void;
  utilitiesOpen?: boolean;
}

interface SidebarPanelProps {
  panelRef?: RefObject<HTMLDivElement | null>;
  onNavigate?: () => void;
}

function SidebarPanel({ panelRef, onNavigate }: SidebarPanelProps) {
  return (
    <div
      id="project-explorer"
      ref={panelRef}
      tabIndex={-1}
      className="surface-panel h-full min-w-0 overflow-hidden"
    >
      <FileTree onNavigate={onNavigate} />
    </div>
  );
}

export function AppLayout({
  onOpenSettings,
  onOpenPalette,
  onOpenQuickOpen,
  onOpenSnippets,
  onOpenUtilities,
  utilitiesOpen,
}: AppLayoutProps) {
  const { t } = useTranslation();
  const { layoutPreset } = useSettingsStore();
  const { sidebarVisible, consoleVisible, setSidebarVisible } = useUIStore();
  const isCompactShell = useCompactShellLayout();
  const compactDrawerCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const compactDrawerReturnFocusRef = useRef<HTMLElement | null>(null);
  const compactDrawerRef = useRef<HTMLDivElement | null>(null);
  const persistentSidebarRef = useRef<HTMLDivElement | null>(null);
  const shellUnderlayRef = useRef<HTMLDivElement | null>(null);
  const wasCompactDrawerOpenRef = useRef(false);
  const shellLayout = useDefaultLayout({
    id: 'lingua-shell-layout',
    panelIds: ['sidebar-panel', 'content-panel'],
    storage: localStorage,
  });
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const activeLanguage = useEditorStore(
    (s) => s.tabs.find((tab) => tab.id === s.activeTabId)?.language
  );
  const activeRuntimeMode = useEditorStore(
    (s) => s.tabs.find((tab) => tab.id === s.activeTabId)?.runtimeMode
  );
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
    (s) => s.tabs.find((tab) => tab.id === s.activeTabId)?.variableInspectorEnabled === true,
  );
  const scopeSnapshotForLayout = useResultStore((state) => state.scopeSnapshot);
  const showStdinTabBody =
    layoutPreset !== 'editor-only' &&
    showStdinPanelSetting &&
    activeBottomPanelForLayout === 'stdin' &&
    activeRuntimeMode !== 'browser-preview' &&
    (activeLanguage === 'javascript' ||
      activeLanguage === 'typescript' ||
      activeLanguage === 'python');
  // RL-093 Slice 3 — mirror BottomPanel.variablesAvailable so the
  // MainContent gate keeps the drawer mounted when Variables is the
  // sole reason to show it (no console, no debugger, no stdin).
  const showVariablesTabBody =
    layoutPreset !== 'editor-only' &&
    variableInspectorSurfaceForLayout === 'bottom' &&
    activeVariableInspectorEnabled &&
    activeBottomPanelForLayout === 'variables' &&
    activeRuntimeMode !== 'node' &&
    (activeLanguage === 'javascript' ||
      activeLanguage === 'typescript' ||
      activeLanguage === 'python') &&
    scopeSnapshotForLayout !== null &&
    scopeSnapshotForLayout.language === activeLanguage;
  const showPersistentSidebar = sidebarVisible && !isCompactShell;
  const isCompactDrawerOpen = sidebarVisible && isCompactShell;
  const handleExplorerNavigate = isCompactShell ? () => setSidebarVisible(false) : undefined;

  useEffect(() => {
    const shellUnderlay = shellUnderlayRef.current;
    if (!shellUnderlay) {
      return;
    }

    shellUnderlay.toggleAttribute('inert', isCompactDrawerOpen);

    return () => {
      shellUnderlay.removeAttribute('inert');
    };
  }, [isCompactDrawerOpen]);

  useEffect(() => {
    if (!isCompactDrawerOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isCompactDrawerOpen]);

  useEffect(() => {
    if (!isCompactDrawerOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSidebarVisible(false);
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const drawer = compactDrawerRef.current;
      if (!drawer) {
        return;
      }

      const focusableElements = getFocusableElements(drawer);
      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const [firstFocusable] = focusableElements;
      const lastFocusable = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

      if (event.shiftKey) {
        if (activeElement === firstFocusable || !drawer.contains(activeElement)) {
          event.preventDefault();
          lastFocusable?.focus();
        }
        return;
      }

      if (activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCompactDrawerOpen, setSidebarVisible]);

  useEffect(() => {
    if (!isCompactDrawerOpen) {
      return;
    }

    compactDrawerReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const frameId = window.requestAnimationFrame(() => {
      compactDrawerCloseButtonRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      const previousFocus = compactDrawerReturnFocusRef.current;
      compactDrawerReturnFocusRef.current = null;

      if (previousFocus?.isConnected) {
        previousFocus.focus();
      }
    };
  }, [isCompactDrawerOpen]);

  useEffect(() => {
    const movedFromCompactDrawerToPersistentSidebar =
      wasCompactDrawerOpenRef.current && showPersistentSidebar;

    wasCompactDrawerOpenRef.current = isCompactDrawerOpen;

    if (!movedFromCompactDrawerToPersistentSidebar) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const persistentSidebar = persistentSidebarRef.current;
      if (!persistentSidebar) {
        return;
      }

      const [firstFocusable] = getFocusableElements(persistentSidebar);
      (firstFocusable ?? persistentSidebar).focus();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isCompactDrawerOpen, showPersistentSidebar]);

  return (
    <div className="app-shell">
      <div
        ref={shellUnderlayRef}
        data-testid="shell-underlay"
        aria-hidden={isCompactDrawerOpen ? 'true' : undefined}
        className="flex min-h-0 flex-1 flex-col"
      >
        <AppChrome
          onOpenSettings={onOpenSettings}
        />
        <Toolbar showFloatingPill />
        <FloatingActionPill
          onOpenSettings={onOpenSettings}
          onOpenPalette={onOpenPalette}
          onOpenQuickOpen={onOpenQuickOpen}
          onOpenSnippets={onOpenSnippets}
          onOpenUtilities={onOpenUtilities}
          utilitiesOpen={utilitiesOpen}
        />
        {showPersistentSidebar ? (
          <Group
            orientation="horizontal"
            defaultLayout={shellLayout.defaultLayout}
            onLayoutChanged={shellLayout.onLayoutChanged}
            resizeTargetMinimumSize={RESIZE_TARGET_MINIMUM_SIZE}
            className="min-h-0 flex-1 p-2 pb-3 sm:p-3"
          >
            {/* Sidebar */}
            <Panel
              id="sidebar-panel"
              defaultSize={280}
              minSize={220}
              maxSize={420}
              groupResizeBehavior="preserve-pixel-size"
            >
              <SidebarPanel panelRef={persistentSidebarRef} onNavigate={handleExplorerNavigate} />
            </Panel>
            <ResizeHandle orientation="vertical" />
            {/* Main area */}
            <Panel id="content-panel" minSize={360}>
              <div className="surface-panel h-full min-w-0 overflow-hidden">
                <MainContent
                  showConsole={showConsole}
                  showDebuggerPanel={showDebuggerPanel}
                  showBrowserPreviewPanel={showBrowserPreviewPanel}
                  showStdinTabBody={showStdinTabBody}
                  showVariablesTabBody={showVariablesTabBody}
                  layoutPreset={layoutPreset}
                />
              </div>
            </Panel>
          </Group>
        ) : (
          <div className="min-h-0 flex-1 p-2 pb-3 sm:p-3">
            <div className="surface-panel h-full min-w-0 overflow-hidden">
              <MainContent
                showConsole={showConsole}
                showDebuggerPanel={showDebuggerPanel}
                showBrowserPreviewPanel={showBrowserPreviewPanel}
                showStdinTabBody={showStdinTabBody}
                showVariablesTabBody={showVariablesTabBody}
                layoutPreset={layoutPreset}
              />
            </div>
          </div>
        )}
      </div>
      {isCompactDrawerOpen && (
        <OverlayBackdrop
          align="top"
          onClose={() => setSidebarVisible(false)}
          className="justify-start bg-black/46 p-2 pt-18 backdrop-blur-sm sm:p-3 sm:pt-20"
        >
          <div
            ref={compactDrawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('layout.projectExplorer')}
            className="relative h-full w-[min(24rem,calc(100vw-1rem))] max-w-full"
            onClick={(event) => event.stopPropagation()}
          >
            <IconButton
              ref={compactDrawerCloseButtonRef}
              onClick={() => setSidebarVisible(false)}
              tooltip={t('layout.closeSidebar')}
              className="absolute right-3 top-3 z-10 bg-surface/92"
            >
              <X size={14} />
            </IconButton>
            <SidebarPanel onNavigate={handleExplorerNavigate} />
          </div>
        </OverlayBackdrop>
      )}
    </div>
  );
}
