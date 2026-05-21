import { useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';
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
import { useTranslation } from 'react-i18next';
import { useProjectStore, type FileTreeNode as ProjectFileTreeNode } from '../../stores/projectStore';
import {
  languageCapabilityBadgeKey,
  languageTextColorClass,
} from '../../utils/languageMeta';
import { Tooltip } from '../ui/chrome';
import { dirtyTabKey } from '../../hooks/useDirtyTabPaths';
import { FileTreeContextMenu, type FileTreeContextMenuItem } from './FileTreeContextMenu';
import { FileTreeInlineInput } from './FileTreeInlineInput';
import type { CreationTarget } from './fileTreeTypes';

interface FileTreeNodeProps {
  node: ProjectFileTreeNode;
  depth: number;
  creating: CreationTarget;
  /**
   * RL-024 Slice 1 — set of `rootId::relativePath` keys for tabs
   * with unsaved edits. Lifted to the tree root in `FileTree` so
   * recursive children share a single Zustand subscription instead
   * of mounting one per node. Default to an empty set for callers
   * (tests, storybook) that don't need the dirty-dot affordance.
   */
  dirtyTabPaths?: ReadonlySet<string>;
  onCreateConfirm: (value: string) => void;
  onCancelCreate: () => void;
  onFileClick: (node: ProjectFileTreeNode) => void;
  onDelete: (node: ProjectFileTreeNode) => void;
  onNewFileIn?: (node: ProjectFileTreeNode) => void;
  onNewDirIn?: (node: ProjectFileTreeNode) => void;
}

const EMPTY_DIRTY_SET: ReadonlySet<string> = new Set<string>();

export function FileTreeNode({
  node,
  depth,
  creating,
  dirtyTabPaths = EMPTY_DIRTY_SET,
  onCreateConfirm,
  onCancelCreate,
  onFileClick,
  onDelete,
  onNewFileIn,
  onNewDirIn,
}: FileTreeNodeProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [contextMenu, setContextMenu] = useState<
    { top: number; left: number } | null
  >(null);
  const { expandDirectory, collapseDirectory, renameEntry } = useProjectStore();
  const currentProject = useProjectStore((state) => state.currentProject);
  // RL-024 Slice 1 fold A — only surface the "Reveal in Finder"
  // menu item on the desktop build. The web FSA wrapper resolves
  // revealInFinder to `false`, so the menu would be empty there.
  const isWebBuild =
    typeof window !== 'undefined' && window.lingua?.platform === 'web';
  // RL-024 Slice 1 — light up a dot next to the file name whenever a
  // matching tab is dirty. Keyed by capability id + relative path so
  // the match is exact across platforms; only files inside the
  // currently-open project root can carry the dot.
  const isDirtyInTab =
    !node.isDirectory &&
    currentProject !== null &&
    dirtyTabPaths.has(dirtyTabKey(currentProject.rootId, node.path));

  const indent = depth * 12;

  // RL-038 Slice C fifth increment — surface the capability badge in
  // the file tree when the user is on the web build and the file
  // belongs to a host-toolchain language (Go, Rust). Stays hidden on
  // desktop and for self-contained runtimes.
  const capabilityKey =
    !node.isDirectory && node.language
      ? languageCapabilityBadgeKey(node.language)
      : null;
  const showDesktopOnlyBadge =
    isWebBuild && capabilityKey === 'language.capability.desktopOnly';

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

  // RL-024 Slice 1 fold A — assemble the context-menu items. Today
  // we surface a single action on desktop builds; the web FSA wrapper
  // has no underlying absolute path, so the menu collapses to empty
  // and we skip showing it altogether (no point in a blank popover).
  const contextMenuItems: ReadonlyArray<FileTreeContextMenuItem> = (() => {
    const items: FileTreeContextMenuItem[] = [];
    if (!isWebBuild && currentProject && window.lingua?.fs?.revealInFinder) {
      items.push({
        key: 'revealInFinder',
        label: t('fileTree.actions.revealInFinder'),
        onSelect: () => {
          void window.lingua.fs.revealInFinder(
            currentProject.rootId,
            node.path
          );
        },
      });
    }
    return items;
  })();

  const openContextMenu = (top: number, left: number) => {
    if (contextMenuItems.length === 0) return;
    setContextMenu({ top, left });
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (contextMenuItems.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    openContextMenu(event.clientY, event.clientX);
  };

  const handleNameKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (
      event.key !== 'ContextMenu' &&
      !(event.shiftKey && event.key === 'F10')
    ) {
      return;
    }
    if (contextMenuItems.length === 0) return;

    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    openContextMenu(rect.bottom + 4, rect.left + 8);
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
        onContextMenu={handleContextMenu}
      >
        {node.isDirectory ? (
          <button
            onClick={handleToggle}
            aria-label={t(
              node.isExpanded
                ? 'fileTree.actions.collapseFolder'
                : 'fileTree.actions.expandFolder',
              { name: node.name }
            )}
            className="shrink-0 text-muted hover:text-foreground"
          >
            {node.isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}

        {node.isDirectory ? (
          <button
            onClick={handleToggle}
            aria-label={t(
              node.isExpanded
                ? 'fileTree.actions.collapseFolder'
                : 'fileTree.actions.expandFolder',
              { name: node.name }
            )}
            className="shrink-0"
          >
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
          <Tooltip content={node.path}>
            <button
              className="flex-1 truncate text-left text-foreground/88 hover:text-foreground"
              onClick={() => (node.isDirectory ? handleToggle() : onFileClick(node))}
              onDoubleClick={() => setRenaming(true)}
              onKeyDown={handleNameKeyDown}
            >
              {node.name}
            </button>
          </Tooltip>
        )}

        {isDirtyInTab && !renaming && (
          <span
            role="img"
            aria-label={t('fileTree.dirtyDot.label')}
            data-testid={`file-tree-dirty-${node.path}`}
            className="ml-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
          />
        )}

        {showDesktopOnlyBadge && !renaming && (
          <span
            className="ml-1 shrink-0 rounded-md border border-border/60 bg-transparent px-1.5 py-0.5 text-[0.6rem] font-medium uppercase tracking-wide text-muted"
            data-testid={`file-tree-capability-${node.path}`}
          >
            {t('language.capability.desktopOnly')}
          </span>
        )}

        {hovered && !renaming && (
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            {node.isDirectory && onNewFileIn && (
              <Tooltip content={t('fileTree.actions.newFile')}>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onNewFileIn(node);
                  }}
                  className="rounded-lg p-1 text-muted hover:bg-surface hover:text-foreground"
                  aria-label={t('fileTree.actions.newFile')}
                >
                  <FilePlus size={11} />
                </button>
              </Tooltip>
            )}
            {node.isDirectory && onNewDirIn && (
              <Tooltip content={t('fileTree.actions.newFolder')}>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onNewDirIn(node);
                  }}
                  className="rounded-lg p-1 text-muted hover:bg-surface hover:text-foreground"
                  aria-label={t('fileTree.actions.newFolder')}
                >
                  <FolderPlus size={11} />
                </button>
              </Tooltip>
            )}
            <Tooltip content={t('dialogs.actions.delete')}>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(node);
                }}
                className="rounded-lg p-1 text-muted hover:bg-error/10 hover:text-error"
                aria-label={t('dialogs.actions.delete')}
              >
                <Trash2 size={11} />
              </button>
            </Tooltip>
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
              dirtyTabPaths={dirtyTabPaths}
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
              {t('fileTree.emptyDirectory')}
            </p>
          )}
        </div>
      )}

      {contextMenu && (
        <FileTreeContextMenu
          anchor={contextMenu}
          nodeName={node.name}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
