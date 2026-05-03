import { useEffect, useState } from 'react';
import {
  FolderOpen,
  FolderPlus,
  FilePlus,
  RefreshCw,
  FolderOpen as OpenFolderIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import { useProjectStore, type FileTreeNode as ProjectFileTreeNode } from '../../stores/projectStore';
import { PLAINTEXT_LANGUAGE } from '../../utils/language';
import { joinAbsolute } from '../../utils/filePath';
import { IconButton } from '../ui/chrome';
import { FileTreeEmptyState } from './FileTreeEmptyState';
import { FileTreeInlineInput } from './FileTreeInlineInput';
import { FileTreeNode } from './FileTreeNode';
import type { CreationTarget } from './fileTreeTypes';

// ------------------------------------------------------------------ main FileTree

interface FileTreeProps {
  onNavigate?: () => void;
}

export function FileTree({ onNavigate }: FileTreeProps) {
  const { t } = useTranslation();
  const { tabs, activeTabId, setActiveTab, openFile } = useEditorStore();
  const {
    currentProject,
    recentProjects,
    nodes,
    createProject,
    openProject,
    refreshTree,
    createFile,
    createDirectory,
    deleteEntry,
  } = useProjectStore();

  const [creating, setCreating] = useState<CreationTarget>(null);

  // When a project is persisted but nodes haven't been loaded yet, reload tree
  useEffect(() => {
    if (currentProject && nodes.length === 0) {
      refreshTree();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.id]);

  // --------------------------------------------------------- handlers

  const handleFileClick = async (node: ProjectFileTreeNode) => {
    if (!currentProject) return;
    const displayPath = joinAbsolute(currentProject.rootPath, node.path);
    await openFile(
      currentProject.rootId,
      node.path,
      node.name,
      node.language ?? PLAINTEXT_LANGUAGE,
      displayPath
    );
    onNavigate?.();
  };

  const handleDelete = async (node: ProjectFileTreeNode) => {
    await deleteEntry(node.path, node.isDirectory);
  };

  const handleNewFile = (parentNode?: ProjectFileTreeNode) => {
    setCreating({
      parentPath: parentNode?.path ?? '',
      kind: 'file',
    });
  };

  const handleNewDir = (parentNode?: ProjectFileTreeNode) => {
    setCreating({
      parentPath: parentNode?.path ?? '',
      kind: 'dir',
    });
  };

  const handleCreateConfirm = async (name: string) => {
    if (!creating) return;
    if (creating.kind === 'file') {
      await createFile(creating.parentPath, name);
    } else {
      await createDirectory(creating.parentPath, name);
    }
    setCreating(null);
  };

  // --------------------------------------------------------- no project view

  if (!currentProject) {
    return (
      <FileTreeEmptyState
        recentProjects={recentProjects}
        tabs={tabs}
        activeTabId={activeTabId}
        onCreateProject={createProject}
        onOpenProject={openProject}
        onOpenRecentProject={async (project) => {
          await openProject(project.rootPath);
          onNavigate?.();
        }}
        onSelectTab={(tabId) => {
          setActiveTab(tabId);
          onNavigate?.();
        }}
      />
    );
  }

  // --------------------------------------------------------- project view

  return (
    <div className="flex h-full flex-col bg-background/65">
      {/* Header */}
      <div className="surface-header flex h-12 items-center gap-2 px-3">
        <FolderOpen size={14} className="shrink-0 text-warning" />
        <span
          className="flex-1 truncate font-display text-sm font-semibold tracking-[0.08em] text-foreground"
          title={currentProject.rootPath}
        >
          {currentProject.name}
        </span>
        <div className="flex items-center gap-0.5">
          <IconButton
            onClick={() => handleNewFile()}
            tooltip={t('fileTree.actions.newFile')}
          >
            <FilePlus size={13} />
          </IconButton>
          <IconButton
            onClick={() => handleNewDir()}
            tooltip={t('fileTree.actions.newFolder')}
          >
            <FolderPlus size={13} />
          </IconButton>
          <IconButton
            onClick={refreshTree}
            tooltip={t('fileTree.actions.refresh')}
          >
            <RefreshCw size={13} />
          </IconButton>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* Inline creation at root level */}
        {creating && creating.parentPath === '' && (
          <div className="px-2 py-0.5">
            <FileTreeInlineInput
              placeholder={
                creating.kind === 'file'
                  ? t('fileTree.placeholder.file')
                  : t('fileTree.placeholder.folder')
              }
              onConfirm={handleCreateConfirm}
              onCancel={() => setCreating(null)}
            />
          </div>
        )}

        {nodes.map((node) => (
          <FileTreeNode
            key={node.path}
            node={node}
            depth={0}
            creating={creating}
            onCreateConfirm={handleCreateConfirm}
            onCancelCreate={() => setCreating(null)}
            onFileClick={handleFileClick}
            onDelete={handleDelete}
            onNewFileIn={(n) => {
              setCreating({ parentPath: n.path, kind: 'file' });
              // ensure directory is expanded first
              if (!n.isExpanded) useProjectStore.getState().expandDirectory(n.path);
            }}
            onNewDirIn={(n) => {
              setCreating({ parentPath: n.path, kind: 'dir' });
              if (!n.isExpanded) useProjectStore.getState().expandDirectory(n.path);
            }}
          />
        ))}

        {nodes.length === 0 && (
          <p className="px-3 py-4 text-center text-xs italic text-muted">
            {t('fileTree.empty')}
          </p>
        )}
      </div>

      {/* Open folder link */}
      <div className="border-t border-border/70 p-2">
        <button
          onClick={() => openProject()}
          className="flex w-full items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs text-muted transition-colors hover:bg-surface-strong/72 hover:text-foreground"
        >
          <OpenFolderIcon size={12} />
          {t('fileTree.openDifferent')}
        </button>
      </div>
    </div>
  );
}
