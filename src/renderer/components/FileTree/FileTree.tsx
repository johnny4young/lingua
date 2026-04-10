import { useState, useRef, useEffect } from 'react';
import {
  FileCode,
  FolderOpen,
  Folder,
  FolderPlus,
  FilePlus,
  RefreshCw,
  Trash2,
  ChevronRight,
  ChevronDown,
  FolderOpen as OpenFolderIcon,
} from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { useProjectStore, type FileTreeNode } from '../../stores/projectStore';
import { languageTextColorClass } from '../../utils/languageMeta';
import { IconButton } from '../ui/chrome';

// ------------------------------------------------------------------ sub-components

interface InlineInputProps {
  placeholder: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

function InlineInput({ placeholder, onConfirm, onCancel }: InlineInputProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => {
    const val = ref.current?.value.trim() ?? '';
    if (val) onConfirm(val);
    else onCancel();
  };

  return (
    <input
      ref={ref}
      placeholder={placeholder}
      className="field-shell rounded-xl px-2.5 py-1.5 text-xs"
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onCancel();
      }}
    />
  );
}

// ------------------------------------------------------------------ tree node

interface TreeNodeProps {
  node: FileTreeNode;
  depth: number;
  creating: CreationTarget;
  onCreateConfirm: (value: string) => void;
  onCancelCreate: () => void;
  onFileClick: (node: FileTreeNode) => void;
  onDelete: (node: FileTreeNode) => void;
  onNewFileIn?: (node: FileTreeNode) => void;
  onNewDirIn?: (node: FileTreeNode) => void;
}

