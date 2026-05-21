import { useEffect, useMemo, useState } from 'react';
import {
  ChevronsDownUp,
  FolderOpen,
  FolderPlus,
  FilePlus,
  RefreshCw,
  FolderOpen as OpenFolderIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import { useProjectStore, type FileTreeNode as ProjectFileTreeNode } from '../../stores/projectStore';
import { countFiles } from '../../stores/projectTree';
import { PLAINTEXT_LANGUAGE } from '../../utils/language';
import { joinAbsolute, smartTruncatePath } from '../../utils/filePath';
import { useDirtyTabPaths } from '../../hooks/useDirtyTabPaths';
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
    collapseAllDirectories,
  } = useProjectStore();

  const [creating, setCreating] = useState<CreationTarget>(null);

  // RL-024 Slice 1 folds B + E — discovered-file count for the
  // header badge and a smart-truncated tooltip path. Memoised on the
  // tree reference so unrelated re-renders don't walk the tree.
  const fileCount = useMemo(() => countFiles(nodes), [nodes]);
  const truncatedRootPath = useMemo(
    () =>
      currentProject
        ? smartTruncatePath(currentProject.rootPath, {
            homePrefix: resolveHomePrefix(),
            maxLength: 42,
          })
        : '',
    [currentProject]
  );

  // RL-024 Slice 1 — lift `useDirtyTabPaths` to the tree root and
  // thread the resulting Set down as a prop. Subscribing per-node
  // would mount N independent Zustand listeners against
  // `editorStore.tabs`, and every keystroke creates a fresh `tabs`
  // array, so N nodes would mean N re-renders per character.
  const dirtyTabPaths = useDirtyTabPaths();

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
        <div className="min-w-0 flex-1">
          <span
            className="block truncate font-display text-sm font-semibold tracking-[0.08em] text-foreground"
            title={truncatedRootPath}
            data-testid="file-tree-root-tooltip"
          >
            {currentProject.name}
          </span>
          {fileCount > 0 && (
            <span
              className="block text-[0.65rem] uppercase tracking-[0.14em] text-muted"
              data-testid="file-tree-file-count"
            >
              {t('fileTree.fileCount', { count: fileCount })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton
            onClick={collapseAllDirectories}
            tooltip={t('fileTree.actions.collapseAll')}
            aria-label={t('fileTree.actions.collapseAll')}
          >
            <ChevronsDownUp size={13} />
          </IconButton>
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
            dirtyTabPaths={dirtyTabPaths}
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

/**
 * RL-024 Slice 1 fold E — best-effort home directory prefix for the
 * `smartTruncatePath` helper. The renderer can't read environment
 * variables directly, but the desktop preload exposes `process` via
 * `window.lingua.platform`. We probe `window.lingua` for any home
 * hint and fall back to the empty string (no prefix collapse) when
 * unavailable. Web builds always fall back since there is no native
 * home concept.
 */
function resolveHomePrefix(): string {
  if (typeof window === 'undefined') return '';
  // `window.lingua.home` is reserved for a future preload addition.
  // Until that ships, gracefully return ''.
  const linguaUnknown = window.lingua as unknown as { home?: string };
  if (typeof linguaUnknown?.home === 'string' && linguaUnknown.home.length > 0) {
    return linguaUnknown.home;
  }
  return '';
}
