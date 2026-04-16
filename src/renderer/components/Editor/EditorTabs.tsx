import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import { languageShortLabel, languageTextColorClass } from '../../utils/languageMeta';

export function EditorTabs() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useEditorStore();
  const { t } = useTranslation();

  if (tabs.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label={t('editorTabs.ariaLabel')}
      className="surface-header flex h-14 items-center gap-1 overflow-x-auto px-2.5 py-2"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const tabLabel = `${languageShortLabel(tab.language)} ${tab.name}`;

        return (
          <div
            key={tab.id}
            className={`group flex h-10 min-w-[11rem] shrink-0 items-center gap-1 rounded-[1.1rem] border pr-2 text-xs transition-all ${
              isActive
                ? 'border-border-strong/90 bg-background-elevated/95 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                : 'border-transparent bg-transparent text-muted hover:border-border/70 hover:bg-surface-strong/78 hover:text-foreground'
            }`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={tabLabel}
              title={tab.name}
              onClick={() => setActiveTab(tab.id)}
              className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-[1rem] px-3.5"
            >
              <span className={`text-[11px] font-bold leading-none ${languageTextColorClass(tab.language)}`}>
                {languageShortLabel(tab.language)}
              </span>
              <span className="min-w-0 flex-1 truncate leading-none">{tab.name}</span>
              {tab.isDirty && (
                <span
                  aria-label={t('editorTabs.unsaved', { name: tab.name })}
                  title={t('editorTabs.unsavedTitle')}
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                />
              )}
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void closeTab(tab.id);
              }}
              className="ml-1 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted opacity-0 transition-all hover:bg-surface-strong/82 hover:text-foreground group-hover:opacity-100"
              title={t('editorTabs.close', { name: tab.name })}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
