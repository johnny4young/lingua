import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Trash2,
} from 'lucide-react';
import { useProjectStore, type FileTreeNode as ProjectFileTreeNode } from '../../stores/projectStore';
import { languageTextColorClass } from '../../utils/languageMeta';
import { FileTreeInlineInput } from './FileTreeInlineInput';
import type { CreationTarget } from './fileTreeTypes';

interface FileTreeNodeProps {
  node: ProjectFileTreeNode;
  depth: number;
  creating: CreationTarget;
  onCreateConfirm: (value: string) => void;
  onCancelCreate: () => void;
  onFileClick: (node: ProjectFileTreeNode) => void;
  onDelete: (node: ProjectFileTreeNode) => void;
  onNewFileIn?: (node: ProjectFileTreeNode) => void;
  onNewDirIn?: (node: ProjectFileTreeNode) => void;
}

export function FileTreeNode({
  node,
  depth,
  creating,
  onCreateConfirm,
  onCancelCreate,
  onFileClick,
  onDelete,
  onNewFileIn,
  onNewDirIn,
}: FileTreeNodeProps) {
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const { expandDirectory, collapseDirectory, renameEntry } = useProjectStore();

  const indent = depth * 12;

  const handleToggle = async () => {
    if (!node.isDirectory) {
      return;
    }

    if (node.isExpanded) {
      collapseDirectory(node.path);
      return;
    }

    await expandDirectory(node.path);
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
        {node.isDirectory ? (
          <button
            onClick={handleToggle}
            className="shrink-0 text-muted hover:text-foreground"
          >
            {node.isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}

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

        {renaming ? (
          <FileTreeInlineInput
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

        {hovered && !renaming && (
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            {node.isDirectory && onNewFileIn && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
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
                onClick={(event) => {
                  event.stopPropagation();
                  onNewDirIn(node);
                }}
                className="rounded-lg p-1 text-muted hover:bg-surface hover:text-foreground"
                title="New folder"
              >
                <FolderPlus size={11} />
              </button>
            )}
            <button
              onClick={(event) => {
                event.stopPropagation();
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

      {node.isDirectory && node.isExpanded && node.children && (
        <div>
          {creating && creating.parentPath === node.path && (
            <div
              className="px-2 py-0.5"
              style={{ paddingLeft: `${(depth + 2) * 12 + 4}px` }}
            >
              <FileTreeInlineInput
                placeholder={creating.kind === 'file' ? 'filename.rs' : 'folder-name'}
                onConfirm={onCreateConfirm}
                onCancel={onCancelCreate}
              />
            </div>
          )}
          {node.children.map((child) => (
            <FileTreeNode
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
