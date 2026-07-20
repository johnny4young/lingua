/**
 * implementation — Primary notebook editor area.
 *
 * Replaces the Monaco editor when `activeTab.kind === 'notebook'`.
 * Layout:
 *   - Toolbar: Add markdown / Add code / Run all / Run above / Stop /
 *     language-aware script export.
 *   - Cell list: scrollable column of `<NotebookMarkdownCellRow>` +
 *     `<NotebookCodeCellRow>` interspersed in user-defined order.
 *
 * implementation mount-virtualized the Monaco editor (only the active cell
 * hosts a live editor). implementation windows the ROW COUNT via the shared
 * `useListWindow` hook: only the rows whose vertical band intersects the
 * viewport (plus an overscan margin) mount, with two spacer `<li>`s
 * preserving the scrollbar geometry. In jsdom (`clientHeight === 0`) the
 * windower degrades to the full list, so component tests render every
 * cell. Programmatic activation (command-mode nav, run progress) scrolls
 * the target row into the window before focusing it.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
} from 'lucide-react';
import {
  isNotebookCodeCell,
  MAX_CELLS_PER_NOTEBOOK,
  type NotebookCellLanguage,
} from '../../../shared/notebook';
import { useEditorStore } from '../../stores/editorStore';
import {
  useNotebookStore,
} from '../../stores/notebookStore';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useNotebookRun } from '../../hooks/useNotebookRun';
import { useListWindow } from '../../hooks/useListWindow';
import {
  trackNotebookCellLanguageChanged,
} from '../../hooks/notebookTelemetry';
import {
  pickNotebookExportLanguage,
} from './notebookExportToScript';
import { isNotebookRunnableLanguage } from '../../runtime/notebookSession';
import { useNotebookCommandMode } from './useNotebookCommandMode';
import { NotebookToolbar } from './NotebookToolbar';
import { NotebookCellList } from './NotebookCellList';
import { useNotebookExportActions } from './useNotebookExportActions';
import { coerceNotebookCellLanguage, notebookTitleFromTabName } from './notebookViewModel';
import { useDismissibleNotebookPopover } from './useDismissibleNotebookPopover';
import { languageLabel } from '../../utils/languageMeta';

export interface NotebookViewProps {
  readonly tabId: string;
}
export function NotebookView({ tabId }: NotebookViewProps) {
  const { t } = useTranslation();
  const notebook = useNotebookStore((s) => s.notebooks[tabId]?.notebook);
  const cellRunStatusMap = useNotebookStore(
    (s) => s.notebooks[tabId]?.cellRunStatus
  );
  // FASE 4 — transient per-cell latency + variable-flow maps, threaded
  // into each code-cell row alongside `status`.
  const cellDurationMsMap = useNotebookStore(
    (s) => s.notebooks[tabId]?.cellDurationMs
  );
  const cellVarFlowMap = useNotebookStore(
    (s) => s.notebooks[tabId]?.cellVarFlow
  );
  // Signal-Slate — per-cell Jupyter [N] execution-order stamp map,
  // threaded into each code-cell row alongside status + latency.
  const cellExecutionOrderMap = useNotebookStore(
    (s) => s.notebooks[tabId]?.cellExecutionOrder
  );
  const createNotebookForTab = useNotebookStore((s) => s.createNotebookForTab);
  const addCell = useNotebookStore((s) => s.addCell);
  const removeCell = useNotebookStore((s) => s.removeCell);
  const updateCellSource = useNotebookStore((s) => s.updateCellSource);
  const setCellLanguage = useNotebookStore((s) => s.setCellLanguage);
  const moveCell = useNotebookStore((s) => s.moveCell);
  // Signal-Slate — new engine actions for the command-mode UX + toolbar.
  const transformCell = useNotebookStore((s) => s.transformCell);
  const undoDeleteCell = useNotebookStore((s) => s.undoDeleteCell);
  const clearAllOutputs = useNotebookStore((s) => s.clearAllOutputs);
  const restartNotebookSession = useNotebookStore(
    (s) => s.restartNotebookSession
  );
  const backingTabName = useEditorStore((s) => {
    const tab = s.tabs.find((item) => item.id === tabId);
    return tab?.kind === 'notebook' ? tab.name : null;
  });
  const backingTabLanguage = useEditorStore((s) => {
    const tab = s.tabs.find((item) => item.id === tabId);
    return tab?.kind === 'notebook'
      ? coerceNotebookCellLanguage(tab.language)
      : null;
  });
  const renameTab = useEditorStore((s) => s.renameTab);
  const pushStatusNotice = useUIStore((s) => s.pushStatusNotice);
  const { isAnyCellRunning, runCell, runAll, runAbove, runFromHere, stop } =
    useNotebookRun();
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  // Signal-Slate — keyboard-shortcut legend disclosure (the discoverable
  // command-mode cheat sheet). Token-only popover anchored to the "?"
  // button in the toolbar.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const shortcutsAnchorRef = useRef<HTMLDivElement | null>(null);
  // implementation — export-format menu (Script | Jupyter .ipynb). Same
  // popover mechanics as the shortcuts legend.
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuAnchorRef = useRef<HTMLDivElement | null>(null);
  // Signal-Slate — command-mode "enter edit" request. Markdown rows
  // start in preview, so command-mode Enter must flip them into their
  // editor. We bump a `{ cellId, nonce }` request the row watches; the
  // nonce lets a repeat-Enter on the same cell still re-trigger.
  const [editRequest, setEditRequest] = useState<{
    readonly cellId: string;
    readonly nonce: number;
  } | null>(null);
  const requestEditMode = useCallback((cellId: string) => {
    setEditRequest((prev) => ({
      cellId,
      nonce: (prev?.cellId === cellId ? prev.nonce : 0) + 1,
    }));
  }, []);
  const activeCellId = useNotebookStore(
    (s) => s.notebooks[tabId]?.activeCellId ?? null
  );
  const setActiveCell = useNotebookStore((s) => s.setActiveCell);
  // implementation Slice H implementation note — per-tab cell-list scroll persistence.
  const setNotebookScrollTop = useNotebookStore((s) => s.setNotebookScrollTop);

  // implementation — window the cell ROW count. The scrolling <section>
  // is the viewport; `useListWindow` mounts only the rows whose vertical
  // band intersects it (plus an 800px overscan tuned for tall cells). The
  // hook must run unconditionally (rules of hooks), so it reads an empty
  // key list before the notebook is created — `computeWindow` returns an
  // empty window for a zero-length list, which is harmless.
  const cellsScrollRef = useRef<HTMLElement | null>(null);
  const cellKeys = useMemo(
    () => notebook?.cells.map((cell) => cell.id) ?? [],
    [notebook]
  );
  const { listWindow, measureRef, scrollToIndex } = useListWindow({
    scrollRef: cellsScrollRef,
    keys: cellKeys,
    // implementation note — tuned for tall notebook cells (editor + outputs) vs. the
    // console's 28px ANSI rows.
    estimate: 120,
    overscanPx: 800,
  });

  // implementation note — restore this tab's remembered scroll offset ONCE, after the
  // first layout, then hand control to the user. A layout effect runs
  // before paint so the restore is invisible. We restore per `tabId` (not
  // on every render) so the windower's own scroll tracking isn't fought.
  const notebookReady = Boolean(notebook);
  const restoredScrollForTabRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!notebookReady) return;
    if (restoredScrollForTabRef.current === tabId) return;
    restoredScrollForTabRef.current = tabId;
    const element = cellsScrollRef.current;
    if (!element) return;
    const remembered = useNotebookStore.getState().notebookScrollTop[tabId] ?? 0;
    if (remembered > 0) element.scrollTop = remembered;
  }, [notebookReady, tabId]);

  // implementation note — persist the scroll offset as the user scrolls, throttled to
  // one write per animation frame so a flick-scroll doesn't thrash the
  // store. This coexists with the windower's own (separate) rAF scroll
  // listener; both read the same `scrollTop` independently.
  const scrollPersistRafRef = useRef<number | null>(null);
  const handleCellsScroll = useCallback(() => {
    if (scrollPersistRafRef.current !== null) return;
    scrollPersistRafRef.current = requestAnimationFrame(() => {
      scrollPersistRafRef.current = null;
      const element = cellsScrollRef.current;
      if (element) setNotebookScrollTop(tabId, element.scrollTop);
    });
  }, [setNotebookScrollTop, tabId]);
  useEffect(
    () => () => {
      if (scrollPersistRafRef.current !== null) {
        cancelAnimationFrame(scrollPersistRafRef.current);
        scrollPersistRafRef.current = null;
      }
    },
    []
  );

  const codeCellsCount = useMemo(
    () => notebook?.cells.filter(isNotebookCodeCell).length ?? 0,
    [notebook]
  );
  // implementation Slice C implementation note — the user's default-language preference is the
  // floor for new code cells, replacing the hardcoded `'javascript'`. The
  // contextual signals (backing tab language, an existing code cell) are
  // more specific and still win.
  const notebookDefaultCellLanguage = useSettingsStore(
    (s) => s.notebookDefaultCellLanguage
  );
  const preferredCodeLanguage = useMemo<NotebookCellLanguage>(() => {
    if (backingTabLanguage) return backingTabLanguage;
    const firstCodeCell = notebook?.cells.find(isNotebookCodeCell);
    return firstCodeCell?.language ?? notebookDefaultCellLanguage;
  }, [backingTabLanguage, notebook, notebookDefaultCellLanguage]);
  const exportLanguage = useMemo(
    () => (notebook ? pickNotebookExportLanguage(notebook) : null),
    [notebook]
  );

  useEffect(() => {
    if (notebook || backingTabName === null) return;
    createNotebookForTab(tabId, notebookTitleFromTabName(backingTabName));
  }, [backingTabName, createNotebookForTab, notebook, tabId]);

  useDismissibleNotebookPopover(
    shortcutsOpen,
    shortcutsAnchorRef,
    setShortcutsOpen
  );
  useDismissibleNotebookPopover(
    exportMenuOpen,
    exportMenuAnchorRef,
    setExportMenuOpen
  );

  const handleAddMarkdown = useCallback(() => {
    if (!notebook) return;
    if (notebook.cells.length >= MAX_CELLS_PER_NOTEBOOK) {
      pushStatusNotice({
        tone: 'warning',
        messageKey: 'notebook.notice.tooManyCells',
      });
      return;
    }
    addCell(tabId, notebook.cells[notebook.cells.length - 1]?.id ?? null, {
      kind: 'markdown',
    });
  }, [addCell, notebook, pushStatusNotice, tabId]);

  const handleAddCode = useCallback(
    (language: NotebookCellLanguage) => {
      if (!notebook) return;
      if (notebook.cells.length >= MAX_CELLS_PER_NOTEBOOK) {
        pushStatusNotice({
          tone: 'warning',
          messageKey: 'notebook.notice.tooManyCells',
        });
        return;
      }
      addCell(tabId, notebook.cells[notebook.cells.length - 1]?.id ?? null, {
        kind: 'code',
        language,
      });
    },
    [addCell, notebook, pushStatusNotice, tabId]
  );

  // implementation — switch a cell's language via the header selector +
  // emit the implementation note adoption signal. JS / TS / Python are all runnable
  // now; the handler still guards programmatic events against a
  // hypothetical non-runnable code-cell language so the store + telemetry
  // never carry one.
  const handleLanguageChange = useCallback(
    (cellId: string, language: NotebookCellLanguage) => {
      if (!isNotebookRunnableLanguage(language)) return;
      setCellLanguage(tabId, cellId, language);
      trackNotebookCellLanguageChanged(language);
    },
    [setCellLanguage, tabId]
  );

  const getLiveNotebookCells = useCallback(
    () => useNotebookStore.getState().notebooks[tabId]?.notebook.cells ?? null,
    [tabId]
  );

  const handleMove = useCallback(
    (cellId: string, direction: 'up' | 'down') => {
      const cells = getLiveNotebookCells();
      if (!cells) return;
      const idx = cells.findIndex((c) => c.id === cellId);
      if (idx === -1) return;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= cells.length) return;
      moveCell(tabId, idx, targetIdx);
    },
    [getLiveNotebookCells, moveCell, tabId]
  );

  const handleDelete = useCallback(
    (cellId: string) => {
      removeCell(tabId, cellId);
    },
    [removeCell, tabId]
  );

  // implementation Slice H implementation note — stable per-cell handlers so the memoized rows
  // see referentially-equal props and a keystroke in one cell does not
  // re-render every other mounted row. These replace the inline arrows the
  // row map used to pass (which changed identity every render).
  const handleActivate = useCallback(
    (cellId: string) => setActiveCell(tabId, cellId),
    [setActiveCell, tabId]
  );
  const handleSourceChange = useCallback(
    (cellId: string, source: string) => updateCellSource(tabId, cellId, source),
    [tabId, updateCellSource]
  );
  const handleRunCell = useCallback(
    (cellId: string) => void runCell(tabId, cellId),
    [runCell, tabId]
  );
  const handleMoveUp = useCallback(
    (cellId: string) => handleMove(cellId, 'up'),
    [handleMove]
  );
  const handleMoveDown = useCallback(
    (cellId: string) => handleMove(cellId, 'down'),
    [handleMove]
  );

  // implementation — read a cell's current index off the LIVE store rather
  // than closing over `notebook`, so the focus helpers below keep empty /
  // minimal dep lists (closing over `notebook` would rebuild them — and the
  // memoized command-mode actions — on every keystroke). Returns -1 when
  // the cell is gone.
  const cellIndexOf = useCallback(
    (cellId: string): number =>
      getLiveNotebookCells()?.findIndex((c) => c.id === cellId) ?? -1,
    [getLiveNotebookCells]
  );

  // Jupyter-parity run keybinds. implementation (Monaco cells): a code cell
  // no longer has an always-mounted textarea to focus, so "advance into
  // edit mode" routes through the edit-request mechanism — select the cell
  // and bump its edit nonce, which mounts its Monaco editor (it focuses
  // itself on mount). Works for a just-created cell too: `addCell` updates
  // the store synchronously, so the target row exists by the time React
  // re-renders with the bumped nonce.
  //
  // implementation — the active cell hosts the live editor, but a windowed off-
  // screen row is UNMOUNTED, so we must scroll it into the window BEFORE
  // focusing (the editor / shell only exists once the recompute mounts it).
  // `scrollToIndex` seeds the internal scrollTop synchronously, so one frame
  // lets the window recompute + mount the row, and a second frame lets the
  // freshly-mounted editor settle before we set the active cell + edit
  // request that drive its focus-on-mount.
  const focusCellSoon = useCallback(
    (cellId: string) => {
      const idx = cellIndexOf(cellId);
      if (idx >= 0) scrollToIndex(idx);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (cellIndexOf(cellId) === -1) return;
          setActiveCell(tabId, cellId);
          requestEditMode(cellId);
        });
      });
    },
    [cellIndexOf, requestEditMode, scrollToIndex, setActiveCell, tabId]
  );

  // Focus a cell SHELL (command mode) after the next paint — used after
  // a structural edit so focus follows the active cell back into command
  // mode rather than getting orphaned on a removed element. implementation: scroll
  // the target into the window first (double rAF: one frame for the window-
  // recompute render to mount the row, one to query + focus it), since an
  // off-screen shell is unmounted and `querySelector` would miss it.
  const focusShellSoon = useCallback(
    (cellId: string) => {
      const idx = cellIndexOf(cellId);
      if (idx >= 0) scrollToIndex(idx);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (cellIndexOf(cellId) === -1) return;
          // The shell carries `data-cell-id` + the `data-notebook-cell-shell`
          // marker on one node; the combined attribute selector matches it.
          const el = document.querySelector<HTMLElement>(
            `[data-cell-id="${cellId}"][data-notebook-cell-shell="true"]`
          );
          el?.focus();
        });
      });
    },
    [cellIndexOf, scrollToIndex]
  );

  // Insert a code cell ABOVE / BELOW the given cell + focus the new one
  // in edit mode (Jupyter `a` / `b`). The engine `addCell` only inserts
  // AFTER an anchor (or appends when null), so "above" inserts after the
  // anchor then walks the new cell up one slot via `moveCell` — that
  // lands it at the anchor's original index, which is "above" it.
  const insertCodeRelative = useCallback(
    (anchorCellId: string, position: 'above' | 'below') => {
      const cells = getLiveNotebookCells();
      if (!cells) return;
      if (cells.length >= MAX_CELLS_PER_NOTEBOOK) {
        pushStatusNotice({
          tone: 'warning',
          messageKey: 'notebook.notice.tooManyCells',
        });
        return;
      }
      const idx = cells.findIndex((c) => c.id === anchorCellId);
      if (idx === -1) return;
      const newId = addCell(tabId, anchorCellId, {
        kind: 'code',
        language: preferredCodeLanguage,
      });
      if (!newId) return;
      if (position === 'above') {
        // `addCell` placed the cell at idx+1; pull it up to idx so it
        // sits before the anchor.
        moveCell(tabId, idx + 1, idx);
      }
      focusCellSoon(newId);
    },
    [
      addCell,
      focusCellSoon,
      getLiveNotebookCells,
      moveCell,
      preferredCodeLanguage,
      pushStatusNotice,
      tabId,
    ]
  );

  const handleRunAndAdvance = useCallback(
    (cellId: string) => {
      void runCell(tabId, cellId);
      const cells = getLiveNotebookCells();
      if (!cells) return;
      const idx = cells.findIndex((c) => c.id === cellId);
      if (idx === -1) return;
      const nextCodeCell = cells.slice(idx + 1).find(isNotebookCodeCell);
      if (nextCodeCell) {
        focusCellSoon(nextCodeCell.id);
        return;
      }
      // Last cell — create a fresh code cell below to keep the flow
      // going, mirroring Jupyter's Shift+Enter at the bottom.
      if (cells.length >= MAX_CELLS_PER_NOTEBOOK) {
        pushStatusNotice({
          tone: 'warning',
          messageKey: 'notebook.notice.tooManyCells',
        });
        return;
      }
      const currentCell = cells[idx];
      const language =
        currentCell && isNotebookCodeCell(currentCell)
          ? currentCell.language
          : preferredCodeLanguage;
      const newId = addCell(tabId, cellId, {
        kind: 'code',
        language,
      });
      if (newId) focusCellSoon(newId);
    },
    [
      addCell,
      focusCellSoon,
      getLiveNotebookCells,
      preferredCodeLanguage,
      pushStatusNotice,
      runCell,
      tabId,
    ]
  );

  const handleRunAndInsertBelow = useCallback(
    (cellId: string) => {
      void runCell(tabId, cellId);
      const cells = getLiveNotebookCells();
      if (!cells) return;
      if (cells.length >= MAX_CELLS_PER_NOTEBOOK) {
        pushStatusNotice({
          tone: 'warning',
          messageKey: 'notebook.notice.tooManyCells',
        });
        return;
      }
      const currentCell = cells.find((cell) => cell.id === cellId);
      const language =
        currentCell && isNotebookCodeCell(currentCell)
          ? currentCell.language
          : preferredCodeLanguage;
      const newId = addCell(tabId, cellId, {
        kind: 'code',
        language,
      });
      if (newId) focusCellSoon(newId);
    },
    [
      addCell,
      focusCellSoon,
      getLiveNotebookCells,
      preferredCodeLanguage,
      pushStatusNotice,
      runCell,
      tabId,
    ]
  );

  const { handleExport, handleExportIpynb, handleExportLinguanb } =
    useNotebookExportActions({
      notebook,
      cellExecutionOrderMap,
      closeMenu: () => setExportMenuOpen(false),
    });

  const handleTitleCommit = useCallback(
    (value: string) => {
      setTitleDraft(null);
      if (!notebook) return;
      const trimmed = value.trim();
      if (trimmed.length === 0 || trimmed === notebook.title) return;
      renameTab(tabId, trimmed.endsWith('.linguanb') ? trimmed : `${trimmed}.linguanb`);
    },
    [notebook, renameTab, tabId]
  );

  // Signal-Slate — kernel-restart toolbar action. Disposes the sandbox +
  // wipes every transient run map (status / latency / var-flow / [N]) so
  // the next run starts from a clean kernel.
  const handleRestart = useCallback(() => {
    restartNotebookSession(tabId);
    pushStatusNotice({
      tone: 'info',
      messageKey: 'notebook.notice.kernelRestarted',
    });
  }, [pushStatusNotice, restartNotebookSession, tabId]);

  const handleClearOutputs = useCallback(() => {
    clearAllOutputs(tabId);
  }, [clearAllOutputs, tabId]);

  // implementation note — kick off the whole-notebook run, then scroll the FIRST code
  // cell (where progress begins) into view so a long notebook surfaces its
  // running cell instead of leaving the user staring at an off-screen row.
  const handleRunAll = useCallback(() => {
    void runAll(tabId);
    const firstCodeIdx =
      notebook?.cells.findIndex(isNotebookCodeCell) ?? -1;
    if (firstCodeIdx >= 0) scrollToIndex(firstCodeIdx);
  }, [notebook, runAll, scrollToIndex, tabId]);

  const handleRunFromHere = useCallback(() => {
    if (!activeCellId) return;
    void runFromHere(tabId, activeCellId);
    // implementation note — bring the cell the run starts at into view.
    const idx = cellIndexOf(activeCellId);
    if (idx >= 0) scrollToIndex(idx);
  }, [activeCellId, cellIndexOf, runFromHere, scrollToIndex, tabId]);

  // Signal-Slate — command-mode keyboard actions. Each maps a Jupyter
  // command-mode keybind onto the engine API; the `useNotebookCommandMode`
  // hook dispatches them from the cells-container `onKeyDown`.
  const commandModeActions = useMemo(
    () => ({
      insertCodeAbove: (cellId: string) => insertCodeRelative(cellId, 'above'),
      insertCodeBelow: (cellId: string) => insertCodeRelative(cellId, 'below'),
      deleteCell: (cellId: string) => {
        handleDelete(cellId);
        // After a delete the store reselects a neighbour; pull focus to
        // its shell so command mode keeps working.
        requestAnimationFrame(() => {
          const next = useNotebookStore.getState().getActiveCellId(tabId);
          if (next) focusShellSoon(next);
        });
      },
      undoDelete: () => {
        undoDeleteCell(tabId);
        requestAnimationFrame(() => {
          const restored = useNotebookStore.getState().getActiveCellId(tabId);
          if (restored) focusShellSoon(restored);
        });
      },
      toMarkdown: (cellId: string) => {
        // Drop any lingering "enter edit" request: a transform leaves
        // the cell in COMMAND mode, and a stale nonce on the fresh
        // markdown row would otherwise auto-open its editor a couple of
        // frames after `focusShellSoon`, yanking focus off the shell.
        setEditRequest(null);
        transformCell(tabId, cellId, 'markdown');
        focusShellSoon(cellId);
      },
      toCode: (cellId: string) => {
        setEditRequest(null);
        transformCell(tabId, cellId, 'code');
        focusShellSoon(cellId);
      },
      moveCell: (cellId: string, direction: 'up' | 'down') =>
        handleMove(cellId, direction),
      runInPlace: (cellId: string) => void runCell(tabId, cellId),
      runAndAdvance: (cellId: string) => handleRunAndAdvance(cellId),
      runAndInsertBelow: (cellId: string) => handleRunAndInsertBelow(cellId),
      interrupt: () => stop(),
      setActiveCell: (cellId: string) => {
        // implementation — j/k command-mode navigation routes through here. Scroll
        // the target row into the window FIRST (synchronously seeds the
        // internal scrollTop), so the recompute mounts its shell before the
        // command-mode hook's own next-frame `focusShell` queries for it —
        // an off-screen unmounted shell would otherwise never receive focus.
        const idx = cellIndexOf(cellId);
        if (idx >= 0) scrollToIndex(idx);
        setActiveCell(tabId, cellId);
      },
      requestEdit: (cellId: string) => requestEditMode(cellId),
    }),
    [
      cellIndexOf,
      focusShellSoon,
      handleDelete,
      handleMove,
      handleRunAndAdvance,
      handleRunAndInsertBelow,
      insertCodeRelative,
      requestEditMode,
      runCell,
      scrollToIndex,
      setActiveCell,
      stop,
      tabId,
      transformCell,
      undoDeleteCell,
    ]
  );

  const { handleContainerKeyDown } = useNotebookCommandMode({
    notebook,
    activeCellId,
    disabled: isAnyCellRunning,
    isAnyCellRunning,
    actions: commandModeActions,
  });

  if (!notebook) {
    return (
      <div
        data-testid="notebook-view-empty"
        className="grid h-full place-items-center p-6 text-center text-body-sm text-muted"
      >
        {t('notebook.empty.notFound')}
      </div>
    );
  }

  const lastCellId = notebook.cells[notebook.cells.length - 1]?.id ?? null;
  const lastCodeCellId =
    [...notebook.cells].reverse().find(isNotebookCodeCell)?.id ?? null;
  const disabled = isAnyCellRunning;
  const activeCellIndex =
    activeCellId === null
      ? -1
      : notebook.cells.findIndex((cell) => cell.id === activeCellId);
  const canRunThroughActiveCell =
    activeCellIndex >= 0 &&
    notebook.cells
      .slice(0, activeCellIndex + 1)
      .some(isNotebookCodeCell);
  // Run-from-here is enabled when the active cell (or any cell below it)
  // is runnable — mirrors `canRunThroughActiveCell` for the inverse range.
  const canRunFromActiveCell =
    activeCellIndex >= 0 &&
    notebook.cells.slice(activeCellIndex).some(isNotebookCodeCell);
  const hasOutputsToClear = notebook.cells.some(
    (cell) => isNotebookCodeCell(cell) && cell.outputs.length > 0
  );
  const exportLanguageLabel = exportLanguage
    ? languageLabel(exportLanguage)
    : t('notebook.toolbar.exportScriptGeneric');

  return (
    <div
      data-testid="notebook-view"
      data-notebook-id={notebook.id}
      className="grid h-full min-h-0 grid-rows-[auto_1fr] bg-background"
    >
      <NotebookToolbar
        notebook={notebook}
        titleDraft={titleDraft}
        setTitleDraft={setTitleDraft}
        handleTitleCommit={handleTitleCommit}
        codeCellsCount={codeCellsCount}
        handleAddMarkdown={handleAddMarkdown}
        disabled={disabled}
        handleAddCode={handleAddCode}
        preferredCodeLanguage={preferredCodeLanguage}
        activeCellId={activeCellId}
        runAbove={runAbove}
        tabId={tabId}
        canRunThroughActiveCell={canRunThroughActiveCell}
        handleRunFromHere={handleRunFromHere}
        canRunFromActiveCell={canRunFromActiveCell}
        handleRunAll={handleRunAll}
        lastCodeCellId={lastCodeCellId}
        isAnyCellRunning={isAnyCellRunning}
        stop={stop}
        handleRestart={handleRestart}
        handleClearOutputs={handleClearOutputs}
        hasOutputsToClear={hasOutputsToClear}
        exportMenuAnchorRef={exportMenuAnchorRef}
        setExportMenuOpen={setExportMenuOpen}
        exportMenuOpen={exportMenuOpen}
        handleExport={handleExport}
        handleExportIpynb={handleExportIpynb}
        handleExportLinguanb={handleExportLinguanb}
        exportLanguageLabel={exportLanguageLabel}
        shortcutsAnchorRef={shortcutsAnchorRef}
        setShortcutsOpen={setShortcutsOpen}
        shortcutsOpen={shortcutsOpen}
      />

      <NotebookCellList
        cellsScrollRef={cellsScrollRef}
        handleContainerKeyDown={handleContainerKeyDown}
        handleCellsScroll={handleCellsScroll}
        notebook={notebook}
        listWindow={listWindow}
        measureRef={measureRef}
        cellRunStatusMap={cellRunStatusMap}
        cellDurationMsMap={cellDurationMsMap}
        cellVarFlowMap={cellVarFlowMap}
        cellExecutionOrderMap={cellExecutionOrderMap}
        activeCellId={activeCellId}
        editRequest={editRequest}
        disabled={disabled}
        handleActivate={handleActivate}
        handleSourceChange={handleSourceChange}
        handleRunCell={handleRunCell}
        handleRunAndAdvance={handleRunAndAdvance}
        handleRunAndInsertBelow={handleRunAndInsertBelow}
        handleMoveUp={handleMoveUp}
        handleMoveDown={handleMoveDown}
        handleDelete={handleDelete}
        handleLanguageChange={handleLanguageChange}
        lastCellId={lastCellId}
        handleAddCode={handleAddCode}
        preferredCodeLanguage={preferredCodeLanguage}
        handleAddMarkdown={handleAddMarkdown}
      />
    </div>
  );
}