function TreeNode({
  node,
  depth,
  creating,
  onCreateConfirm,
  onCancelCreate,
  onFileClick,
  onDelete,
  onNewFileIn,
  onNewDirIn,
}: TreeNodeProps) {
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const { expandDirectory, collapseDirectory, renameEntry } = useProjectStore();

  const indent = depth * 12;

  const handleToggle = async () => {
    if (!node.isDirectory) return;
    if (node.isExpanded) {
      collapseDirectory(node.path);
    } else {
      await expandDirectory(node.path);
    }
  };

  const handleRename = async (newName: string) => {
    await renameEntry(node.path, newName);
    setRenaming(false);
  };

  return (
    <div>
      <div
        className={`group flex items-center gap-1 rounded-xl px-1.5 py-1 text-xs transition-colors ${
          hovered ? 'bg-surface-strong/78' : 'hover:bg-surface-strong/58'
        }`}
        style={{ paddingLeft: `${indent + 4}px` }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Expand/collapse arrow for directories */}
        {node.isDirectory ? (
          <button
            onClick={handleToggle}
            className="shrink-0 text-muted hover:text-foreground"
          >
            {node.isExpanded ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}

        {/* Icon */}
        {node.isDirectory ? (
          <button onClick={handleToggle} className="shrink-0">
            {node.isExpanded ? (
              <FolderOpen size={13} className="text-warning" />
            ) : (
              <Folder size={13} className="text-warning" />
            )}
          </button>
        ) : (
          <FileCode
            size={13}
            className={languageTextColorClass(node.language ?? 'javascript')}
          />
        )}

        {/* Name / rename input */}
        {renaming ? (
          <InlineInput
            placeholder={node.name}
            onConfirm={handleRename}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <button
            className="flex-1 truncate text-left text-foreground/88 hover:text-foreground"
            onClick={() => (node.isDirectory ? handleToggle() : onFileClick(node))}
            onDoubleClick={() => setRenaming(true)}
            title={node.path}
          >
            {node.name}
          </button>
        )}

        {/* Hover actions */}
        {hovered && !renaming && (
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            {node.isDirectory && onNewFileIn && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onNewFileIn(node);
                }}
                className="rounded-lg p-1 text-muted hover:bg-surface hover:text-foreground"
                title="New file"
              >
                <FilePlus size={11} />
              </button>
            )}
            {node.isDirectory && onNewDirIn && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onNewDirIn(node);
                }}
                className="rounded-lg p-1 text-muted hover:bg-surface hover:text-foreground"
                title="New folder"
              >
                <FolderPlus size={11} />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(node);
              }}
              className="rounded-lg p-1 text-muted hover:bg-error/10 hover:text-error"
              title="Delete"
            >
              <Trash2 size={11} />
            </button>
          </div>
        )}
      </div>

      {/* Children */}
      {node.isDirectory && node.isExpanded && node.children && (
        <div>
          {creating && creating.parentPath === node.path && (
            <div
              className="px-2 py-0.5"
              style={{ paddingLeft: `${(depth + 2) * 12 + 4}px` }}
            >
              <InlineInput
                placeholder={creating.kind === 'file' ? 'filename.rs' : 'folder-name'}
                onConfirm={onCreateConfirm}
                onCancel={onCancelCreate}
              />
            </div>
          )}
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              creating={creating}
              onCreateConfirm={onCreateConfirm}
              onCancelCreate={onCancelCreate}
              onFileClick={onFileClick}
              onDelete={onDelete}
              onNewFileIn={onNewFileIn}
              onNewDirIn={onNewDirIn}
            />
          ))}
          {node.children.length === 0 && (
            <p
              className="py-0.5 text-xs italic text-muted"
              style={{ paddingLeft: `${(depth + 2) * 12 + 4}px` }}
            >
              empty
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ creation state

type CreationTarget = {
  parentPath: string;
  kind: 'file' | 'dir';
} | null;

// ------------------------------------------------------------------ main FileTree

export function FileTree() {
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

  const handleFileClick = async (node: FileTreeNode) => {
    await openFile(node.path, node.name, node.language ?? 'javascript');
  };

  const handleDelete = async (node: FileTreeNode) => {
    await deleteEntry(node.path, node.isDirectory);
  };

  const handleNewFile = (parentNode?: FileTreeNode) => {
    setCreating({
      parentPath: parentNode?.path ?? currentProject?.rootPath ?? '',
      kind: 'file',
    });
  };

  const handleNewDir = (parentNode?: FileTreeNode) => {
    setCreating({
      parentPath: parentNode?.path ?? currentProject?.rootPath ?? '',
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
      <div className="flex h-full flex-col bg-background/65">
        <div className="surface-header flex h-12 items-center gap-2 px-4">
          <OpenFolderIcon size={14} className="text-muted" />
          <span className="panel-title">Explorer</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-start gap-3 p-4 pt-8">
          <p className="text-center text-xs text-muted">No project open</p>
          <button
            onClick={createProject}
            className="button-primary w-full"
          >
            Create Project
          </button>
          <button
            onClick={() => openProject()}
            className="button-secondary w-full"
          >
            Open Folder
          </button>
          {recentProjects.length > 0 && (
            <div className="mt-3 w-full">
              <p className="mb-2 panel-title">Recent</p>
              {recentProjects.slice(0, 5).map((p) => (
                <button
                  key={p.id}
                  onClick={() => openProject(p.rootPath)}
                  className="flex w-full items-center gap-1.5 rounded-xl px-2 py-1.5 text-left text-xs text-muted transition-colors hover:bg-surface-strong/72 hover:text-foreground"
                  title={p.rootPath}
                >
                  <Folder size={12} className="shrink-0 text-warning" />
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Fallback: in-memory tabs */}
        {tabs.length > 0 && (
          <div className="border-t border-border/70">
            <div className="flex h-9 items-center gap-1.5 px-4">
              <span className="panel-title">Open Tabs</span>
            </div>
            <div className="p-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
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
            title="New file"
          >
            <FilePlus size={13} />
          </IconButton>
          <IconButton
            onClick={() => handleNewDir()}
            title="New folder"
          >
            <FolderPlus size={13} />
          </IconButton>
          <IconButton
            onClick={refreshTree}
            title="Refresh"
          >
            <RefreshCw size={13} />
          </IconButton>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* Inline creation at root level */}
        {creating && creating.parentPath === currentProject.rootPath && (
          <div className="px-2 py-0.5">
            <InlineInput
              placeholder={creating.kind === 'file' ? 'filename.rs' : 'folder-name'}
              onConfirm={handleCreateConfirm}
              onCancel={() => setCreating(null)}
            />
          </div>
        )}

        {nodes.map((node) => (
          <TreeNode
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
            Empty project
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
          Open different folder
        </button>
      </div>
    </div>
  );
}
