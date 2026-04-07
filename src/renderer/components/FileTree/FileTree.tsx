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
      className="w-full rounded border border-primary-500 bg-gray-800 px-1.5 py-0.5 text-xs text-gray-100 outline-none"
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
  onFileClick: (node: FileTreeNode) => void;
  onDelete: (node: FileTreeNode) => void;
  onNewFileIn?: (node: FileTreeNode) => void;
  onNewDirIn?: (node: FileTreeNode) => void;
}

function TreeNode({
  node,
  depth,
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
        className={`group flex items-center gap-1 rounded px-1 py-0.5 text-xs transition-colors ${
          hovered ? 'bg-gray-800/60' : 'hover:bg-gray-800/40'
        }`}
        style={{ paddingLeft: `${indent + 4}px` }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Expand/collapse arrow for directories */}
        {node.isDirectory ? (
          <button
            onClick={handleToggle}
            className="shrink-0 text-gray-500 hover:text-gray-300"
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
              <FolderOpen size={13} className="text-yellow-500" />
            ) : (
              <Folder size={13} className="text-yellow-600" />
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
            className="flex-1 truncate text-left text-gray-300 hover:text-gray-100"
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
                className="rounded p-0.5 text-gray-500 hover:bg-gray-700 hover:text-gray-300"
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
                className="rounded p-0.5 text-gray-500 hover:bg-gray-700 hover:text-gray-300"
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
              className="rounded p-0.5 text-gray-500 hover:bg-red-900/50 hover:text-red-400"
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
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onFileClick={onFileClick}
              onDelete={onDelete}
              onNewFileIn={onNewFileIn}
              onNewDirIn={onNewDirIn}
            />
          ))}
          {node.children.length === 0 && (
            <p
              className="py-0.5 text-xs text-gray-600 italic"
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
      <div className="flex h-full flex-col bg-gray-900">
        <div className="flex h-8 items-center gap-1.5 border-b border-gray-800 px-3">
          <OpenFolderIcon size={14} className="text-gray-500" />
          <span className="text-xs font-medium text-gray-400">Explorer</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-start gap-2 p-3 pt-6">
          <p className="text-center text-xs text-gray-500">No project open</p>
          <button
            onClick={createProject}
            className="w-full rounded bg-primary-600/20 px-2 py-1.5 text-xs font-medium text-primary-400 transition-colors hover:bg-primary-600/30"
          >
            Create Project
          </button>
          <button
            onClick={() => openProject()}
            className="w-full rounded bg-gray-800 px-2 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-700"
          >
            Open Folder
          </button>
          {recentProjects.length > 0 && (
            <div className="mt-3 w-full">
              <p className="mb-1.5 text-xs font-medium text-gray-500">Recent</p>
              {recentProjects.slice(0, 5).map((p) => (
                <button
                  key={p.id}
                  onClick={() => openProject(p.rootPath)}
                  className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-300"
                  title={p.rootPath}
                >
                  <Folder size={12} className="shrink-0 text-yellow-600" />
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Fallback: in-memory tabs */}
        {tabs.length > 0 && (
          <div className="border-t border-gray-800">
            <div className="flex h-7 items-center gap-1.5 px-3">
              <span className="text-xs font-medium text-gray-500">Open Tabs</span>
            </div>
            <div className="p-1">
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
                  <FileCode size={13} className={languageTextColorClass(tab.language)} />
                  <span className="truncate">{tab.name}</span>
                  {tab.isDirty && (
                    <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary-400" />
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
    <div className="flex h-full flex-col bg-gray-900">
      {/* Header */}
      <div className="flex h-8 items-center gap-1.5 border-b border-gray-800 px-2">
        <FolderOpen size={14} className="shrink-0 text-yellow-500" />
        <span
          className="flex-1 truncate text-xs font-medium text-gray-300"
          title={currentProject.rootPath}
        >
          {currentProject.name.toUpperCase()}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => handleNewFile()}
            className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
            title="New file"
          >
            <FilePlus size={13} />
          </button>
          <button
            onClick={() => handleNewDir()}
            className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
            title="New folder"
          >
            <FolderPlus size={13} />
          </button>
          <button
            onClick={refreshTree}
            className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
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
          <p className="px-3 py-4 text-center text-xs text-gray-600 italic">
            Empty project
          </p>
        )}
      </div>

      {/* Open folder link */}
      <div className="border-t border-gray-800 p-1">
        <button
          onClick={() => openProject()}
          className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-400"
        >
          <OpenFolderIcon size={12} />
          Open different folder
        </button>
      </div>
    </div>
  );
}
