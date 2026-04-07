import { X } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { languageShortLabel, languageTextColorClass } from '../../utils/languageMeta';

export function EditorTabs() {
  const { tabs, activeTabId, setActiveTab, removeTab } = useEditorStore();

  return (
    <div className="flex h-9 items-center gap-0 overflow-x-auto border-b border-gray-800 bg-gray-900">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`group flex h-full items-center gap-1.5 border-r border-gray-800 px-3 text-xs transition-colors ${
            tab.id === activeTabId
              ? 'bg-gray-950 text-gray-100'
              : 'bg-gray-900 text-gray-500 hover:bg-gray-800 hover:text-gray-300'
          }`}
        >
          <span className={`text-[10px] font-bold ${languageTextColorClass(tab.language)}`}>
            {languageShortLabel(tab.language)}
          </span>
          <span>{tab.name}</span>
          {tab.isDirty && (
            <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-primary-400" />
          )}
          {tabs.length > 1 && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                removeTab(tab.id);
              }}
              className="ml-1 rounded p-0.5 opacity-0 transition-opacity hover:bg-gray-700 group-hover:opacity-100"
            >
              <X size={12} />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
