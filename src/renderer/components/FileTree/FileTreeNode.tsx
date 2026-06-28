import { useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';
import {
  ChevronDown,
  ChevronRight,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useProjectStore, type FileTreeNode as ProjectFileTreeNode } from '../../stores/projectStore';
import { PLAINTEXT_LANGUAGE } from '../../utils/language';
import {
  languageBadgeTone,
  languageCapabilityBadgeKey,
} from '../../utils/languageMeta';
import { Tooltip } from '../ui/chrome';
import { asRelativePath } from '../../../shared/fs/brandedIds';
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
  /**
   * FASE 4 — `rootId::relativePath` key of the file backing the active
   * editor tab, or null when the active tab is not a project file.
   * Lifted to the tree root (like `dirtyTabPaths`) so the active-row
   * accent lights up the matching node without a per-node subscription
   * to `editorStore.activeTabId`.
   */
  activeFileKey?: string | null;
  onCreateConfirm: (value: string) => void;
  onCancelCreate: () => void;
  onFileClick: (node: ProjectFileTreeNode) => void;
  onDelete: (node: ProjectFileTreeNode) => void;
  onNewFileIn?: (node: ProjectFileTreeNode) => void;
  onNewDirIn?: (node: ProjectFileTreeNode) => void;
  /**
   * UX Sweep T7 — the tree keyboard navigator, owned by `FileTree` (it
   * holds the flat visible-node list + parent links). Each row's name
   * button delegates Arrow/Home/End to it, passing its own path.
   */
  onTreeKeyDown?: (nodePath: string, event: ReactKeyboardEvent<HTMLElement>) => void;
}

const EMPTY_DIRTY_SET: ReadonlySet<string> = new Set<string>();

