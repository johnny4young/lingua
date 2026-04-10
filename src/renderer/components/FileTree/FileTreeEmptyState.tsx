import { FileCode, Folder, FolderOpen as OpenFolderIcon } from 'lucide-react';
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
  return (
    <div className="flex h-full flex-col bg-background/65">
      <div className="surface-header flex h-12 items-center gap-2 px-4">
        <OpenFolderIcon size={14} className="text-muted" />
        <span className="panel-title">Explorer</span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-start gap-3 p-4 pt-8">
        <p className="text-center text-xs text-muted">No project open</p>
        <button onClick={onCreateProject} className="button-primary w-full">
          Create Project
        </button>
        <button onClick={() => onOpenProject()} className="button-secondary w-full">
          Open Folder
        </button>
        {recentProjects.length > 0 && (
          <div className="mt-3 w-full">
            <p className="mb-2 panel-title">Recent</p>
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
            <span className="panel-title">Open Tabs</span>
          </div>
          <div className="p-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => onSelectTab(tab.id)}
                className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs transition-colors ${
                  tab.id === activeTabId
                    ? 'bg-surface-strong/88 text-foreground'
                    : 'text-muted hover:bg-surface-strong/62 hover:text-foreground'
                }`}
              >
                <FileCode size={13} className={languageTextColorClass(tab.language)} />
                <span className="truncate">{tab.name}</span>
                {tab.isDirty && (
                  <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
