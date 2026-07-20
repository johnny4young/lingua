import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  ChevronsDownUp,
  FileArchive,
  FolderOpen,
  FolderPlus,
  FilePlus,
  RefreshCw,
  FolderOpen as OpenFolderIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getActiveTab, useEditorStore } from '../../stores/editorStore';
import { useProjectStore, type FileTreeNode as ProjectFileTreeNode } from '../../stores/projectStore';
import { countFiles } from '../../stores/projectTree';
import { PLAINTEXT_LANGUAGE } from '../../utils/language';
import { joinAbsolute, smartTruncatePath } from '../../utils/filePath';
import { useDirtyTabPaths, dirtyTabKey } from '../../hooks/useDirtyTabPaths';
import { useListWindow } from '../../hooks/useListWindow';
import { useProjectBundle } from '../../hooks/useProjectBundle';
import { IconButton } from '../ui/chrome';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { FileTreeEmptyState } from './FileTreeEmptyState';
import { FileTreeInlineInput } from './FileTreeInlineInput';
import { FileTreeNode } from './FileTreeNode';
import { FileTreeOpenTabs } from './FileTreeOpenTabs';
import { flattenVisibleRows } from './fileTreeRows';
import type { CreationTarget } from './fileTreeTypes';

// ------------------------------------------------------------------ main FileTree

/**
 * internal — estimated row height for the windower. Rows are `py-1` over a
 * ~16px line: ~24-26px real; `useListWindow` self-corrects per row via
 * ResizeObserver, so the estimate only shapes the first paint.
 */
const TREE_ROW_ESTIMATE_PX = 26;

interface FileTreeProps {
  onNavigate?: () => void;
}

function shouldUseRendererDeleteConfirm(): boolean {
  const platform = window.lingua?.platform;
  return platform === undefined || platform === 'web';
}

