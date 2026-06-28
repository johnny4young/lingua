/**
 * RL-043 Slice A — Primary notebook editor area.
 *
 * Replaces the Monaco editor when `activeTab.kind === 'notebook'`.
 * Layout:
 *   - Toolbar: Add markdown / Add code / Run all / Run above / Stop /
 *     language-aware script export.
 *   - Cell list: scrollable column of `<NotebookMarkdownCellRow>` +
 *     `<NotebookCodeCellRow>` interspersed in user-defined order.
 *
 * Slice G mount-virtualized the Monaco editor (only the active cell
 * hosts a live editor). Slice H windows the ROW COUNT via the shared
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
  CodeXml,
  FileText,
  Hammer,
  Keyboard,
  Loader2,
  Play,
  RotateCcw,
  Eraser,
  PlayCircle,
  Square,
  Sparkles,
} from 'lucide-react';
import {
  isNotebookCodeCell,
  isNotebookMarkdownCell,
  MAX_CELLS_PER_NOTEBOOK,
  NOTEBOOK_CELL_LANGUAGES,
  type NotebookCellLanguage,
} from '../../../shared/notebook';
import { useEditorStore } from '../../stores/editorStore';
import {
  type NotebookCellRunStatus,
  useNotebookStore,
} from '../../stores/notebookStore';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useNotebookRun } from '../../hooks/useNotebookRun';
import { useListWindow } from '../../hooks/useListWindow';
import {
  trackNotebookCellLanguageChanged,
  trackNotebookExported,
} from '../../hooks/notebookTelemetry';
import { NotebookCodeCellRow } from './NotebookCodeCellRow';
import { NotebookMarkdownCellRow } from './NotebookMarkdownCellRow';
import {
  exportNotebookAsScript,
  pickNotebookExportLanguage,
} from './notebookExportToScript';
import { exportNotebookAsIpynb } from './notebookExportToIpynb';
import { exportNotebookAsLinguanb } from './notebookExportToLinguanb';
import { downloadTextFile } from '../../utils/downloadTextFile';
import { saveOrDownloadLinguanb } from '../../runtime/notebookLinguanbDisk';
import { isNotebookRunnableLanguage } from '../../runtime/notebookSession';
import { useNotebookCommandMode } from './useNotebookCommandMode';
import { Kbd } from '../ui/ModalShell';
import { cn } from '../../utils/cn';
import { languageLabel } from '../../utils/languageMeta';

export interface NotebookViewProps {
  readonly tabId: string;
}

/**
 * Signal-Slate — the discoverable command-mode cheat sheet. Each row
 * pairs a translated description with the literal key caps (rendered in
 * `<Kbd>`, which the copy-check intentionally skips). Keeping the caps as
 * raw glyphs here is correct: they are key names, not translatable copy.
 */
