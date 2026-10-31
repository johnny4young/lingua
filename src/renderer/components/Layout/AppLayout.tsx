import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ExplainPanelHost } from '../AI/ExplainPanelHost';
import { useShallow } from 'zustand/react/shallow';
import type { RefObject } from 'react';
import { PanelLeft, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShortcutLabel } from '../../hooks/useShortcutLabel';
import {
  Group,
  Panel,
  useDefaultLayout,
  type GroupImperativeHandle,
  type PanelImperativeHandle,
} from 'react-resizable-panels';
import { FileTreeHost } from '../FileTree/FileTreeHost';
import { EditorTabs } from '../Editor/EditorTabs';
import { FloatingVariablesCardHost } from '../Editor/FloatingVariablesCardHost';
import { AppChrome, CommandBar } from '../Chrome';
import { StatusBar } from '../StatusBar/StatusBar';
import { StatusNoticeBanner } from '../StatusNotice/StatusNoticeBanner';
import { usePresenterModeStore } from '../../stores/presenterModeStore';
import { FloatingActionPill } from '../Toolbar/FloatingActionPill';
import { IconButton, OverlayBackdrop } from '../ui/chrome';
import { ResizeHandle } from '../ui/ResizeHandle';
import { ICON_GLYPH } from '../ui/iconScale';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { getActiveTab, useEditorStore } from '../../stores/editorStore';
import { cn } from '../../utils/cn';
import type { LayoutPreset } from '../../types/settings';
import { useDockShell } from '../../hooks/useLayoutAvailability';
import { WorkspaceErrorBoundary } from './WorkspaceErrorBoundary';
import { RunSweep } from './RunSweep';

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

const LazyBottomPanel = lazy(async () => {
  const module = await import('./BottomPanel');
  return { default: module.BottomPanel };
});

const LazyNotebookView = lazy(async () => {
  const module = await import('../Notebook/NotebookView');
  return { default: module.NotebookView };
});

// SQL / HTTP / Utilities workspaces mount as full-screen tabs
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

// The Utilities status pills (copy-output hint + tool counter) sit at the end
// of the tab strip on a Utilities tab. Lazy so the shell chunk does not absorb
// the utilities catalog/data.
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

