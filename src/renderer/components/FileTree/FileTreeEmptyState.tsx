import { FileCode, Folder, FolderOpen as OpenFolderIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FileTab } from '../../types';
import type { RecentProject } from '../../stores/projectStore';
import { languageTextColorClass } from '../../utils/languageMeta';

interface FileTreeEmptyStateProps {
  recentProjects: RecentProject[];
  tabs: FileTab[];
  activeTabId: string | null;
  onCreateProject: () => void;
  onOpenProject: (rootPath?: string) => void | Promise<void>;
  onOpenRecentProject: (project: RecentProject) => void | Promise<void>;
  onSelectTab: (tabId: string) => void;
}

export function FileTreeEmptyState({
  recentProjects,
  tabs,
  activeTabId,
  onCreateProject,
  onOpenProject,
  onOpenRecentProject,
  onSelectTab,
}: FileTreeEmptyStateProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col bg-background/65">
      <div className="surface-header flex h-12 items-center gap-2 px-4">
        <OpenFolderIcon size={14} className="text-muted" />
        <span className="panel-title">{t('fileTree.emptyState.title')}</span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-start gap-3 p-4 pt-8">
        <p className="text-center text-xs text-muted">
          {t('fileTree.emptyState.noProject')}
        </p>
        <button onClick={onCreateProject} className="button-primary w-full">
          {t('fileTree.emptyState.createProject')}
        </button>
        <button onClick={() => onOpenProject()} className="button-secondary w-full">
          {t('fileTree.emptyState.openFolder')}
        </button>
        {recentProjects.length > 0 && (
          <div className="mt-3 w-full">
            <p className="mb-2 panel-title">
              {t('fileTree.emptyState.recent')}
            </p>
            {recentProjects.slice(0, 5).map((project) => (
              <button
                key={project.id}
                onClick={() => onOpenRecentProject(project)}
                className="flex w-full items-center gap-1.5 rounded-xl px-2 py-1.5 text-left text-xs text-muted transition-colors hover:bg-surface-strong/72 hover:text-foreground"
                title={project.rootPath}
              >
                <Folder size={12} className="shrink-0 text-warning" />
                <span className="truncate">{project.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {tabs.length > 0 && (
        <div className="border-t border-border/70">
          <div className="flex h-9 items-center gap-1.5 px-4">
            <span className="panel-title">{t('fileTree.emptyState.openTabs')}</span>
          </div>
          <div className="p-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => onSelectTab(tab.id)}
                aria-label={
                  tab.isDirty
                    ? `${tab.name} · ${t('fileTree.dirtyDot.label')}`
                    : tab.name
                }
                className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs transition-colors ${
                  tab.id === activeTabId
                    ? 'bg-surface-strong/88 text-foreground'
                    : 'text-muted hover:bg-surface-strong/62 hover:text-foreground'
                }`}
              >
                <FileCode size={13} className={languageTextColorClass(tab.language)} />
                <span className="truncate">{tab.name}</span>
                {tab.isDirty && (
                  <span
                    role="img"
                    aria-label={t('fileTree.dirtyDot.label')}
                    className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