export function FileTree({ onNavigate }: FileTreeProps) {
  const { t } = useTranslation();
  // internal — granular selectors only. The previous store-wide
  // `useEditorStore()` / `useProjectStore()` destructures re-rendered the
  // entire recursive tree on every editor keystroke (a `content` update
  // rewrites `editorStore.tabs`, and a store-wide subscription fires on
  // any slice change). We now subscribe to the narrow slices the tree
  // body actually needs and pull every action as its own stable
  // reference (Zustand actions never change identity, so selecting one
  // never triggers a re-render). The open-tabs foot owns its own
  // narrowed `tabs` projection via `useShallow` in `FileTreeOpenTabs`,
  // so the tree no longer subscribes to the tab list at all.
  const openFile = useEditorStore((state) => state.openFile);
  // Derive the active editor tab's identity WITHOUT subscribing to the
  // whole `tabs` array: a primitive-returning selector only re-fires
  // when the active tab's capability binding changes, never on a
  // per-keystroke `content` mutation.
  const activeTabRootId = useEditorStore((state) => {
    const active = getActiveTab(state);
    return active?.rootId ?? null;
  });
  const activeTabRelativePath = useEditorStore((state) => {
    const active = getActiveTab(state);
    return active?.relativePath ?? null;
  });

  const currentProject = useProjectStore((state) => state.currentProject);
  const recentProjects = useProjectStore((state) => state.recentProjects);
  const nodes = useProjectStore((state) => state.nodes);
  const createProject = useProjectStore((state) => state.createProject);
  const openProject = useProjectStore((state) => state.openProject);
  const refreshTree = useProjectStore((state) => state.refreshTree);
  const createFile = useProjectStore((state) => state.createFile);
  const createDirectory = useProjectStore((state) => state.createDirectory);
  const deleteEntry = useProjectStore((state) => state.deleteEntry);
  const collapseAllDirectories = useProjectStore(
    (state) => state.collapseAllDirectories
  );
  // implementation — export the open project as a `.zip` bundle.
  const { exportProjectBundle } = useProjectBundle();

  const [creating, setCreating] = useState<CreationTarget>(null);
  // accessibility pass BLOCKER #1 — the entry pending a delete confirmation.
  // Web FSA delete has no trash, so web uses the shared renderer
  // ConfirmDialog. Desktop still delegates the final confirmation to
  // main-process IPC, keeping the host-filesystem trust boundary there.
  const [pendingDelete, setPendingDelete] = useState<ProjectFileTreeNode | null>(
    null
  );

  // implementation note — discovered-file count for the
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

  // implementation — lift `useDirtyTabPaths` to the tree root and
  // thread the resulting Set down as a prop. Subscribing per-node
  // would mount N independent Zustand listeners against
  // `editorStore.tabs`, and every keystroke creates a fresh `tabs`
  // array, so N nodes would mean N re-renders per character.
  const dirtyTabPaths = useDirtyTabPaths();

  // FASE 4 — derive the `rootId::relativePath` key of the active editor
  // tab so the matching tree row can render the proto active accent.
  // internal — computed from the narrow `activeTabRootId` /
  // `activeTabRelativePath` selectors (primitives that only change on a
  // tab switch / save), never the whole `tabs` array, so editor
  // keystrokes leave this key — and the tree rows it drives —
  // untouched. Lights up only when the active tab is a file inside the
  // currently-open project root.
  const activeFileKey = useMemo(() => {
    if (!currentProject) return null;
    if (
      activeTabRootId !== currentProject.rootId ||
      !activeTabRelativePath
    ) {
      return null;
    }
    return dirtyTabKey(currentProject.rootId, activeTabRelativePath);
  }, [currentProject, activeTabRootId, activeTabRelativePath]);

  // internal — the flat display-order row list (nodes + the synthetic
  // create/empty-dir rows) feeding the windower, plus the node-only
  // projection the ArrowUp/Down keyboard navigator steps through.
  const flatRows = useMemo(() => flattenVisibleRows(nodes, creating), [nodes, creating]);
  const visibleNodes = useMemo(
    () => flatRows.filter((row) => row.kind === 'node'),
    [flatRows]
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { listWindow, measureRef, scrollToIndex } = useListWindow({
    scrollRef,
    keys: useMemo(() => flatRows.map((row) => row.key), [flatRows]),
    estimate: TREE_ROW_ESTIMATE_PX,
  });

  const focusTreeRow = (path: string | undefined) => {
    if (!path) return;
    // internal — a keyboard jump (Home/End/long Arrow runs) can target a
    // row that is currently windowed out. Scroll it into the window
    // first so the focus target actually mounts.
    const rowIndex = flatRows.findIndex(
      (row) => row.kind === 'node' && row.node.path === path
    );
    if (
      rowIndex !== -1 &&
      (rowIndex < listWindow.startIndex || rowIndex > listWindow.endIndex)
    ) {
      scrollToIndex(rowIndex);
    }
    const tryFocus = (attempt: number) => {
      // Quoted attribute selector needs no CSS.escape (absent in some
      // jsdom); just guard `"`/`\` so a pathological name can't break it.
      const safe = path.replace(/["\\]/g, '\\$&');
      const row = document.querySelector<HTMLElement>(`[data-tree-row="${safe}"]`);
      if (row) {
        row.focus();
        return;
      }
      // The just-scrolled-in row may need one more frame to mount.
      if (attempt < 3) requestAnimationFrame(() => tryFocus(attempt + 1));
    };
    requestAnimationFrame(() => tryFocus(0));
  };

  const handleTreeKeyDown = (
    nodePath: string,
    event: ReactKeyboardEvent<HTMLElement>
  ) => {
    const idx = visibleNodes.findIndex((entry) => entry.node.path === nodePath);
    if (idx === -1) return;
    const entry = visibleNodes[idx]!;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusTreeRow(visibleNodes[Math.min(idx + 1, visibleNodes.length - 1)]?.node.path);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusTreeRow(visibleNodes[Math.max(idx - 1, 0)]?.node.path);
        break;
      case 'Home':
        event.preventDefault();
        focusTreeRow(visibleNodes[0]?.node.path);
        break;
      case 'End':
        event.preventDefault();
        focusTreeRow(visibleNodes[visibleNodes.length - 1]?.node.path);
        break;
      case 'ArrowRight':
        // Collapsed dir → expand; expanded dir → step into the first child.
        if (entry.node.isDirectory) {
          event.preventDefault();
          if (!entry.node.isExpanded) {
            void useProjectStore.getState().expandDirectory(entry.node.path);
          } else {
            const firstChild = visibleNodes[idx + 1];
            if (firstChild?.parentPath === entry.node.path) {
              focusTreeRow(firstChild.node.path);
            }
          }
        }
        break;
      case 'ArrowLeft':
        // Expanded dir → collapse; otherwise → jump to the parent row.
        if (entry.node.isDirectory && entry.node.isExpanded) {
          event.preventDefault();
          useProjectStore.getState().collapseDirectory(entry.node.path);
        } else if (entry.parentPath) {
          event.preventDefault();
          focusTreeRow(entry.parentPath);
        }
        break;
      default:
        break;
    }
  };

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

  const handleDelete = (node: ProjectFileTreeNode) => {
    if (shouldUseRendererDeleteConfirm()) {
      setPendingDelete(node);
      return;
    }
    void deleteEntry(node.path, node.isDirectory);
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    const node = pendingDelete;
    setPendingDelete(null);
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
        onCreateProject={createProject}
        onOpenProject={openProject}
        onOpenRecentProject={async (project) => {
          await openProject(project.rootPath);
          onNavigate?.();
        }}
        onSelectTab={onNavigate}
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
            className="block truncate font-display text-body font-semibold tracking-[0.08em] text-foreground"
            title={truncatedRootPath}
            data-testid="file-tree-root-tooltip"
          >
            {currentProject.name}
          </span>
          {fileCount > 0 && (
            <span
              className="block text-eyebrow uppercase tracking-[0.14em] text-muted"
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
          <IconButton
            onClick={() => void exportProjectBundle()}
            tooltip={t('fileTree.actions.exportProject')}
            aria-label={t('fileTree.actions.exportProject')}
          >
            <FileArchive size={13} />
          </IconButton>
        </div>
      </div>

      {/* Tree — internal: one windowed flat list. Only the rows whose band
          intersects the viewport (plus overscan) mount; two spacer divs
          preserve the scrollbar geometry. In jsdom (clientHeight 0) the
          windower degrades to the full list, so component tests see every
          row exactly as before virtualization. Tree semantics stay valid
          as a flat ARIA tree: each row carries role="treeitem" +
          aria-level, so depth no longer needs nested role="group" DOM. */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto py-1"
        role="tree"
        aria-label={t('fileTree.ariaLabel', { name: currentProject.name })}
      >
        {listWindow.topSpacer > 0 && (
          <div style={{ height: `${listWindow.topSpacer}px` }} aria-hidden role="presentation" />
        )}

        {flatRows.slice(listWindow.startIndex, listWindow.endIndex + 1).map((row) => {
          if (row.kind === 'create') {
            return (
              <div
                key={row.key}
                ref={measureRef(row.key)}
                role="treeitem"
                aria-level={row.parentPath ? row.depth + 2 : 1}
                className="px-2 py-0.5"
                style={
                  row.parentPath
                    ? { paddingLeft: `${(row.depth + 2) * 12 + 4}px` }
                    : undefined
                }
              >
                <FileTreeInlineInput
                  placeholder={
                    creating?.kind === 'file'
                      ? t('fileTree.placeholder.file')
                      : t('fileTree.placeholder.folder')
                  }
                  onConfirm={handleCreateConfirm}
                  onCancel={() => setCreating(null)}
                />
              </div>
            );
          }
          if (row.kind === 'empty-dir') {
            return (
              <p
                key={row.key}
                ref={measureRef(row.key)}
                role="treeitem"
                aria-level={row.depth + 2}
                aria-disabled="true"
                className="py-0.5 text-body-sm italic text-muted"
                style={{ paddingLeft: `${(row.depth + 2) * 12 + 4}px` }}
              >
                {t('fileTree.emptyDirectory')}
              </p>
            );
          }
          return (
            <FileTreeNode
              key={row.key}
              rowRef={measureRef(row.key)}
              node={row.node}
              depth={row.depth}
              dirtyTabPaths={dirtyTabPaths}
              activeFileKey={activeFileKey}
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
              onTreeKeyDown={handleTreeKeyDown}
            />
          );
        })}

        {listWindow.bottomSpacer > 0 && (
          <div style={{ height: `${listWindow.bottomSpacer}px` }} aria-hidden role="presentation" />
        )}

        {nodes.length === 0 && (
          <p
            role="treeitem"
            aria-level={1}
            aria-disabled="true"
            className="px-3 py-4 text-center text-body-sm italic text-muted"
          >
            {t('fileTree.empty')}
          </p>
        )}
      </div>

      {/* Open folder link */}
      <div className="border-t border-border/70 p-2">
        <button
          onClick={() => openProject()}
          className="focus-ring flex w-full items-center gap-1.5 rounded-xl px-2.5 py-2 text-body-sm text-muted transition-colors hover:bg-surface-strong/72 hover:text-foreground"
        >
          <OpenFolderIcon size={12} />
          {t('fileTree.openDifferent')}
        </button>
      </div>

      {/* FASE 4 — synced Open-tabs foot, identical to the no-project
          empty state. Self-renders to null when no tabs are open.
          internal — it owns its own narrowed `tabs` projection so a
          keystroke in the editor does not re-render the explorer tree. */}
      <FileTreeOpenTabs onNavigate={onNavigate} />

      {pendingDelete ? (
        <ConfirmDialog
          testId="file-tree-delete-confirm"
          title={t('fileTree.delete.confirm.title')}
          body={t(
            pendingDelete.isDirectory
              ? 'fileTree.delete.confirm.body.directory'
              : 'fileTree.delete.confirm.body.file',
            { name: pendingDelete.name }
          )}
          confirmLabel={t('fileTree.delete.confirm.confirm')}
          cancelLabel={t('fileTree.delete.confirm.cancel')}
          onConfirm={() => void handleConfirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * implementation note — best-effort home directory prefix for the
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
