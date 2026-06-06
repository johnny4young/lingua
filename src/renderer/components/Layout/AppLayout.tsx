import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  ChevronUp,
  Clock3,
  Eye,
  GitCompare,
  MessageSquare,
  PanelLeft,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { FileTree } from '../FileTree';
import { EditorTabs } from '../Editor/EditorTabs';
import { GitProjectBranchChip } from '../Editor/GitProjectBranchChip';
import { ResultPanel } from '../Editor/ResultPanel';
import { FloatingVariablesCard } from '../Editor/FloatingVariablesCard';
import { AppChrome } from '../Chrome';
import { BottomPanel } from './BottomPanel';
import { Toolbar } from '../Toolbar';
import { FloatingActionPill } from '../Toolbar/FloatingActionPill';
import { IconButton, OverlayBackdrop } from '../ui/chrome';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { getActiveTab, useEditorStore } from '../../stores/editorStore';
import { useActiveTab } from '../../hooks/useActiveTab';
import { useLayoutAvailability } from '../../hooks/useLayoutAvailability';
import {
  comparableSnapshotCountFor,
  scopeSnapshotVariableCountFor,
  useResultStore,
} from '../../stores/resultStore';
import { executionModeForLanguage } from '../../utils/languageMeta';
import { cn } from '../../utils/cn';
import { syncVariableInspectorSurfaceAfterToggle } from '../../utils/variableInspectorSurface';
import type { LayoutPreset } from '../../types';

const COMPACT_SHELL_BREAKPOINT = 1180;
const RESIZE_TARGET_MINIMUM_SIZE = { coarse: 24, fine: 24 } as const;

function getFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter(
    (element) =>
      !element.hasAttribute('disabled') &&
      element.getAttribute('aria-hidden') !== 'true' &&
      element.tabIndex !== -1
  );
}

const CodeEditor = lazy(async () => {
  const module = await import('../Editor/CodeEditor');
  return { default: module.CodeEditor };
});

const LazyNotebookView = lazy(async () => {
  const module = await import('../Notebook/NotebookView');
  return { default: module.NotebookView };
});

// MOV.02 (FASE 3) — SQL / HTTP workspaces mount as full-screen tabs
// in the editor area (replacing the dock panels). Lazy so the DuckDB
// WASM + HTTP client chunks stay out of the initial bundle until a
// workspace tab is actually opened.
const LazySqlWorkspaceView = lazy(async () => {
  const module = await import('../SqlWorkspace/SqlWorkspaceView');
  return { default: module.SqlWorkspaceView };
});