function EditorArea() {
  const hasTabs = useEditorStore(s => s.tabs.length > 0);
  const { t } = useTranslation();
  const sidebarCombo = useShortcutLabel('view-toggle-sidebar');
  const sidebarVisible = useUIStore(s => s.sidebarVisible);
  const toggleSidebar = useUIStore(s => s.toggleSidebar);
  // When the active tab carries `kind: 'notebook'`,
  // mount `<NotebookView>` instead of Monaco. The selector returns a
  // primitive string-or-null so Zustand's default `===` check skips
  // re-renders when the active tab's kind hasn't changed.
  const activeNotebookTabId = useEditorStore(s => {
    if (!s.activeTabId) return null;
    const active = getActiveTab(s);
    return active?.kind === 'notebook' ? active.id : null;
  });
  // Same primitive-or-null selector shape for the
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

  const utilitiesActive = activeUtilitiesTabId !== null;

  return (
    <div id="guided-tour-editor" className="flex h-full flex-col">
      <div
        data-testid="editor-tab-strip"
        className="surface-header flex h-[34px] shrink-0 items-stretch overflow-hidden bg-surface-strong/72"
      >
        <div className="flex h-full shrink-0 items-center border-r border-border/60 px-1.5">
          <IconButton
            onClick={toggleSidebar}
            active={sidebarVisible}
            // On a Utilities tab Mod+B folds the tool list, so the button names no combo there.
            tooltip={
              utilitiesActive
                ? t('toolbar.sidebar.toggleExplorer')
                : t('toolbar.sidebar.toggle', { combo: sidebarCombo })
            }
            tooltipSide="bottom"
            aria-controls="project-explorer"
            aria-expanded={sidebarVisible}
            data-testid="editor-sidebar-toggle"
            className="rounded-md"
          >
            <PanelLeft size={ICON_GLYPH.md} />
          </IconButton>
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <EditorTabs />
        </div>
        {utilitiesActive ? (
          <div className="flex shrink-0 items-center gap-2 px-3">
            <Suspense fallback={null}>
              <LazyUtilityHeaderPills />
            </Suspense>
          </div>
        ) : null}
      </div>
      <div data-tour-id="editor-code" className="min-h-0 flex-1">
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
          /* Notebook tabs mount `<NotebookView>` in
             place of Monaco, which would otherwise try to render the
             (empty) notebook tab `content`. */
          <WorkspaceErrorBoundary key={activeNotebookTabId} region="notebook">
            <Suspense fallback={<EditorLoadingState />}>
              <LazyNotebookView tabId={activeNotebookTabId} />
            </Suspense>
          </WorkspaceErrorBoundary>
        ) : activeSqlTabId !== null ? (
          /* SQL workspace as a full-screen tab. The
             view fills the editor area height (h-full min-h-0) instead
             of the old ~30% dock slot, and binds the workspace store
             to this tab id. */
          <div className="h-full min-h-0">
            <WorkspaceErrorBoundary key={activeSqlTabId} region="sql">
              <Suspense fallback={<EditorLoadingState />}>
                <LazySqlWorkspaceView tabId={activeSqlTabId} />
              </Suspense>
            </WorkspaceErrorBoundary>
          </div>
        ) : activeHttpTabId !== null ? (
          /* HTTP workspace as a full-screen tab.
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
            <div className="relative h-full overflow-visible">
              <Suspense fallback={<EditorLoadingState />}>
                <CodeEditor />
              </Suspense>
              <RunSweep />
            </div>
            <FloatingVariablesCardHost />
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

function BottomPanelLoadingState() {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      className="flex h-full items-center justify-center bg-background/65 text-body text-muted"
    >
      {t('layout.loadingPanel')}
    </div>
  );
}

function BottomPanelSurface({ expanded }: { expanded: boolean }) {
  return (
    <Suspense fallback={<BottomPanelLoadingState />}>
      <LazyBottomPanel expanded={expanded} />
    </Suspense>
  );
}

interface MainContentProps {
  dockShown: boolean;
  dockExpanded: boolean;
  layoutPreset: LayoutPreset;
}

const DOCK_ROW_PX = 34;
const DEFAULT_SPLIT = {
  beside: { 'workspace-panel': 60, 'console-panel': 40 },
  below: { 'workspace-panel': 66, 'console-panel': 34 },
} as const;

/**
 * One stable tree for every dock state, so folding or opening the dock never
 * remounts the editor: the dock panel collapses instead of leaving the tree.
 * Below the editor it folds to its tab row; beside it (vertical preset) it
 * folds away and the tab row sits under the group.
 */
function MainContent({ dockShown, dockExpanded, layoutPreset }: MainContentProps) {
  const vertical = layoutPreset === 'vertical';
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
  const layout = vertical ? verticalLayout : horizontalLayout;
  const defaultSplit = DEFAULT_SPLIT[vertical ? 'beside' : 'below'];
  const groupRef = useRef<GroupImperativeHandle | null>(null);
  const dockPanelRef = useRef<PanelImperativeHandle | null>(null);
  const previousVerticalRef = useRef(vertical);
  const programmaticRef = useRef(false);
  const collapsedSize = vertical || !dockShown ? 0 : DOCK_ROW_PX;

  useLayoutEffect(() => {
    // Restore each orientation's sizes without replacing the Group: its editor
    // subtree owns the open Utilities panels and their in-memory drafts.
    if (previousVerticalRef.current !== vertical) {
      previousVerticalRef.current = vertical;
      programmaticRef.current = true;
      groupRef.current?.setLayout(layout.defaultLayout ?? defaultSplit);
      programmaticRef.current = false;
    }
  }, [vertical, layout.defaultLayout, defaultSplit]);

  useLayoutEffect(() => {
    const panel = dockPanelRef.current;
    if (!panel) return;
    programmaticRef.current = true;
    if (dockExpanded) {
      if (panel.isCollapsed()) panel.expand();
    } else if (!panel.isCollapsed()) {
      panel.collapse();
    }
    programmaticRef.current = false;
  }, [dockExpanded, collapsedSize, vertical]);

  // Dragging the dock shut or open is the same choice as the hide button.
  const handleDockResize = () => {
    const panel = dockPanelRef.current;
    if (!panel || programmaticRef.current || !dockShown) return;
    const collapsed = panel.isCollapsed();
    const visible = useUIStore.getState().consoleVisible;
    if (collapsed && visible) useUIStore.getState().setConsoleVisible(false);
    else if (!collapsed && !visible) useUIStore.getState().setConsoleVisible(true);
  };

  const dockInPanel = dockShown && (dockExpanded || !vertical);

  return (
    <div className="flex h-full min-h-0">
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <Group
          groupRef={groupRef}
          orientation={vertical ? 'horizontal' : 'vertical'}
          defaultLayout={layout.defaultLayout}
          onLayoutChanged={layout.onLayoutChanged}
          resizeTargetMinimumSize={RESIZE_TARGET_MINIMUM_SIZE}
          className="min-h-0 flex-1"
        >
          <Panel
            id="workspace-panel"
            defaultSize={`${defaultSplit['workspace-panel']}%`}
            minSize={vertical ? 420 : 260}
          >
            <EditorArea />
          </Panel>
          <ResizeHandle orientation={vertical ? 'vertical' : 'horizontal'} disabled={!dockExpanded} />
          <Panel
            id="console-panel"
            panelRef={dockPanelRef}
            collapsible
            collapsedSize={collapsedSize}
            defaultSize={`${defaultSplit['console-panel']}%`}
            minSize={vertical ? 260 : 160}
            onResize={handleDockResize}
          >
            {dockInPanel ? <BottomPanelSurface expanded={dockExpanded} /> : null}
          </Panel>
        </Group>
        {vertical && dockShown && !dockExpanded ? (
          <div className="h-[34px] shrink-0">
            <BottomPanelSurface expanded={false} />
          </div>
        ) : null}
      </div>
      <ExplainPanelHost />
    </div>
  );
}

interface AppLayoutProps {
  onOpenSettings?: () => void;
  onOpenPalette?: () => void;
  /**
   * Toolbar action icons live in FloatingActionPill,
   * so keep the overlay callbacks flowing through this layout boundary.
   */
  onOpenQuickOpen?: () => void;
  onOpenSnippets?: () => void;
  onOpenUtilities?: () => void;
  /**
   * Recipes overlay opener (Mod+Alt+L).
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
      className="h-full min-w-0 overflow-hidden border-r border-border-subtle bg-bg-panel"
    >
      <FileTreeHost onNavigate={onNavigate} />
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
  const layoutPreset = useSettingsStore(state => state.layoutPreset);
  const { sidebarVisible, setSidebarVisible } = useUIStore(
    useShallow(state => ({
      sidebarVisible: state.sidebarVisible,
      setSidebarVisible: state.setSidebarVisible,
    }))
  );
  const isCompactShell = useCompactShellLayout();
  const compactDrawerCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const compactDrawerReturnFocusRef = useRef<HTMLElement | null>(null);
  const compactDrawerRef = useRef<HTMLDivElement | null>(null);
  const persistentSidebarRef = useRef<HTMLDivElement | null>(null);
  const shellUnderlayRef = useRef<HTMLDivElement | null>(null);
  const statusBarRef = useRef<HTMLDivElement | null>(null);
  const wasCompactDrawerOpenRef = useRef(false);
  const shellLayout = useDefaultLayout({
    id: 'lingua-shell-layout',
    panelIds: ['sidebar-panel', 'content-panel'],
    storage: localStorage,
  });
  const { dockShown, dockExpanded } = useDockShell();
  const commandBarDocked = useUIStore(state => state.commandBarDocked);
  // Presenter mode hides the persistent chrome at render
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

    const statusBar = statusBarRef.current;
    shellUnderlay.toggleAttribute('inert', isCompactDrawerOpen);
    statusBar?.toggleAttribute('inert', isCompactDrawerOpen);

    return () => {
      shellUnderlay.removeAttribute('inert');
      statusBar?.removeAttribute('inert');
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
        {commandBarDocked ? (
          <CommandBar
            showControls={!presenterActive}
            onOpenSettings={onOpenSettings}
            onOpenPalette={onOpenPalette}
            onOpenQuickOpen={onOpenQuickOpen}
            onOpenSnippets={onOpenSnippets}
            onOpenUtilities={onOpenUtilities}
            onOpenRecipes={onOpenRecipes}
            utilitiesOpen={utilitiesOpen}
          />
        ) : (
          <AppChrome onOpenSettings={onOpenSettings} />
        )}
        {/* An undocked pill floats, so it reserves a row; otherwise it would
            cover the editor tab strip. Presenter mode hides both. */}
        {!commandBarDocked && !presenterActive && (
          <>
            <div aria-hidden className="h-[52px] shrink-0" data-testid="action-pill-reserved-row" />
            <FloatingActionPill
              onOpenSettings={onOpenSettings}
              onOpenPalette={onOpenPalette}
              onOpenQuickOpen={onOpenQuickOpen}
              onOpenSnippets={onOpenSnippets}
              onOpenUtilities={onOpenUtilities}
              onOpenRecipes={onOpenRecipes}
              utilitiesOpen={utilitiesOpen}
            />
          </>
        )}
        {showPersistentSidebar ? (
          <Group
            orientation="horizontal"
            defaultLayout={shellLayout.defaultLayout}
            onLayoutChanged={shellLayout.onLayoutChanged}
            resizeTargetMinimumSize={RESIZE_TARGET_MINIMUM_SIZE}
            className="min-h-0 flex-1"
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
              <div className="h-full min-w-0 overflow-hidden bg-bg-panel">
                <MainContent
                  dockShown={dockShown}
                  dockExpanded={dockExpanded}
                  layoutPreset={layoutPreset}
                />
              </div>
            </Panel>
          </Group>
        ) : (
          <div className="min-h-0 flex-1">
            <div className="h-full min-w-0 overflow-hidden bg-bg-panel">
              <MainContent
                dockShown={dockShown}
                dockExpanded={dockExpanded}
                layoutPreset={layoutPreset}
              />
            </div>
          </div>
        )}
      </div>
      {/* Notices stay reachable over the compact drawer; the status bar does not. */}
      <StatusNoticeBanner />
      <div ref={statusBarRef} aria-hidden={isCompactDrawerOpen ? 'true' : undefined} className="contents">
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
              <X size={ICON_GLYPH.md} />
            </IconButton>
            <SidebarPanel onNavigate={handleExplorerNavigate} />
          </div>
        </OverlayBackdrop>
      )}
    </div>
  );
}