const NOTEBOOK_SHORTCUT_HINTS: ReadonlyArray<{
  readonly keys: ReadonlyArray<string>;
  readonly labelKey: string;
}> = [
  { keys: ['Enter'], labelKey: 'notebook.command.legend.edit' },
  { keys: ['Esc'], labelKey: 'notebook.command.legend.command' },
  { keys: ['j', 'k'], labelKey: 'notebook.command.legend.navigate' },
  { keys: ['a', 'b'], labelKey: 'notebook.command.legend.insert' },
  { keys: ['d', 'd'], labelKey: 'notebook.command.legend.delete' },
  { keys: ['z'], labelKey: 'notebook.command.legend.undo' },
  { keys: ['m', 'y'], labelKey: 'notebook.command.legend.changeType' },
  { keys: ['⌘/Ctrl', '↵'], labelKey: 'notebook.command.legend.runInPlace' },
  { keys: ['⇧', '↵'], labelKey: 'notebook.command.legend.runAdvance' },
  { keys: ['⌥', '↵'], labelKey: 'notebook.command.legend.runInsert' },
  { keys: ['Ctrl', 'C'], labelKey: 'notebook.command.legend.interrupt' },
];

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
  // RL-043 Slice D — export-format menu (Script | Jupyter .ipynb). Same
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
  // RL-043 Slice H fold B — per-tab cell-list scroll persistence.
  const setNotebookScrollTop = useNotebookStore((s) => s.setNotebookScrollTop);

  // RL-043 Slice H — window the cell ROW count. The scrolling <section>
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
    // Fold E — tuned for tall notebook cells (editor + outputs) vs. the
    // console's 28px ANSI rows.
    estimate: 120,
    overscanPx: 800,
  });

  // Fold B — restore this tab's remembered scroll offset ONCE, after the
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

  // Fold B — persist the scroll offset as the user scrolls, throttled to
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
  // RL-043 Slice C fold D — the user's default-language preference is the
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

  // Dismiss the shortcuts legend on outside-click / Escape so it never
  // strands an open popover when the user moves on.
  useEffect(() => {
    if (!shortcutsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!shortcutsAnchorRef.current?.contains(event.target as Node)) {
        setShortcutsOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShortcutsOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [shortcutsOpen]);

  // RL-043 Slice D — dismiss the export menu on outside-click / Escape.
  useEffect(() => {
    if (!exportMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!exportMenuAnchorRef.current?.contains(event.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExportMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [exportMenuOpen]);

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

  // RL-043 Slice F — switch a cell's language via the header selector +
  // emit the fold-E adoption signal. JS / TS / Python are all runnable
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

  // RL-043 Slice H fold C — stable per-cell handlers so the memoized rows
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

  // RL-043 Slice H — read a cell's current index off the LIVE store rather
  // than closing over `notebook`, so the focus helpers below keep empty /
  // minimal dep lists (closing over `notebook` would rebuild them — and the
  // memoized command-mode actions — on every keystroke). Returns -1 when
  // the cell is gone.
  const cellIndexOf = useCallback(
    (cellId: string): number =>
      getLiveNotebookCells()?.findIndex((c) => c.id === cellId) ?? -1,
    [getLiveNotebookCells]
  );

  // Jupyter-parity run keybinds. RL-043 Slice (Monaco cells): a code cell
  // no longer has an always-mounted textarea to focus, so "advance into
  // edit mode" routes through the edit-request mechanism — select the cell
  // and bump its edit nonce, which mounts its Monaco editor (it focuses
  // itself on mount). Works for a just-created cell too: `addCell` updates
  // the store synchronously, so the target row exists by the time React
  // re-renders with the bumped nonce.
  //
  // Slice H — the active cell hosts the live editor, but a windowed off-
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
  // mode rather than getting orphaned on a removed element. Slice H: scroll
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

  const handleExport = useCallback(() => {
    setExportMenuOpen(false);
    if (!notebook) return;
    const result = exportNotebookAsScript(notebook);
    if (result.source.length === 0) {
      pushStatusNotice({
        tone: 'info',
        messageKey: 'notebook.notice.exportEmpty',
      });
      return;
    }
    try {
      downloadTextFile(
        result.source,
        result.suggestedFileName,
        'text/plain;charset=utf-8'
      );
      trackNotebookExported('script');
      pushStatusNotice({
        tone: 'success',
        messageKey: 'notebook.notice.exportOk',
      });
    } catch {
      pushStatusNotice({
        tone: 'error',
        messageKey: 'notebook.notice.exportFailed',
      });
    }
  }, [notebook, pushStatusNotice]);

  // RL-043 Slice D — export to Jupyter `.ipynb` (nbformat v4). Threads the
  // transient `[N]` execution-order map so Jupyter consumers see the run
  // sequence (fold C). Gated by the same toolbar disable as script export.
  const handleExportIpynb = useCallback(() => {
    setExportMenuOpen(false);
    if (!notebook) return;
    const result = exportNotebookAsIpynb(notebook, {
      executionOrder: cellExecutionOrderMap ?? {},
    });
    try {
      downloadTextFile(
        result.json,
        result.suggestedFileName,
        'application/x-ipynb+json;charset=utf-8'
      );
      trackNotebookExported('ipynb');
      pushStatusNotice({
        tone: 'success',
        messageKey: 'notebook.notice.exportIpynbOk',
      });
    } catch {
      pushStatusNotice({
        tone: 'error',
        messageKey: 'notebook.notice.exportFailed',
      });
    }
  }, [cellExecutionOrderMap, notebook, pushStatusNotice]);

  // RL-043 Slice E — export to the native lossless `.linguanb` document.
  // Threads the transient `[N]` execution-order map so a round-trip
  // restores the run sequence (fold B). Fold A: on desktop the export
  // goes through the native Save dialog (capability sandbox); on web it
  // falls back to a blob download. Gated by the same toolbar disable as
  // the other export formats.
  const handleExportLinguanb = useCallback(() => {
    setExportMenuOpen(false);
    if (!notebook) return;
    const result = exportNotebookAsLinguanb(notebook, {
      executionOrder: cellExecutionOrderMap ?? {},
    });
    void saveOrDownloadLinguanb(result.json, result.suggestedFileName, {
      onOk: () => {
        trackNotebookExported('linguanb');
        pushStatusNotice({
          tone: 'success',
          messageKey: 'notebook.notice.exportLinguanbOk',
        });
      },
      onError: () =>
        pushStatusNotice({
          tone: 'error',
          messageKey: 'notebook.notice.exportFailed',
        }),
    });
  }, [cellExecutionOrderMap, notebook, pushStatusNotice]);

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

  // Fold F — kick off the whole-notebook run, then scroll the FIRST code
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
    // Fold F — bring the cell the run starts at into view.
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
        // Slice H — j/k command-mode navigation routes through here. Scroll
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
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/40 bg-surface/30 px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            type="text"
            value={titleDraft ?? notebook.title}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={(event) => handleTitleCommit(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleTitleCommit(event.currentTarget.value);
              } else if (event.key === 'Escape') {
                setTitleDraft(null);
              }
            }}
            data-testid="notebook-title"
            spellCheck={false}
            aria-label={t('notebook.titleLabel')}
            className="min-w-0 flex-1 truncate rounded border border-transparent bg-transparent px-2 py-1 font-display text-body font-semibold tracking-tight text-foreground hover:border-border/40 focus:border-border-strong focus:bg-bg-elevated focus:outline-none"
          />
          <span className="hidden text-eyebrow uppercase tracking-wider text-muted sm:inline">
            {t('notebook.toolbar.summary', {
              cells: notebook.cells.length,
              codeCells: codeCellsCount,
            })}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={handleAddMarkdown}
            disabled={disabled}
            data-testid="notebook-toolbar-add-markdown"
            className="button-ghost px-2.5 text-caption"
          >
            <FileText size={11} aria-hidden="true" />
            {t('notebook.toolbar.addMarkdown')}
          </button>
          <button
            type="button"
            onClick={() => handleAddCode(preferredCodeLanguage)}
            disabled={disabled}
            data-testid="notebook-toolbar-add-code"
            className="button-ghost px-2.5 text-caption"
          >
            <CodeXml size={11} aria-hidden="true" />
            {t('notebook.toolbar.addCode')}
          </button>
          <span className="mx-1 h-4 w-px bg-border/60" aria-hidden="true" />
          <button
            type="button"
            onClick={() => {
              if (activeCellId) runAbove(tabId, activeCellId);
            }}
            disabled={disabled || !canRunThroughActiveCell}
            data-testid="notebook-toolbar-run-above"
            className="button-ghost px-2.5 text-caption"
          >
            <Hammer size={11} aria-hidden="true" />
            {t('notebook.toolbar.runAbove')}
          </button>
          <button
            type="button"
            onClick={handleRunFromHere}
            disabled={disabled || !canRunFromActiveCell}
            data-testid="notebook-toolbar-run-from-here"
            className="button-ghost px-2.5 text-caption"
          >
            <PlayCircle size={11} aria-hidden="true" />
            {t('notebook.toolbar.runFromHere')}
          </button>
          <button
            type="button"
            onClick={handleRunAll}
            disabled={disabled || lastCodeCellId === null}
            data-testid="notebook-toolbar-run-all"
            className={cn(
              'focus-ring inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-caption font-medium transition-colors duration-150',
              disabled
                ? 'border-border/40 bg-surface/40 text-muted'
                : 'border-success-border bg-success-bg text-success-fg hover:border-success-fg',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {isAnyCellRunning ? (
              <>
                <Loader2 size={11} aria-hidden="true" className="animate-spin" />
                {t('notebook.toolbar.running')}
              </>
            ) : (
              <>
                <Play size={11} aria-hidden="true" />
                {t('notebook.toolbar.runAll')}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={stop}
            disabled={!isAnyCellRunning}
            data-testid="notebook-toolbar-stop"
            className="focus-ring inline-flex items-center gap-1 rounded-lg border border-warning-border bg-warning-bg px-2.5 py-1.5 text-caption font-medium text-warning-fg transition-colors duration-150 hover:border-warning-fg disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Square size={11} aria-hidden="true" />
            {t('notebook.toolbar.stop')}
          </button>
          <span className="mx-1 h-4 w-px bg-border/60" aria-hidden="true" />
          <button
            type="button"
            onClick={handleRestart}
            disabled={disabled}
            title={t('notebook.toolbar.restartHint')}
            data-testid="notebook-toolbar-restart"
            className="button-ghost px-2.5 text-caption"
          >
            <RotateCcw size={11} aria-hidden="true" />
            {t('notebook.toolbar.restart')}
          </button>
          <button
            type="button"
            onClick={handleClearOutputs}
            disabled={disabled || !hasOutputsToClear}
            data-testid="notebook-toolbar-clear-outputs"
            className="button-ghost px-2.5 text-caption"
          >
            <Eraser size={11} aria-hidden="true" />
            {t('notebook.toolbar.clearOutputs')}
          </button>
          {/* RL-043 Slice D — export-format menu (Script | Jupyter .ipynb),
              same popover mechanics as the shortcuts legend. */}
          <div className="relative" ref={exportMenuAnchorRef}>
            <button
              type="button"
              onClick={() => setExportMenuOpen((open) => !open)}
              disabled={disabled || codeCellsCount === 0}
              aria-expanded={exportMenuOpen}
              aria-haspopup="menu"
              data-testid="notebook-toolbar-export"
              className="button-ghost px-2.5 text-caption"
            >
              <Sparkles size={11} aria-hidden="true" />
              {t('notebook.toolbar.export')}
            </button>
            {exportMenuOpen ? (
              <div
                role="menu"
                aria-label={t('notebook.toolbar.exportMenuLabel')}
                data-testid="notebook-export-menu"
                className="absolute right-0 top-9 z-20 w-60 rounded-md border border-border/60 bg-bg-elevated p-1 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleExport}
                  data-testid="notebook-export-script"
                  className="flex w-full items-center rounded px-2 py-1.5 text-left text-caption text-muted hover:bg-surface/60 hover:text-foreground"
                >
                  {t('notebook.toolbar.exportScript', {
                    language: exportLanguageLabel,
                  })}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleExportIpynb}
                  data-testid="notebook-export-ipynb"
                  className="flex w-full items-center rounded px-2 py-1.5 text-left text-caption text-muted hover:bg-surface/60 hover:text-foreground"
                >
                  {t('notebook.toolbar.exportAsIpynb')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleExportLinguanb}
                  data-testid="notebook-export-linguanb"
                  className="flex w-full items-center rounded px-2 py-1.5 text-left text-caption text-muted hover:bg-surface/60 hover:text-foreground"
                >
                  {t('notebook.toolbar.exportAsLinguanb')}
                </button>
              </div>
            ) : null}
          </div>
          <span className="mx-1 h-4 w-px bg-border/60" aria-hidden="true" />
          <div className="relative" ref={shortcutsAnchorRef}>
            <button
              type="button"
              onClick={() => setShortcutsOpen((open) => !open)}
              aria-expanded={shortcutsOpen}
              aria-haspopup="dialog"
              aria-label={t('notebook.command.shortcutsTitle')}
              title={t('notebook.command.shortcutsTitle')}
              data-testid="notebook-toolbar-shortcuts"
              className={cn(
                'focus-ring inline-flex h-[28px] w-[28px] items-center justify-center rounded-lg border text-caption transition-colors duration-150',
                shortcutsOpen
                  ? 'border-primary/60 bg-primary/10 text-foreground'
                  : 'border-transparent text-muted hover:bg-surface-strong/60 hover:text-foreground'
              )}
            >
              <Keyboard size={12} aria-hidden="true" />
            </button>
            {shortcutsOpen ? (
              <div
                role="dialog"
                aria-label={t('notebook.command.shortcutsTitle')}
                data-testid="notebook-shortcuts-legend"
                className="absolute right-0 top-9 z-20 w-72 rounded-md border border-border/60 bg-bg-elevated p-3 shadow-lg"
              >
                <p className="mb-2 text-eyebrow font-semibold uppercase tracking-wider text-muted">
                  {t('notebook.command.shortcutsTitle')}
                </p>
                <ul className="grid gap-1.5">
                  {NOTEBOOK_SHORTCUT_HINTS.map(({ keys, labelKey }) => (
                    <li
                      key={labelKey}
                      className="flex items-center justify-between gap-2 text-caption text-foreground"
                    >
                      <span>{t(labelKey)}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {keys.map((cap) => (
                          <Kbd key={cap}>{cap}</Kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <section
        ref={cellsScrollRef}
        data-testid="notebook-cells"
        onKeyDown={handleContainerKeyDown}
        onScroll={handleCellsScroll}
        className="min-h-0 overflow-y-auto px-4 py-3"
      >
        {notebook.cells.length === 0 ? (
          <div
            data-testid="notebook-cells-empty"
            className="grid place-items-center rounded border border-dashed border-border/60 p-8 text-center text-body-sm text-muted"
          >
            <div className="grid gap-2">
              <p>{t('notebook.empty.title')}</p>
              <p className="text-caption">{t('notebook.empty.cta')}</p>
            </div>
          </div>
        ) : (
          // RL-043 Slice H — windowed cell list. Only rows in
          // `[startIndex, endIndex]` mount; two aria-hidden spacer <li>s
          // hold the scrollbar geometry. The inter-row gap lives in each
          // row's `pb-3` (border box) so the windower measures it exactly —
          // hence no `gap-3` on the <ul>. In jsdom the windower degrades to
          // the full list and both spacers collapse to 0 (omitted).
          <ul role="list">
            {listWindow.topSpacer > 0 ? (
              <li aria-hidden="true" style={{ height: listWindow.topSpacer }} />
            ) : null}
            {notebook.cells
              .slice(listWindow.startIndex, listWindow.endIndex + 1)
              .map((cell, i) => {
                const idx = listWindow.startIndex + i;
                const status: NotebookCellRunStatus =
                  cellRunStatusMap?.[cell.id] ?? 'idle';
                const durationMs = cellDurationMsMap?.[cell.id];
                const varFlow = cellVarFlowMap?.[cell.id];
                const canMoveUp = idx > 0;
                const canMoveDown = idx < notebook.cells.length - 1;
                const isActive = activeCellId === cell.id;
                // Slice H a11y — windowing drops off-screen rows from the
                // DOM, so each mounted row reports the TRUE list size + its
                // 1-based position to assistive tech via aria-setsize /
                // aria-posinset (the W3C pattern for virtualized lists);
                // otherwise a screen reader would see only the mounted slice.
                if (isNotebookMarkdownCell(cell)) {
                  return (
                    <li
                      key={cell.id}
                      ref={measureRef(cell.id)}
                      className="pb-3"
                      aria-setsize={notebook.cells.length}
                      aria-posinset={idx + 1}
                    >
                      <NotebookMarkdownCellRow
                        cell={cell}
                        cellIndex={idx}
                        isActive={isActive}
                        editRequestNonce={
                          editRequest?.cellId === cell.id
                            ? editRequest.nonce
                            : null
                        }
                        canMoveUp={canMoveUp}
                        canMoveDown={canMoveDown}
                        disabled={disabled}
                        onActivate={handleActivate}
                        onSourceChange={handleSourceChange}
                        onMoveUp={handleMoveUp}
                        onMoveDown={handleMoveDown}
                        onDelete={handleDelete}
                      />
                    </li>
                  );
                }
                return (
                  <li
                    key={cell.id}
                    ref={measureRef(cell.id)}
                    className="pb-3"
                    aria-setsize={notebook.cells.length}
                    aria-posinset={idx + 1}
                  >
                    <NotebookCodeCellRow
                      cell={cell}
                      cellIndex={idx}
                      status={status}
                      durationMs={durationMs}
                      varFlow={varFlow}
                      executionOrder={cellExecutionOrderMap?.[cell.id] ?? null}
                      isActive={isActive}
                      editRequestNonce={
                        editRequest?.cellId === cell.id
                          ? editRequest.nonce
                          : null
                      }
                      canMoveUp={canMoveUp}
                      canMoveDown={canMoveDown}
                      disabled={disabled}
                      onActivate={handleActivate}
                      onSourceChange={handleSourceChange}
                      onRunCell={handleRunCell}
                      onRunAndAdvance={handleRunAndAdvance}
                      onRunAndInsertBelow={handleRunAndInsertBelow}
                      onMoveUp={handleMoveUp}
                      onMoveDown={handleMoveDown}
                      onDelete={handleDelete}
                      onLanguageChange={handleLanguageChange}
                    />
                  </li>
                );
              })}
            {listWindow.bottomSpacer > 0 ? (
              <li
                aria-hidden="true"
                style={{ height: listWindow.bottomSpacer }}
              />
            ) : null}
          </ul>
        )}
        {lastCellId !== null ? (
          <div className="mt-3 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => handleAddCode(preferredCodeLanguage)}
              disabled={disabled}
              data-testid="notebook-cells-append-code"
              className="inline-flex h-7 items-center gap-1 rounded border border-dashed border-border/40 bg-transparent px-3 text-caption text-muted hover:border-border-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CodeXml size={11} aria-hidden="true" />
              {t('notebook.toolbar.addCode')}
            </button>
            <button
              type="button"
              onClick={handleAddMarkdown}
              disabled={disabled}
              data-testid="notebook-cells-append-markdown"
              className="inline-flex h-7 items-center gap-1 rounded border border-dashed border-border/40 bg-transparent px-3 text-caption text-muted hover:border-border-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FileText size={11} aria-hidden="true" />
              {t('notebook.toolbar.addMarkdown')}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function notebookTitleFromTabName(name: string): string {
  const withoutExtension = name.endsWith('.linguanb')
    ? name.slice(0, -'.linguanb'.length)
    : name;
  return withoutExtension.trim() || 'Untitled notebook';
}

function coerceNotebookCellLanguage(
  language: string | null | undefined
): NotebookCellLanguage | null {
  if (
    typeof language === 'string' &&
    (NOTEBOOK_CELL_LANGUAGES as readonly string[]).includes(language)
  ) {
    return language as NotebookCellLanguage;
  }
  return null;
}