const LazyHttpWorkspaceView = lazy(async () => {
  const module = await import('../HttpWorkspace/HttpWorkspaceView');
  return { default: module.HttpWorkspaceView };
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

/**
 * RL-122 — descriptor for one context chip in {@link PanelChipsRow}. The
 * row builds these in a memoized array; {@link PanelChip} renders one.
 * `onClick` carries the per-chip toggle behavior so the renderer stays a
 * pure presentation component.
 */
interface PanelChipDescriptor {
  readonly id: 'stdin' | 'history' | 'compare' | 'variables';
  readonly icon: LucideIcon;
  readonly label: string;
  readonly badge: string | null;
  readonly active: boolean;
  readonly disabled: boolean;
  readonly title: string;
  readonly onClick: () => void;
}

/**
 * RL-122 fold D — single context chip, extracted and `memo`-wrapped so a
 * `PanelChipsRow` re-render does not re-render a chip whose descriptor is
 * referentially unchanged.
 */
const PanelChip = memo(function PanelChip({ chip }: { chip: PanelChipDescriptor }) {
  const Icon = chip.icon;
  return (
    <button
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
});

function PanelChipsRow() {
  const { t } = useTranslation();
  const activeTab = useActiveTab();
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
  // RL-122 — subscribe to identity-stable PRIMITIVE derivations instead
  // of the raw `snapshotRing` array + `scopeSnapshot` object, so this row
  // re-renders only when the comparator count or the captured variable
  // count for the active language actually changes — not on every run
  // that replaces those references.
  const comparableSnapshotCount = useResultStore((state) =>
    comparableSnapshotCountFor(state, activeTab?.language),
  );
  const scopeVariableCount = useResultStore((state) =>
    scopeSnapshotVariableCountFor(state, activeTab?.language),
  );

  // RL-122 — build the chip descriptors in a memo keyed on the real
  // inputs (active tab, the two snapshot derivations, panel + settings
  // state, and the store actions). Returns [] when there is no active
  // tab so the hook order stays stable across the early return below.
  const chips = useMemo<PanelChipDescriptor[]>(() => {
    if (!activeTab) return [];
    const executionMode = executionModeForLanguage(activeTab.language);
    const stdinAvailable =
      showStdinPanel &&
      activeTab.runtimeMode !== 'browser-preview' &&
      (activeTab.language === 'javascript' ||
        activeTab.language === 'typescript' ||
        activeTab.language === 'python');
    const stdinLineCount = countStdinLines(activeTab.stdinBuffer);
    const compareAvailable = executionMode === 'run' && comparableSnapshotCount > 0;
    const variableAvailable =
      executionMode === 'run' &&
      activeTab.runtimeMode !== 'node' &&
      (activeTab.language === 'javascript' ||
        activeTab.language === 'typescript' ||
        activeTab.language === 'python') &&
      scopeVariableCount !== null;
    return [
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
        badge: compareAvailable ? String(comparableSnapshotCount) : null,
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
        badge: variableAvailable ? String(scopeVariableCount ?? 0) : null,
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
    ];
  }, [
    t,
    activeTab,
    comparableSnapshotCount,
    scopeVariableCount,
    showStdinPanel,
    variableInspectorSurface,
    activeBottomPanel,
    consoleVisible,
    openBottomPanel,
    setConsoleVisible,
    setTabCompareEnabled,
    setTabVariableInspectorEnabled,
  ]);

  if (!activeTab) return null;

  return (
    <div className="panel-chip-row" role="toolbar" aria-label={t('panelChips.ariaLabel')}>
      {chips.map((chip) => (
        <PanelChip key={chip.id} chip={chip} />
      ))}
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
  // RL-043 Slice A — when the active tab carries `kind: 'notebook'`,
  // mount `<NotebookView>` instead of Monaco. The selector returns a
  // primitive string-or-null so Zustand's default `===` check skips
  // re-renders when the active tab's kind hasn't changed.
  const activeNotebookTabId = useEditorStore((s) => {
    if (!s.activeTabId) return null;
    const active = getActiveTab(s);
    return active?.kind === 'notebook' ? active.id : null;
  });
  // MOV.02 (FASE 3) — same primitive-or-null selector shape for the
  // SQL / HTTP workspace tabs. When the active tab carries
  // `kind: 'sql' | 'http'` we mount the full-screen workspace view
  // instead of Monaco; the FileTab id is the binding into the
  // workspace store (SqlQueryV1.id / HttpRequestV1.id).
  const activeSqlTabId = useEditorStore((s) => {
    if (!s.activeTabId) return null;
    const active = getActiveTab(s);
    return active?.kind === 'sql' ? active.id : null;
  });
  const activeHttpTabId = useEditorStore((s) => {
    if (!s.activeTabId) return null;
    const active = getActiveTab(s);
    return active?.kind === 'http' ? active.id : null;
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
        {activeNotebookTabId !== null ? (
          /* RL-043 Slice A — notebook tabs mount `<NotebookView>` in
             place of the Monaco + ResultPanel split. The Monaco editor
             would otherwise try to render the (empty) notebook tab
             `content` and the result panel would surface stale state. */
          <Suspense fallback={<EditorLoadingState />}>
            <LazyNotebookView tabId={activeNotebookTabId} />
          </Suspense>
        ) : activeSqlTabId !== null ? (
          /* MOV.02 (FASE 3) — SQL workspace as a full-screen tab. The
             view fills the editor area height (h-full min-h-0) instead
             of the old ~30% dock slot, and binds the workspace store
             to this tab id. No editor + ResultPanel split here. */
          <div className="h-full min-h-0">
            <Suspense fallback={<EditorLoadingState />}>
              <LazySqlWorkspaceView tabId={activeSqlTabId} />
            </Suspense>
          </div>
        ) : activeHttpTabId !== null ? (
          /* MOV.02 (FASE 3) — HTTP workspace as a full-screen tab.
             Mirror of the SQL branch above. */
          <div className="h-full min-h-0">
            <Suspense fallback={<EditorLoadingState />}>
              <LazyHttpWorkspaceView tabId={activeHttpTabId} />
            </Suspense>
          </div>
        ) : hasTabs ? (
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
  /**
   * RL-039 Slice B — true when a recipe-bound active tab owns the
   * selected bottom panel. Mirrors the stdin / variables gates so a
   * restored or programmatically-selected Recipe panel can mount
   * even when the console drawer was previously collapsed.
   */
  showRecipeTabBody: boolean;
  layoutPreset: LayoutPreset;
}

function MainContent({
  showConsole,
  showDebuggerPanel,
  showBrowserPreviewPanel,
  showStdinTabBody,
  showVariablesTabBody,
  showRecipeTabBody,
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
    showVariablesTabBody ||
    showRecipeTabBody;

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
  /**
   * RL-039 Slice B fold G — Recipes overlay opener (Mod+Alt+L).
   * Threaded through to `<FloatingActionPill>` so the badge + button
   * surface next to Utilities + Settings.
   */
  onOpenRecipes?: () => void;
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
  onOpenRecipes,
  utilitiesOpen,
}: AppLayoutProps) {
  const { t } = useTranslation();
  const { layoutPreset } = useSettingsStore();
  const { sidebarVisible, setSidebarVisible } = useUIStore();
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
  const {
    showConsole,
    showDebuggerPanel,
    showBrowserPreviewPanel,
    showStdinTabBody,
    showVariablesTabBody,
    showRecipeTabBody,
  } = useLayoutAvailability();
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
          onOpenRecipes={onOpenRecipes}
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
                  showRecipeTabBody={showRecipeTabBody}
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
                showRecipeTabBody={showRecipeTabBody}
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
          className="justify-start bg-overlay/70 p-2 pt-18 backdrop-blur-sm sm:p-3 sm:pt-20"
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
