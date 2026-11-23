import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  Boxes,
  Bug,
  ChevronDown,
  ChevronUp,
  Diff,
  Rewind,
  Eye,
  FlaskConical,
  GitBranch,
  Globe,
  GraduationCap,
  RectangleEllipsis,
  SquareTerminal,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ConsolePanel } from '../Console';
import { DebuggerDrawerHost } from '../Debugger/DebuggerDrawerHost';
import { BrowserPreviewPanel } from '../BrowserPreview';
import { StdinInputPanel } from '../Editor/StdinInputPanel';
import { VariableInspectorPanel } from '../Editor/VariableInspectorPanel';
import { CompareResultsPanelHost } from '../Editor/CompareResultsPanelHost';
import { DependenciesPanel } from '../Dependencies/DependenciesPanel';
import { registerBrowserPreviewActivator } from '../../runtime/browserPreviewBridge';
import { Tooltip } from '../ui/chrome';
import { useShortcutLabel } from '../../hooks/useShortcutLabel';
import { useLayoutAvailability } from '../../hooks/useLayoutAvailability';
import { useRunCompareActive } from '../../hooks/useRunCompareActive';
import { useExecutionHistoryStore } from '../../stores/executionHistoryStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { getActiveTab, useEditorStore } from '../../stores/editorStore';
import {
  comparableSnapshotCountFor,
  scopeSnapshotVariableCountFor,
  useResultStore,
} from '../../stores/resultStore';
import { useConsoleStore } from '../../stores/consoleStore';
import { useDebuggerStore } from '../../stores/debuggerStore';
import { useProjectStore } from '../../stores/projectStore';
import { isCurrentFailure, useProjectTestStore } from '../../stores/projectTestStore';
import { useProjectTerminalStore } from '../../stores/projectTerminalStore';
import { cn } from '../../utils/cn';
import { formatShortcutLabel } from '../../data/keyboardShortcuts';
import {
  availableDockTabs,
  DOCK_COMPACT_MAX_WIDTH,
  DOCK_SPLIT_MIN_WIDTH,
  isDockSplit,
  isDockSplitTab,
  resolveDockTab,
  type DockTabId,
} from './dockTabs';
import { DockHeaderControls } from './DockHeaderControls';
import { DockOutputReport } from './DockOutputReport';
import { MissingToolchainPanel } from './MissingToolchainPanel';
import { useMissingActiveToolchain } from '../../hooks/useMissingActiveToolchain';
import { RunMeter } from '../RunMeter/RunMeter';
import { executionModeForLanguage } from '../../utils/languageMeta';

// Lazy so the `DiffEditor` import inside GitDiffPanel does not drag the
// full monaco chunk into the INITIAL bundle — the git-diff tab is
// conditional (desktop, repo detected, tab opened), and @monaco-editor/react
// shares the lazy monaco chunk with monaco-editor itself, so this single
// static edge was enough to ship ~3.8 MB of editor JS on cold load.
const GitDiffPanel = lazy(async () => {
  const module = await import('../Editor/GitDiffPanel');
  return { default: module.GitDiffPanel };
});

// The recipe bodies only load once a recipe tab shows its panel.
const RecipeRunPanel = lazy(async () => {
  const module = await import('../Recipes/RecipeRunPanel');
  return { default: module.RecipeRunPanel };
});

const TimelinePanel = lazy(async () => {
  const module = await import('../Timeline/TimelinePanel');
  return { default: module.TimelinePanel };
});

const RunComparePanel = lazy(async () => {
  const module = await import('../RunCompare/RunComparePanel');
  return { default: module.RunComparePanel };
});

const TestsPanel = lazy(async () => {
  const module = await import('../ProjectTests/TestsPanel');
  return { default: module.TestsPanel };
});

const ProjectTerminalPanel = lazy(async () => {
  const module = await import('../ProjectTerminal/ProjectTerminalPanel');
  return { default: module.ProjectTerminalPanel };
});

const TestsMeter = lazy(async () => {
  const module = await import('../ProjectTests/TestsMeter');
  return { default: module.TestsMeter };
});

