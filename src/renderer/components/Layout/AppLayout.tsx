import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { ChevronUp, PanelLeft, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { FileTree } from '../FileTree';
import { EditorTabs } from '../Editor/EditorTabs';
import { ResultPanel } from '../Editor/ResultPanel';
import { FloatingVariablesCard } from '../Editor/FloatingVariablesCard';
import { AppChrome } from '../Chrome';
import { StatusBar } from '../StatusBar/StatusBar';
import { usePresenterModeStore } from '../../stores/presenterModeStore';
import { BottomPanel } from './BottomPanel';
import { PanelChipsRow } from './PanelChipsRow';
import { Toolbar } from '../Toolbar';
import { FloatingActionPill } from '../Toolbar/FloatingActionPill';
import { IconButton, OverlayBackdrop } from '../ui/chrome';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { getActiveTab, useEditorStore } from '../../stores/editorStore';
import { useLayoutAvailability } from '../../hooks/useLayoutAvailability';
import { cn } from '../../utils/cn';
import type { LayoutPreset } from '../../types';
import { WorkspaceErrorBoundary } from './WorkspaceErrorBoundary';

const COMPACT_SHELL_BREAKPOINT = 1180;
const RESIZE_TARGET_MINIMUM_SIZE = { coarse: 24, fine: 24 } as const;

function getFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter(
    element =>
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

// MOV.02 (FASE 3) — SQL / HTTP / Utilities workspaces mount as full-screen tabs
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

const LazyDeveloperUtilitiesWorkspaceView = lazy(async () => {
  const module = await import('../DeveloperUtilities');
  return { default: module.DeveloperUtilitiesWorkspaceView };
});

// The Utilities status pills (copy-output hint + tool counter) render in
// the shared editor chips row when a Utilities tab is active — one header
// row instead of two. Lazy so the shell chunk does not absorb the
// utilities catalog/data.
const LazyUtilityHeaderPills = lazy(async () => {
  const module = await import('../DeveloperUtilities/UtilityHeaderPills');
  return { default: module.UtilityHeaderPills };
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
  // internal — keep the inner divider transparent so the editor +
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

function EditorArea() {
  const hasTabs = useEditorStore(s => s.tabs.length > 0);
  const { t } = useTranslation();
  const sidebarVisible = useUIStore(s => s.sidebarVisible);
  const toggleSidebar = useUIStore(s => s.toggleSidebar);
  const editorResultsLayout = useDefaultLayout({
    id: 'lingua-editor-results-layout',
    panelIds: ['editor-panel', 'results-panel'],
    storage: localStorage,
  });
  // implementation — when the active tab carries `kind: 'notebook'`,
  // mount `<NotebookView>` instead of Monaco. The selector returns a
  // primitive string-or-null so Zustand's default `===` check skips
  // re-renders when the active tab's kind hasn't changed.
  const activeNotebookTabId = useEditorStore(s => {
    if (!s.activeTabId) return null;
    const active = getActiveTab(s);
    return active?.kind === 'notebook' ? active.id : null;
  });
  // MOV.02 (FASE 3) — same primitive-or-null selector shape for the
  // SQL / HTTP / Utilities workspace tabs. When the active tab carries
  // `kind: 'sql' | 'http'` we mount the full-screen workspace view
  // instead of Monaco; the FileTab id is the binding into the
  // workspace store (SqlQueryV1.id / HttpRequestV1.id).
  const activeSqlTabId = useEditorStore(s => {
    if (!s.activeTabId) return null;
    const active = getActiveTab(s);
    return active?.kind === 'sql' ? active.id : null;
  });
  const activeHttpTabId = useEditorStore(s => {
    if (!s.activeTabId) return null;
    const active = getActiveTab(s);
    return active?.kind === 'http' ? active.id : null;
  });
  const activeUtilitiesTabId = useEditorStore(s => {
    if (!s.activeTabId) return null;
    const active = getActiveTab(s);
    return active?.kind === 'utilities' ? active.id : null;
  });
  const utilitiesTabOpen = useEditorStore(s => s.tabs.some(tab => tab.kind === 'utilities'));

  // Utilities is a full-screen workspace with no runtime output, so
  // activating it implementation note console away and leaving restores the user's
  // previous choice. Mutating the store (instead of gating the render)
  // keeps the restore strip honest: explicitly reopening the console
  // while on Utilities works, and that explicit choice is respected.
  const utilitiesActive = activeUtilitiesTabId !== null;
  const consoleWasVisibleRef = useRef(false);
  useEffect(() => {
    const ui = useUIStore.getState();
    if (utilitiesActive) {
      consoleWasVisibleRef.current = ui.consoleVisible;
      if (ui.consoleVisible) ui.setConsoleVisible(false);
      return;
    }
    if (consoleWasVisibleRef.current) {
      consoleWasVisibleRef.current = false;
      useUIStore.getState().setConsoleVisible(true);
    }
  }, [utilitiesActive]);

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
      </div>
      <PanelChipsRow
        trailing={
          utilitiesActive ? (
            <Suspense fallback={null}>
              <LazyUtilityHeaderPills />
            </Suspense>
          ) : null
        }
      />
      <div className="min-h-0 flex-1">
        {utilitiesTabOpen ? (
          <div className={cn('h-full min-h-0', activeUtilitiesTabId === null && 'hidden')}>
            <WorkspaceErrorBoundary region="utilities">
              <Suspense fallback={<EditorLoadingState />}>
                <LazyDeveloperUtilitiesWorkspaceView active={activeUtilitiesTabId !== null} />
              </Suspense>
            </WorkspaceErrorBoundary>
          </div>
        ) : null}
        {activeUtilitiesTabId !== null ? null : activeNotebookTabId !== null ? (
          /* implementation — notebook tabs mount `<NotebookView>` in
             place of the Monaco + ResultPanel split. The Monaco editor
             would otherwise try to render the (empty) notebook tab
             `content` and the result panel would surface stale state. */
          <WorkspaceErrorBoundary key={activeNotebookTabId} region="notebook">
            <Suspense fallback={<EditorLoadingState />}>
              <LazyNotebookView tabId={activeNotebookTabId} />
            </Suspense>
          </WorkspaceErrorBoundary>
        ) : activeSqlTabId !== null ? (
          /* MOV.02 (FASE 3) — SQL workspace as a full-screen tab. The
             view fills the editor area height (h-full min-h-0) instead
             of the old ~30% dock slot, and binds the workspace store
             to this tab id. No editor + ResultPanel split here. */
          <div className="h-full min-h-0">
            <WorkspaceErrorBoundary key={activeSqlTabId} region="sql">
              <Suspense fallback={<EditorLoadingState />}>
                <LazySqlWorkspaceView tabId={activeSqlTabId} />
              </Suspense>
            </WorkspaceErrorBoundary>
          </div>
        ) : activeHttpTabId !== null ? (
          /* MOV.02 (FASE 3) — HTTP workspace as a full-screen tab.
             Mirror of the SQL branch above. */
          <div className="h-full min-h-0">
            <WorkspaceErrorBoundary key={activeHttpTabId} region="http">
              <Suspense fallback={<EditorLoadingState />}>
                <LazyHttpWorkspaceView tabId={activeHttpTabId} />
              </Suspense>
            </WorkspaceErrorBoundary>
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
    <div className="flex h-full items-center justify-center bg-background text-body text-muted">
      {t('layout.loadingEditor')}
    </div>
  );
}

interface MainContentProps {
  showConsole: boolean;
  showDebuggerPanel: boolean;
  showBrowserPreviewPanel: boolean;
  /**
   * implementation — true when the active tab + Settings combination
   * permits the stdin panel AND the user has actively focused it via
   * the command palette / palette focus action. Without this term in
   * the `showBottomPanel` gate, `openBottomPanel('stdin')` from a
   * console-closed state would set the store flag but never mount
   * the panel.
   */
  showStdinTabBody: boolean;
  /**
   * implementation — true when surface=bottom + variables capture
   * available + active panel is 'variables'. Same shape as
   * `showStdinTabBody`: keeps the drawer mounted when Variables is
   * the only thing the user wants visible.
   */
  showVariablesTabBody: boolean;
  /**
   * implementation — true when a recipe-bound active tab owns the
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
 * implementation — Prerequisite fix surfaced during validation.
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
  const setConsoleVisible = useUIStore(state => state.setConsoleVisible);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <EditorArea />
      </div>
      <button
        type="button"
        data-testid="bottom-panel-restore"
        onClick={() => setConsoleVisible(true)}
        className="flex h-6 shrink-0 items-center justify-center gap-2 border-t border-border-strong/60 bg-surface-strong/60 text-eyebrow font-bold uppercase tracking-[0.14em] text-fg-subtle transition-colors hover:bg-surface-strong/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
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
   * internal follow-up — toolbar action icons live in FloatingActionPill,
   * so keep the overlay callbacks flowing through this layout boundary.
   */
  onOpenQuickOpen?: () => void;
  onOpenSnippets?: () => void;
  onOpenUtilities?: () => void;
  /**
   * implementation Slice B implementation note — Recipes overlay opener (Mod+Alt+L).
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
  // internal — presenter mode hides the persistent chrome at render
  // time; the underlying sidebar preference is untouched, so leaving
  // the mode restores the exact previous layout.
  const presenterActive = usePresenterModeStore(s => s.active);
  const showPersistentSidebar = sidebarVisible && !isCompactShell && !presenterActive;
  const isCompactDrawerOpen = sidebarVisible && isCompactShell && !presenterActive;
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
      const activeElement =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;

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
        <AppChrome onOpenSettings={onOpenSettings} />
        {!presenterActive && <Toolbar showFloatingPill />}
        {/* internal — the floating action pill IS the dominant chrome; a
            presenter hides it too (Cmd+Enter still runs, the shortcut
            or palette toggles the mode back). */}
        {!presenterActive && (
          <FloatingActionPill
            onOpenSettings={onOpenSettings}
            onOpenPalette={onOpenPalette}
            onOpenQuickOpen={onOpenQuickOpen}
            onOpenSnippets={onOpenSnippets}
            onOpenUtilities={onOpenUtilities}
            onOpenRecipes={onOpenRecipes}
            utilitiesOpen={utilitiesOpen}
          />
        )}
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
        {/* internal — persistent bottom status bar. Last child of the
            shell-underlay flex-col so it pins to the bottom of the flow AND
            inherits the inert + aria-hidden the underlay receives while the
            compact drawer is open. Self-renders null when showStatusBar is
            OFF. */}
        <StatusBar />
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
            onClick={event => event.stopPropagation()}
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
