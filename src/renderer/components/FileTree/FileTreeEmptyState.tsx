import { Folder, FolderOpen as OpenFolderIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RecentProject } from '../../stores/projectStore';
import { EmptyState } from '../ui/EmptyState';
import { FileTreeOpenTabs } from './FileTreeOpenTabs';

interface FileTreeEmptyStateProps {
  recentProjects: RecentProject[];
  onCreateProject: () => void;
  onOpenProject: (rootPath?: string) => void | Promise<void>;
  onOpenRecentProject: (project: RecentProject) => void | Promise<void>;
  /**
   * Fired after the open-tabs foot selects a tab so the caller can
   * close a mobile drawer. The tab selection itself is owned by
   * `FileTreeOpenTabs` (PERF-001 — it self-subscribes to a narrowed
   * tab projection so editor keystrokes don't re-render the explorer).
   */
  onSelectTab?: () => void;
}

export function FileTreeEmptyState({
  recentProjects,
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
        {/* FASE 4 — canonical EmptyState recipe: glyph tile + title +
            description-less centered copy + the two CTAs as the action
            row. The proto centers "No hay proyecto abierto" above the
            Create / Open buttons. */}
        <EmptyState
          icon={<OpenFolderIcon size={18} />}
          title={t('fileTree.emptyState.noProject')}
          description={null}
          action={
            <div className="flex w-full flex-col gap-3">
              <button onClick={onCreateProject} className="button-primary w-full">
                {t('fileTree.emptyState.createProject')}
              </button>
              <button
                onClick={() => onOpenProject()}
                className="button-secondary w-full"
              >
                {t('fileTree.emptyState.openFolder')}
              </button>
            </div>
          }
        />
        {recentProjects.length > 0 && (
          <div className="mt-3 w-full">
            <p className="mb-2 panel-title">
              {t('fileTree.emptyState.recent')}
            </p>
            {recentProjects.slice(0, 5).map((project) => (
              <button
                key={project.id}
                onClick={() => onOpenRecentProject(project)}
                className="flex w-full items-center gap-1.5 rounded-xl px-2 py-1.5 text-left text-body-sm text-muted transition-colors hover:bg-surface-strong/72 hover:text-foreground"
                title={project.rootPath}
              >
                <Folder size={12} className="shrink-0 text-warning" />
                <span className="truncate">{project.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <FileTreeOpenTabs onNavigate={onSelectTab} />
    </div>
  );
}