const DebuggerDockControls = lazy(async () => {
  const module = await import('../Debugger/DebuggerDockControls');
  return { default: module.DebuggerDockControls };
});
const TestsDockControls = lazy(async () => {
  const module = await import('../ProjectTests/TestsDockControls');
  return { default: module.TestsDockControls };
});

/** How many of the ascending widths the element reaches; re-renders only when that count changes. */
function useWidthTier(ref: RefObject<HTMLElement | null>, widths: readonly number[]): number {
  const [tier, setTier] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = (width: number) => setTier(widths.filter(min => width >= min).length);
    measure(node.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) measure(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, widths]);
  return tier;
}

// Compact runs up to and including DOCK_COMPACT_MAX_WIDTH, like a CSS max-width query.
const DOCK_WIDTH_TIERS = [DOCK_COMPACT_MAX_WIDTH + 1, DOCK_SPLIT_MIN_WIDTH] as const;

interface DockTabMeta {
  icon: LucideIcon;
  labelKey: string;
  hintKey: string;
}

const DOCK_TAB_META: Record<DockTabId, DockTabMeta> = {
  console: { icon: Terminal, labelKey: 'bottomPanel.tabs.console', hintKey: 'bottomPanel.tabs.consoleHint' },
  stdin: { icon: RectangleEllipsis, labelKey: 'stdin.tab.label', hintKey: 'stdin.tab.hint' },
  compare: { icon: Diff, labelKey: 'bottomPanel.tabs.compare', hintKey: 'bottomPanel.tabs.compareHint' },
  timeline: { icon: Rewind, labelKey: 'bottomPanel.tabs.timeline', hintKey: 'bottomPanel.tabs.timelineHint' },
  variables: { icon: Eye, labelKey: 'bottomPanel.tabs.variables', hintKey: 'bottomPanel.tabs.variablesHint' },
  'project-terminal': {
    icon: SquareTerminal,
    labelKey: 'bottomPanel.tabs.projectTerminal',
    hintKey: 'bottomPanel.tabs.projectTerminalHint',
  },
  tests: { icon: FlaskConical, labelKey: 'bottomPanel.tabs.tests', hintKey: 'bottomPanel.tabs.testsHint' },
  debugger: { icon: Bug, labelKey: 'bottomPanel.tabs.debugger', hintKey: 'bottomPanel.tabs.debuggerHint' },
  'browser-preview': {
    icon: Globe,
    labelKey: 'bottomPanel.tabs.browserPreview',
    hintKey: 'bottomPanel.tabs.browserPreviewHint',
  },
  dependencies: { icon: Boxes, labelKey: 'dependencies.tab.label', hintKey: 'dependencies.tab.hint' },
  'git-diff': {
    icon: GitBranch,
    labelKey: 'editor.git.diffPanel.tabLabel',
    hintKey: 'editor.git.diffPanel.tabHint',
  },
  recipe: { icon: GraduationCap, labelKey: 'recipes.tab.label', hintKey: 'recipes.tab.hint' },
};

/**
 * The one results dock: a tab row that also carries the run controls, and
 * the selected tab's body. Collapsed, only the row stays, so every output
 * surface opens from the same place.
 */
