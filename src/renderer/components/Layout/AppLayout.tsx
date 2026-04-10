import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Panel, Group, Separator } from 'react-resizable-panels';
import { FileTree } from '../FileTree';
import { EditorTabs } from '../Editor/EditorTabs';
import { ResultPanel } from '../Editor/ResultPanel';
import { ConsolePanel } from '../Console';
import { Toolbar } from '../Toolbar';
import { IconButton } from '../ui/chrome';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { useEditorStore } from '../../stores/editorStore';
import type { LayoutPreset } from '../../types';

const COMPACT_SHELL_BREAKPOINT = 1180;

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

  return (
    <div className="flex h-full flex-col">
      <EditorTabs />
      <div className="flex-1">
        {hasTabs ? (
          <Group
            orientation="horizontal"
            autoSaveId="runlang-editor-results-layout"
            resizeTargetMinimumSize={24}
          >
            <Panel id="editor-panel" defaultSize="55%" minSize={320}>
              <Suspense fallback={<EditorLoadingState />}>
                <CodeEditor />
              </Suspense>
            </Panel>
            <ResizeHandle orientation="vertical" />
            <Panel id="results-panel" defaultSize="45%" minSize={220}>
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
  return (
    <div className="flex h-full items-center justify-center bg-background text-sm text-muted">
      Loading editor...
    </div>
  );
}

interface MainContentProps {
  showConsole: boolean;
  layoutPreset: LayoutPreset;
}

function MainContent({ showConsole, layoutPreset }: MainContentProps) {
  if (!showConsole) return <EditorArea />;

  if (layoutPreset === 'vertical') {
    return (
      <Group
        orientation="horizontal"
        autoSaveId="runlang-main-vertical-layout"
        resizeTargetMinimumSize={24}
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
      autoSaveId="runlang-main-horizontal-layout"
      resizeTargetMinimumSize={24}
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

function SidebarPanel() {
  return (
    <div id="project-explorer" className="surface-panel h-full min-w-0 overflow-hidden">
      <FileTree />
    </div>
  );
}

export function AppLayout({
  onOpenSettings,
  onOpenPalette,
  onOpenQuickOpen,
  onOpenSnippets,
}: AppLayoutProps) {
  const { layoutPreset } = useSettingsStore();
  const { sidebarVisible, consoleVisible, setSidebarVisible } = useUIStore();
  const isCompactShell = useCompactShellLayout();
  const compactDrawerCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const compactDrawerReturnFocusRef = useRef<HTMLElement | null>(null);
  const compactDrawerRef = useRef<HTMLDivElement | null>(null);

  const showConsole = consoleVisible && layoutPreset !== 'editor-only';
  const showPersistentSidebar = sidebarVisible && !isCompactShell;

  useEffect(() => {
    if (!sidebarVisible || !isCompactShell) {
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
  }, [isCompactShell, setSidebarVisible, sidebarVisible]);

  useEffect(() => {
    if (!sidebarVisible || !isCompactShell) {
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
  }, [isCompactShell, sidebarVisible]);

  return (
    <div className="app-shell">
      <Toolbar
        onOpenSettings={onOpenSettings}
        onOpenPalette={onOpenPalette}
        onOpenQuickOpen={onOpenQuickOpen}
        onOpenSnippets={onOpenSnippets}
      />
      {showPersistentSidebar ? (
        <Group
          orientation="horizontal"
          autoSaveId="runlang-shell-layout"
          resizeTargetMinimumSize={24}
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
            <SidebarPanel />
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
      {sidebarVisible && isCompactShell && (
        <div
          className="fixed inset-0 z-40 bg-black/46 p-2 pt-18 backdrop-blur-sm sm:p-3 sm:pt-20"
          onClick={() => setSidebarVisible(false)}
        >
          <div
            ref={compactDrawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Project explorer"
            className="relative h-full w-[min(24rem,calc(100vw-1rem))] max-w-full"
            onClick={(event) => event.stopPropagation()}
          >
            <IconButton
              ref={compactDrawerCloseButtonRef}
              onClick={() => setSidebarVisible(false)}
              title="Close sidebar"
              className="absolute right-3 top-3 z-10 bg-surface/92"
            >
              <X size={14} />
            </IconButton>
            <SidebarPanel />
          </div>
        </div>
      )}
    </div>
  );
}
