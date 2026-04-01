import { FileCode, FolderOpen } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import type { Language } from '../../types';

const LANGUAGE_COLORS: Record<Language, string> = {
  javascript: 'text-yellow-400',
  typescript: 'text-blue-400',
  go: 'text-cyan-400',
  python: 'text-green-400',
  rust: 'text-orange-400',
};

export function FileTree() {
  const { tabs, activeTabId, setActiveTab } = useEditorStore();

  return (
    <div className="flex h-full flex-col bg-gray-900">
      <div className="flex h-8 items-center gap-1.5 border-b border-gray-800 px-3">
        <FolderOpen size={14} className="text-gray-500" />
        <span className="text-xs font-medium text-gray-400">Files</span>
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex w-full items-center gap-2 rounded px-2 py-1 text-xs transition-colors ${
              tab.id === activeTabId
                ? 'bg-gray-800 text-gray-100'
                : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-300'
            }`}
          >
            <FileCode size={14} className={LANGUAGE_COLORS[tab.language]} />
            <span className="truncate">{tab.name}</span>
            {tab.isDirty && (
              <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary-400" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
