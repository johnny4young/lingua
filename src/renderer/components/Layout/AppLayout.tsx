import { lazy, Suspense } from 'react';
import { Panel, Group, Separator } from 'react-resizable-panels';
import { FileTree } from '../FileTree';
import { EditorTabs } from '../Editor/EditorTabs';
import { ResultPanel } from '../Editor/ResultPanel';
import { ConsolePanel } from '../Console';
import { Toolbar } from '../Toolbar';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { useEditorStore } from '../../stores/editorStore';
import type { LayoutPreset } from '../../types';

const CodeEditor = lazy(async () => {
  const module = await import('../Editor/CodeEditor');
  return { default: module.CodeEditor };
});

function ResizeHandle({ orientation = 'vertical' }: { orientation?: 'vertical' | 'horizontal' }) {
  const isVertical = orientation === 'vertical';
  return (
    <Separator
      className={`group relative flex items-center justify-center transition-colors ${
        isVertical
          ? 'w-[5px] cursor-col-resize hover:bg-primary/8'
          : 'h-[5px] cursor-row-resize hover:bg-primary/8'
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
          <Group orientation="horizontal">
            <Panel defaultSize={55} minSize={30}>
              <Suspense fallback={<EditorLoadingState />}>
                <CodeEditor />
              </Suspense>
            </Panel>
            <ResizeHandle orientation="vertical" />
            <Panel defaultSize={45} minSize={15}>
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
      <Group orientation="horizontal">
        <Panel defaultSize={60} minSize={30}>
          <EditorArea />
        </Panel>
        <ResizeHandle orientation="vertical" />
        <Panel defaultSize={40} minSize={20}>
          <ConsolePanel />
        </Panel>
      </Group>
    );
  }

  // horizontal (default)
  return (
    <Group orientation="vertical">
      <Panel defaultSize={70} minSize={30}>
        <EditorArea />
      </Panel>
      <ResizeHandle orientation="horizontal" />
      <Panel defaultSize={30} minSize={15}>
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

export function AppLayout({
  onOpenSettings,
  onOpenPalette,
  onOpenQuickOpen,
  onOpenSnippets,
}: AppLayoutProps) {
  const { layoutPreset } = useSettingsStore();
  const { sidebarVisible, consoleVisible } = useUIStore();

  const showConsole = consoleVisible && layoutPreset !== 'editor-only';

  return (
    <div className="app-shell">
      <Toolbar
        onOpenSettings={onOpenSettings}
        onOpenPalette={onOpenPalette}
        onOpenQuickOpen={onOpenQuickOpen}
        onOpenSnippets={onOpenSnippets}
      />
      {sidebarVisible ? (
        <Group orientation="horizontal" className="min-h-0 flex-1 p-2 pb-3 sm:p-3">
          {/* Sidebar */}
          <Panel defaultSize={15} minSize={10} maxSize={30}>
            <div className="surface-panel h-full overflow-hidden">
              <FileTree />
            </div>
          </Panel>
          <ResizeHandle orientation="vertical" />
          {/* Main area */}
          <Panel defaultSize={85} minSize={50}>
            <div className="surface-panel h-full overflow-hidden">
              <MainContent showConsole={showConsole} layoutPreset={layoutPreset} />
            </div>
          </Panel>
        </Group>
      ) : (
        <div className="min-h-0 flex-1 p-2 pb-3 sm:p-3">
          <div className="surface-panel h-full overflow-hidden">
            <MainContent showConsole={showConsole} layoutPreset={layoutPreset} />
          </div>
        </div>
      )}
    </div>
  );
}
