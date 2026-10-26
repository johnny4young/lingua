import { lazy, Suspense, useEffect } from 'react';
import {
  Boxes,
  Bug,
  ChevronDown,
  ChevronUp,
  Diff,
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
import { useProjectTestStore } from '../../stores/projectTestStore';
import { cn } from '../../utils/cn';
import { formatShortcutLabel } from '../../data/keyboardShortcuts';
import { availableDockTabs, resolveDockTab, type DockTabId } from './dockTabs';
import { DockHeaderControls } from './DockHeaderControls';
import { DockOutputReport } from './DockOutputReport';
import { RunHistoryStrip } from './RunHistoryStrip';

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

const TestsPanel = lazy(async () => {
  const module = await import('../ProjectTests/TestsPanel');
  return { default: module.TestsPanel };
});

const ProjectTerminalPanel = lazy(async () => {
  const module = await import('../ProjectTerminal/ProjectTerminalPanel');
  return { default: module.ProjectTerminalPanel };
});

interface DockTabMeta {
  icon: LucideIcon;
  labelKey: string;
  hintKey: string;
}

const DOCK_TAB_META: Record<DockTabId, DockTabMeta> = {
  console: { icon: Terminal, labelKey: 'bottomPanel.tabs.console', hintKey: 'bottomPanel.tabs.consoleHint' },
  stdin: { icon: RectangleEllipsis, labelKey: 'stdin.tab.label', hintKey: 'stdin.tab.hint' },
  compare: { icon: Diff, labelKey: 'bottomPanel.tabs.compare', hintKey: 'bottomPanel.tabs.compareHint' },
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
  const shortcutOverrides = useSettingsStore(state => state.shortcutOverrides);
  const consoleVisible = useUIStore(state => state.consoleVisible);
  const activeBottomPanel = useUIStore(state => state.activeBottomPanel);
  const openBottomPanel = useUIStore(state => state.openBottomPanel);
  const setActiveBottomPanel = useUIStore(state => state.setActiveBottomPanel);
  const setConsoleVisible = useUIStore(state => state.setConsoleVisible);
  const dockCombo = useShortcutLabel('view-toggle-console');
  const currentProject = useProjectStore(state => state.currentProject);
  const consoleCount = useConsoleStore(state => state.entries.length);
  const failedTests = useProjectTestStore(state => state.cases?.filter(entry => entry.status === 'failed').length ?? 0);
  // Lines staged for the next run, so the Input tab says so before it is opened.
  const stdinLines = useEditorStore(
    s => (getActiveTab(s)?.stdinBuffer ?? '').split('\n').filter(line => line !== '').length
  );
  const compareCount = useResultStore(state => comparableSnapshotCountFor(state, activeLanguage));
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
    tests: failedTests,
  };
  const hintValues = {
    combo: formatShortcutLabel('run-toggle-variable-inspector', shortcutOverrides) ?? '',
    enabled: enabledBreakpoints,
    count: allBreakpoints,
  };
  const compareCombo = formatShortcutLabel('run-toggle-compare-snapshot', shortcutOverrides) ?? '';

  return (
    <section
      aria-label={t('bottomPanel.tabs.label')}
      data-testid="results-dock"
      data-expanded={expanded ? 'true' : 'false'}
      className="flex h-full min-h-0 flex-col bg-bg-panel"
    >
      <div className="flex h-[34px] shrink-0 items-stretch border-b border-border-subtle bg-bg-panel-alt">
        <div
          role="tablist"
          aria-label={t('bottomPanel.tabs.listLabel')}
          className="flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden px-1.5"
        >
          {availableDockTabs(availability).map(id => {
            const meta = DOCK_TAB_META[id];
            const Icon = meta.icon;
            const selected = expanded && effectiveTab === id;
            const count = counts[id] ?? 0;
            return (
              <Tooltip
                key={id}
                content={t(meta.hintKey, id === 'compare' ? { combo: compareCombo } : hintValues)}
                side="bottom"
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
                  {t(meta.labelKey)}
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
          <DockHeaderControls />
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
        <div key={effectiveTab} className="dock-tab-body flex min-h-0 flex-1 flex-col overflow-hidden">
          {effectiveTab === 'debugger' ? (
            <DebuggerDrawerHost activeTabId={activeTabId ?? null} activeLanguage={activeLanguage} />
          ) : effectiveTab === 'browser-preview' ? (
            <BrowserPreviewPanel />
          ) : effectiveTab === 'stdin' ? (
            <StdinInputPanel />
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
            <Suspense
              fallback={
                <div
                  role="status"
                  className="flex h-full items-center justify-center text-caption text-muted"
                >
                  {t('projectTerminal.loading')}
                </div>
              }
            >
              <ProjectTerminalPanel
                binding={{
                  rootId: currentProject.rootId,
                  projectName: currentProject.name,
                }}
              />
            </Suspense>
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
              <DockOutputReport />
              <div className="min-h-0 flex-1">
                <ConsolePanel />
              </div>
              <RunHistoryStrip
                onCompare={availability.compare ? () => openBottomPanel('compare') : undefined}
              />
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
