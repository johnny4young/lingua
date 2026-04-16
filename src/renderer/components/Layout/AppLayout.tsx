import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { FileTree } from '../FileTree';
import { EditorTabs } from '../Editor/EditorTabs';
import { ResultPanel } from '../Editor/ResultPanel';
import { ConsolePanel } from '../Console';
import { Toolbar } from '../Toolbar';
import { IconButton, OverlayBackdrop } from '../ui/chrome';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { useEditorStore } from '../../stores/editorStore';
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
  return (
    <Separator
      className={`group relative flex items-center justify-center transition-colors ${
        isVertical
          ? '-mx-1 w-3 cursor-col-resize hover:bg-primary/8'
          : '-my-1 h-3 cursor-row-resize hover:bg-primary/8'
      }`}
    >
      <div
        className={`rounded-full bg-border transition-colors group-hover:bg-primary group-data-[separator]:bg-primary ${
          isVertical ? 'h-[78%] w-px' : 'h-px w-[78%]'
        }`}
      />
    </Separator>
  );
}

function EditorArea() {
  const hasTabs = useEditorStore((s) => s.tabs.length > 0);
  const editorResultsLayout = useDefaultLayout({
    id: 'lingua-editor-results-layout',
    panelIds: ['editor-panel', 'results-panel'],
    storage: localStorage,
  });

  return (
    <div className="flex h-full flex-col">
      <EditorTabs />
      <div className="flex-1">
        {hasTabs ? (
          <Group
            orientation="horizontal"
            defaultLayout={editorResultsLayout.defaultLayout}
            onLayoutChanged={editorResultsLayout.onLayoutChanged}
            resizeTargetMinimumSize={RESIZE_TARGET_MINIMUM_SIZE}
            className="relative overflow-visible"
          >
            <Panel
              id="editor-panel"
              defaultSize="60%"
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
              defaultSize="40%"
              minSize={220}
              className="relative z-10 overflow-hidden"
            >
              <ResultPanel />
            </Panel>
          </Group>
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
  layoutPreset: LayoutPreset;
}

function MainContent({ showConsole, layoutPreset }: MainContentProps) {
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

  if (!showConsole) return <EditorArea />;

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
          <ConsolePanel />
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
        <ConsolePanel />
      </Panel>
    </Group>
  );
}

interface AppLayoutProps {
  onOpenSettings?: () => void;
  onOpenPalette?: () => void;
  onOpenQuickOpen?: () => void;
  onOpenSnippets?: () => void;
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

  const showConsole = consoleVisible && layoutPreset !== 'editor-only';
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
        <Toolbar
          onOpenSettings={onOpenSettings}
          onOpenPalette={onOpenPalette}
          onOpenQuickOpen={onOpenQuickOpen}
          onOpenSnippets={onOpenSnippets}
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
                <MainContent showConsole={showConsole} layoutPreset={layoutPreset} />
              </div>
            </Panel>
          </Group>
        ) : (
          <div className="min-h-0 flex-1 p-2 pb-3 sm:p-3">
            <div className="surface-panel h-full min-w-0 overflow-hidden">
              <MainContent showConsole={showConsole} layoutPreset={layoutPreset} />
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
              title={t('layout.closeSidebar')}
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
