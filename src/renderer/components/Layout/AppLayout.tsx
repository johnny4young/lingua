import { Panel, Group, Separator } from 'react-resizable-panels';
import { FileTree } from '../FileTree';
import { CodeEditor, EditorTabs } from '../Editor';
import { ConsolePanel } from '../Console';
import { Toolbar } from '../Toolbar';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';

function ResizeHandle({ orientation = 'vertical' }: { orientation?: 'vertical' | 'horizontal' }) {
  const isVertical = orientation === 'vertical';
  return (
    <Separator
      className={`group relative flex items-center justify-center ${
        isVertical ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'
      }`}
    >
      <div
        className={`bg-gray-800 transition-colors group-hover:bg-primary-500 group-data-[separator]:bg-primary-500 ${
          isVertical ? 'h-full w-px' : 'h-px w-full'
        }`}
      />
    </Separator>
  );
}

function EditorArea() {
  return (
    <div className="flex h-full flex-col">
      <EditorTabs />
      <div className="flex-1">
        <CodeEditor />
      </div>
    </div>
  );
}

interface AppLayoutProps {
  onOpenSettings?: () => void;
  onOpenPalette?: () => void;
  onOpenQuickOpen?: () => void;
}

export function AppLayout({ onOpenSettings, onOpenPalette, onOpenQuickOpen }: AppLayoutProps) {
  const { layoutPreset } = useSettingsStore();
  const { sidebarVisible, consoleVisible } = useUIStore();

  // Effective console shown: hidden if sidebarVisible toggled off OR if editor-only preset
  const showConsole = consoleVisible && layoutPreset !== 'editor-only';

  const MainContent = () => {
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
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-gray-950 text-gray-100">
      <Toolbar
        onOpenSettings={onOpenSettings}
        onOpenPalette={onOpenPalette}
        onOpenQuickOpen={onOpenQuickOpen}
      />
      {sidebarVisible ? (
        <Group orientation="horizontal" className="flex-1">
          {/* Sidebar */}
          <Panel defaultSize={15} minSize={10} maxSize={30}>
            <FileTree />
          </Panel>
          <ResizeHandle orientation="vertical" />
          {/* Main area */}
          <Panel defaultSize={85} minSize={50}>
            <MainContent />
          </Panel>
        </Group>
      ) : (
        <div className="flex-1">
          <MainContent />
        </div>
      )}
    </div>
  );
}