export function FileTreeNode({
  node,
  depth,
  creating,
  dirtyTabPaths = EMPTY_DIRTY_SET,
  activeFileKey = null,
  onCreateConfirm,
  onCancelCreate,
  onFileClick,
  onDelete,
  onNewFileIn,
  onNewDirIn,
  onTreeKeyDown,
}: FileTreeNodeProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  // UX Sweep T1 fold B — keyboard users never trigger the mouse-only
  // hover state, so the row actions (New / Delete) were unreachable by
  // Tab. Track focus-within so the same affordances mount + reveal when
  // a keyboard user focuses into the row.
  const [focusWithin, setFocusWithin] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [contextMenu, setContextMenu] = useState<
    { top: number; left: number } | null
  >(null);
  // PERF-001 — select each action individually. The previous
  // store-wide `useProjectStore()` destructure subscribed every node to
  // the whole project store, so any `nodes` mutation (expand / collapse
  // / create / delete) re-rendered the entire recursive tree. Zustand
  // actions are stable references, so selecting them this way never
  // triggers a re-render; only the explicit `currentProject` selector
  // below drives node updates.
  const expandDirectory = useProjectStore((state) => state.expandDirectory);
  const collapseDirectory = useProjectStore((state) => state.collapseDirectory);
  const renameEntry = useProjectStore((state) => state.renameEntry);
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

  // FASE 4 — proto active-row accent. A file row lights up
  // (accent-soft bg + 2px accent left border) when it backs the active
  // editor tab, matched by the same `rootId::relativePath` key used for
  // the dirty dot. Directories never carry the active accent.
  const isActiveFile =
    !node.isDirectory &&
    currentProject !== null &&
    activeFileKey !== null &&
    activeFileKey === dirtyTabKey(currentProject.rootId, node.path);

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
            asRelativePath(node.path)
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
    // UX Sweep T7 — F2 starts an inline rename from the keyboard (the
    // rename UI was previously double-click only).
    if (event.key === 'F2') {
      event.preventDefault();
      setRenaming(true);
      return;
    }
    // UX Sweep T7 — Arrow/Home/End move between rows; delegate to the
    // tree-level navigator (it owns the flat visible-node list).
    if (
      onTreeKeyDown &&
      (event.key === 'ArrowUp' ||
        event.key === 'ArrowDown' ||
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowRight' ||
        event.key === 'Home' ||
        event.key === 'End')
    ) {
      onTreeKeyDown(node.path, event);
      return;
    }
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
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={node.isDirectory ? node.isExpanded : undefined}
      aria-selected={isActiveFile || undefined}
    >
      <div
        data-active={isActiveFile ? 'true' : undefined}
        className={`group flex items-center gap-1 rounded-xl border-l-2 px-1.5 py-1 text-body-sm transition-colors ${
          isActiveFile
            ? 'border-primary bg-primary-soft'
            : hovered || focusWithin
              ? 'border-transparent bg-surface-strong/78'
              : 'border-transparent hover:bg-surface-strong/58'
        }`}
        style={{ paddingLeft: `${indent + 4}px` }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocusWithin(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setFocusWithin(false);
          }
        }}
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
            className="focus-ring shrink-0 rounded text-muted hover:text-foreground"
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
            className="focus-ring shrink-0 rounded"
          >
            {node.isExpanded ? (
              <FolderOpen size={13} className="text-warning" />
            ) : (
              <Folder size={13} className="text-warning" />
            )}
          </button>
        ) : (
          <FileTreeGlyph language={node.language ?? PLAINTEXT_LANGUAGE} />
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
              data-tree-row={node.path}
              className={`focus-ring flex-1 truncate rounded text-left hover:text-foreground ${
                isActiveFile ? 'text-foreground' : 'text-foreground/88'
              }`}
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
            className="ml-1 shrink-0 rounded-md border border-border/60 bg-transparent px-1.5 py-0.5 text-micro font-medium uppercase tracking-wide text-muted"
            data-testid={`file-tree-capability-${node.path}`}
          >
            {t('language.capability.desktopOnly')}
          </span>
        )}

        {(hovered || focusWithin) && !renaming && (
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            {node.isDirectory && onNewFileIn && (
              <Tooltip content={t('fileTree.actions.newFile')}>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onNewFileIn(node);
                  }}
                  className="focus-ring rounded-lg p-1 text-muted hover:bg-surface hover:text-foreground"
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
                  className="focus-ring rounded-lg p-1 text-muted hover:bg-surface hover:text-foreground"
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
                className="focus-ring rounded-lg p-1 text-muted hover:bg-error/10 hover:text-error"
                aria-label={t('dialogs.actions.delete')}
              >
                <Trash2 size={11} />
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      {node.isDirectory && node.isExpanded && node.children && (
        <div role="group">
          {creating && creating.parentPath === node.path && (
            <div
              className="px-2 py-0.5"
              style={{ paddingLeft: `${(depth + 2) * 12 + 4}px` }}
            >
              <FileTreeInlineInput
                placeholder={
                  creating.kind === 'file'
                    ? t('fileTree.placeholder.file')
                    : t('fileTree.placeholder.folder')
                }
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
              activeFileKey={activeFileKey}
              onCreateConfirm={onCreateConfirm}
              onCancelCreate={onCancelCreate}
              onFileClick={onFileClick}
              onDelete={onDelete}
              onNewFileIn={onNewFileIn}
              onNewDirIn={onNewDirIn}
              onTreeKeyDown={onTreeKeyDown}
            />
          ))}
          {node.children.length === 0 && (
            <p
              className="py-0.5 text-body-sm italic text-muted"
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

/**
 * FASE 4 — colored filled mono glyph badge for a file row (proto lines
 * 59-60), replacing the former monochrome `FileCode` icon. Renders the
 * `languageBadgeTone` triple via inline `style` — the same token-backed
 * tone object `EditorTabs`, `FloatingActionPill`, and the open-tabs
 * foot consume, so no hardcoded color lives in this file.
 */
function FileTreeGlyph({ language }: { language: ProjectFileTreeNode['language'] }) {
  const tone = languageBadgeTone(language ?? PLAINTEXT_LANGUAGE);
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-sm font-mono text-nano font-bold uppercase leading-none"
      style={{
        minWidth: 16,
        height: 16,
        padding: '0 3px',
        letterSpacing: '0.04em',
        background: tone.background,
        color: tone.foreground,
      }}
    >
      {tone.code}
    </span>
  );
}
