import { X } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { languageShortLabel, languageTextColorClass } from '../../utils/languageMeta';

export function EditorTabs() {
  const { tabs, activeTabId, setActiveTab, removeTab } = useEditorStore();

  if (tabs.length === 0) return null;

  return (
    <div className="surface-header flex h-12 items-center gap-1 overflow-x-auto px-2 py-1.5">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;

        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`group flex h-full items-center gap-2 rounded-2xl border px-3.5 text-xs transition-all ${
              isActive
                ? 'border-border-strong/90 bg-background-elevated/95 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                : 'border-transparent bg-transparent text-muted hover:border-border/70 hover:bg-surface-strong/78 hover:text-foreground'
            }`}
          >
            <span className={`text-[10px] font-bold ${languageTextColorClass(tab.language)}`}>
              {languageShortLabel(tab.language)}
            </span>
            <span className="max-w-[12rem] truncate">{tab.name}</span>
            {tab.isDirty && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
            <span
              onClick={(event) => {
                event.stopPropagation();
                removeTab(tab.id);
              }}
              className="ml-1 inline-flex size-6 items-center justify-center rounded-lg text-muted opacity-0 transition-all hover:bg-surface-strong/82 hover:text-foreground group-hover:opacity-100"
              title={`Close ${tab.name}`}
              role="button"
            >
              <X size={12} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
