import { Panel, Group, Separator } from 'react-resizable-panels';
import { FileTree } from '../FileTree';
import { CodeEditor, EditorTabs } from '../Editor';
import { ConsolePanel } from '../Console';
import { Toolbar } from '../Toolbar';

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

export function AppLayout() {
  return (
    <div className="flex h-screen w-screen flex-col bg-gray-950 text-gray-100">
      <Toolbar />
      <Group orientation="horizontal" className="flex-1">
        {/* Sidebar */}
        <Panel defaultSize={15} minSize={10} maxSize={30}>
          <FileTree />
        </Panel>

        <ResizeHandle orientation="vertical" />

        {/* Editor + Console */}
        <Panel defaultSize={85} minSize={50}>
          <Group orientation="vertical">
            {/* Editor Area */}
            <Panel defaultSize={70} minSize={30}>
              <div className="flex h-full flex-col">
                <EditorTabs />
                <div className="flex-1">
                  <CodeEditor />
                </div>
              </div>
            </Panel>

            <ResizeHandle orientation="horizontal" />

            {/* Console */}
            <Panel defaultSize={30} minSize={15}>
              <ConsolePanel />
            </Panel>
          </Group>
        </Panel>
      </Group>
    </div>
  );
}