export function BottomPanel({ expanded }: { expanded: boolean }) {
  const { t } = useTranslation();
  const { tabs: availability, debuggerLive } = useLayoutAvailability();
  const activeTabId = useEditorStore(s => s.activeTabId);
  const activeLanguage = useEditorStore(s => getActiveTab(s)?.language);
  // The meter follows code tabs; SQL, HTTP, notebooks and utilities carry their own result headers.
  const meterTabId = useEditorStore(s => {
    const tab = getActiveTab(s);
    return tab && !tab.kind && executionModeForLanguage(tab.language) === 'run' ? tab.id : null;
  });
  const missingToolchain = useMissingActiveToolchain(activeLanguage ?? '');
  const shortcutOverrides = useSettingsStore(state => state.shortcutOverrides);
  const consoleVisible = useUIStore(state => state.consoleVisible);
  const activeBottomPanel = useUIStore(state => state.activeBottomPanel);
  const openBottomPanel = useUIStore(state => state.openBottomPanel);
  const setActiveBottomPanel = useUIStore(state => state.setActiveBottomPanel);
  const setConsoleVisible = useUIStore(state => state.setConsoleVisible);
  const dockCombo = useShortcutLabel('view-toggle-console');
  const currentProject = useProjectStore(state => state.currentProject);
  // The live shell's name, so the Terminal tab can say it is running; null otherwise.
  const terminalShell = useProjectTerminalStore(state =>
    state.status === 'running' && state.rootId !== null && state.rootId === currentProject?.rootId
      ? (state.shellName ?? '')
      : null
  );
  const shellRef = useRef<HTMLElement>(null);
  const widthTier = useWidthTier(shellRef, DOCK_WIDTH_TIERS);
  const compact = widthTier === 0;
  const wide = widthTier === DOCK_WIDTH_TIERS.length;
  const tabListRef = useRef<HTMLDivElement>(null);
  const consoleCount = useConsoleStore(state => state.entries.length);
  const failedTests = useProjectTestStore(state => state.cases?.filter(isCurrentFailure).length ?? 0);
  // Lines staged for the next run, so the Input tab says so before it is opened.
  const stdinLines = useEditorStore(
    s => (getActiveTab(s)?.stdinBuffer ?? '').split('\n').filter(line => line !== '').length
  );
  const snapshotCount = useResultStore(state => comparableSnapshotCountFor(state, activeLanguage));
  const runCompareActive = useRunCompareActive();
  const runCount = useExecutionHistoryStore(state => state.entries.length);
  const compareCount = runCompareActive ? runCount : snapshotCount;
  const variableCount = useResultStore(state =>
    scopeSnapshotVariableCountFor(state, activeLanguage)
  );
  const allBreakpoints = useDebuggerStore(
    state => Object.values(state.breakpoints).filter(bp => bp.tabId === activeTabId).length
  );
  const enabledBreakpoints = useDebuggerStore(
    state =>
      Object.values(state.breakpoints).filter(
        bp => bp.tabId === activeTabId && bp.enabled !== false
      ).length
  );

  // Register the activator so the BrowserPreviewRunner can switch to the
  // preview tab before it loads the isolated document.
  useEffect(() => {
    registerBrowserPreviewActivator(openBottomPanel);
    return () => registerBrowserPreviewActivator(null);
  }, [openBottomPanel]);

  const effectiveTab = resolveDockTab(
    activeBottomPanel,
    { ...availability, debugger: availability.debugger && (consoleVisible || debuggerLive) },
    consoleVisible
  );

  const split = expanded && currentProject !== null && isDockSplit(effectiveTab, availability, wide);

  // A tab picked from elsewhere (a shortcut, the debugger) scrolls into the row's own track.
  // Scrolls the row only; scrollIntoView would also move the page.
  useEffect(() => {
    const list = tabListRef.current;
    const tab = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !tab) return;
    const row = list.getBoundingClientRect();
    const box = tab.getBoundingClientRect();
    if (box.left < row.left) list.scrollLeft -= row.left - box.left;
    else if (box.right > row.right) list.scrollLeft += box.right - row.right;
  }, [effectiveTab, compact]);
  const shown = (id: DockTabId) => expanded && (effectiveTab === id || (split && isDockSplitTab(id)));
  // The Tests meter and controls answer for the project while its tests are on screen.
  const testsOnScreen = currentProject !== null && shown('tests');
  // Until detection binds the test store to this project the code meter keeps the column.
  const testsBound = useProjectTestStore(state => state.rootId !== null && state.rootId === currentProject?.rootId);

  useEffect(() => {
    if (activeBottomPanel !== 'console' && !availability[activeBottomPanel]) {
      setActiveBottomPanel('console');
    }
  }, [activeBottomPanel, availability, setActiveBottomPanel]);

  const counts: Partial<Record<DockTabId, number>> = {
    console: consoleCount,
    stdin: stdinLines,
    compare: compareCount,
    variables: variableCount ?? 0,
    debugger: allBreakpoints,
    // While Tests is on screen its meter carries the failures.
    tests: testsOnScreen ? 0 : failedTests,
  };
  const hintValues = {
    combo: formatShortcutLabel('run-toggle-variable-inspector', shortcutOverrides) ?? '',
    enabled: enabledBreakpoints,
    count: allBreakpoints,
  };
  const compareCombo = formatShortcutLabel('run-toggle-compare-snapshot', shortcutOverrides) ?? '';

  const terminalPanel = currentProject ? (
    <Suspense
      fallback={
        <div role="status" className="flex h-full items-center justify-center text-caption text-muted">
          {t('projectTerminal.loading')}
        </div>
      }
    >
      <ProjectTerminalPanel
        binding={{ rootId: currentProject.rootId, projectName: currentProject.name }}
        autoFocus={effectiveTab === 'project-terminal'}
      />
    </Suspense>
  ) : null;

  return (
    <section
      ref={shellRef}
      aria-label={t('bottomPanel.tabs.label')}
      data-testid="results-dock"
      data-expanded={expanded ? 'true' : 'false'}
      data-split={split ? 'true' : undefined}
      data-compact={compact ? 'true' : undefined}
      className="dock-shell h-full min-h-0 bg-bg-panel"
    >
      <div className="dock-shell-row">
        {expanded && testsOnScreen && testsBound ? (
          <Suspense fallback={null}>
            <TestsMeter />
          </Suspense>
        ) : expanded && meterTabId ? (
          <RunMeter
            tabId={meterTabId}
            {...(availability.compare ? { onCompare: () => openBottomPanel('compare') } : {})}
          />
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            data-testid="results-dock-tab-row"
            className="flex h-[34px] shrink-0 items-stretch border-b border-border-subtle bg-bg-panel-alt"
          >
            <div
              ref={tabListRef}
              role="tablist"
              aria-label={t('bottomPanel.tabs.listLabel')}
              aria-multiselectable={split || undefined}
              className="flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden px-1.5"
            >
              {availableDockTabs(availability).map(id => {
                const meta = DOCK_TAB_META[id];
                const Icon = meta.icon;
                const selected = shown(id);
                const count = counts[id] ?? 0;
                return (
                  <Tooltip
                    key={id}
                    content={t(meta.hintKey, id === 'compare' ? { combo: compareCombo } : hintValues)}
                    side="top"
                  >
                    <button
                      type="button"
                      role="tab"
                      id={id === 'console' ? 'bottom-panel-console-tab' : undefined}
                      data-testid={`bottom-panel-${id}-tab`}
                      aria-selected={selected}
                      onClick={() => openBottomPanel(id)}
                      className={cn(
                        'dock-tab relative inline-flex h-[34px] shrink-0 items-center gap-[7px] border-b-2 px-3.5 text-caption font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-fg',
                        selected
                          ? 'border-accent text-fg-base'
                          : 'border-transparent text-fg-muted hover:text-fg-base'
                      )}
                    >
                      <Icon
                        size={13}
                        aria-hidden="true"
                        className={selected ? 'text-accent-fg' : 'text-fg-subtle'}
                      />
                      <span className={compact ? 'sr-only' : undefined}>{t(meta.labelKey)}</span>
                      {id === 'project-terminal' && terminalShell !== null ? (
                        <span
                          data-testid="bottom-panel-project-terminal-live"
                          className="h-1.5 w-1.5 rounded-full bg-success-fg"
                          role="img"
                          aria-label={t('projectTerminal.status.running', { shell: terminalShell })}
                        />
                      ) : null}
                      {count > 0 ? (
                        <span
                          data-testid={`bottom-panel-${id}-count`}
                          className={cn(
                            'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-nano font-bold leading-none text-fg-on-accent tabular-nums',
                            id === 'tests' ? 'bg-error-fg' : 'bg-accent'
                          )}
                        >
                          {count}
                        </span>
                      ) : null}
                    </button>
                  </Tooltip>
                );
              })}
            </div>
            <div className="flex shrink-0 items-center gap-1.5 pl-2 pr-2">
              {testsOnScreen ? (
                <Suspense fallback={null}>
                  <TestsDockControls />
                </Suspense>
              ) : null}
              {shown('debugger') && debuggerLive ? (
                <Suspense fallback={null}>
                  <DebuggerDockControls tabId={activeTabId ?? null} />
                </Suspense>
              ) : null}
              <DockHeaderControls compact={compact} />
              <Tooltip
                content={t(expanded ? 'bottomPanel.actions.hide' : 'bottomPanel.actions.show', {
                  combo: dockCombo ?? '',
                })}
                side="bottom"
              >
                <button
                  type="button"
                  data-testid={expanded ? 'bottom-panel-hide' : 'bottom-panel-restore'}
                  aria-label={t(expanded ? 'bottomPanel.actions.hide' : 'bottomPanel.actions.show', {
                    combo: dockCombo ?? '',
                  })}
                  aria-expanded={expanded}
                  onClick={() =>
                    expanded ? setConsoleVisible(false) : openBottomPanel(activeBottomPanel)
                  }
                  className="icon-button h-7 w-7 rounded-md"
                >
                  {expanded ? (
                    <ChevronDown size={14} aria-hidden="true" />
                  ) : (
                    <ChevronUp size={14} aria-hidden="true" />
                  )}
                </button>
              </Tooltip>
            </div>
          </div>
          {expanded ? (
            <div key={split ? 'split' : effectiveTab} className="dock-tab-body flex min-h-0 flex-1 flex-col overflow-hidden">
              {split ? (
                <div className="flex min-h-0 flex-1" data-testid="results-dock-split">
                  <div className="min-h-0 min-w-0 flex-[1.25] border-r border-border-subtle" data-testid="results-dock-split-tests">
                    <Suspense fallback={null}>
                      <TestsPanel />
                    </Suspense>
                  </div>
                  <div className="min-h-0 min-w-0 flex-1" data-testid="results-dock-split-terminal">
                    {terminalPanel}
                  </div>
                </div>
              ) : effectiveTab === 'debugger' ? (
                <DebuggerDrawerHost activeTabId={activeTabId ?? null} activeLanguage={activeLanguage} />
              ) : effectiveTab === 'browser-preview' ? (
                <BrowserPreviewPanel />
              ) : effectiveTab === 'stdin' ? (
                <StdinInputPanel />
              ) : effectiveTab === 'timeline' ? (
                <Suspense fallback={null}>
                  <TimelinePanel />
                </Suspense>
              ) : effectiveTab === 'compare' && runCompareActive ? (
                <Suspense fallback={null}>
                  <RunComparePanel activeTabId={activeTabId ?? null} />
                </Suspense>
              ) : effectiveTab === 'compare' ? (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <CompareResultsPanelHost
                    key={activeTabId ?? 'none'}
                    language={activeLanguage ?? 'javascript'}
                  />
                </div>
              ) : effectiveTab === 'variables' ? (
                <VariableInspectorPanel language={activeLanguage ?? 'javascript'} />
              ) : effectiveTab === 'dependencies' ? (
                <DependenciesPanel />
              ) : effectiveTab === 'git-diff' ? (
                <Suspense fallback={null}>
                  <GitDiffPanel />
                </Suspense>
              ) : effectiveTab === 'project-terminal' && currentProject ? (
                terminalPanel
              ) : effectiveTab === 'tests' ? (
                <Suspense fallback={null}>
                  <TestsPanel />
                </Suspense>
              ) : effectiveTab === 'recipe' ? (
                <Suspense fallback={null}>
                  <RecipeRunPanel />
                </Suspense>
              ) : (
                <>
                  {missingToolchain ? <MissingToolchainPanel toolchain={missingToolchain} /> : null}
                  <DockOutputReport />
                  <div className="min-h-0 flex-1">
                    <ConsolePanel quietEmpty={missingToolchain !== null} />
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
