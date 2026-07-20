/**
 * Signal-Slate — Jupyter-class command/edit mode for the notebook.
 *
 * The notebook now mirrors Jupyter's two-mode keyboard model:
 *
 *   - EDIT mode: the caret is inside a cell editor (Monaco for code,
 *     textarea for markdown); typing edits source. The only structural
 *     keybinds that fire here are the RUN family (Cmd/Ctrl+Enter,
 *     Shift+Enter, Alt+Enter) handled inside each cell row — everything
 *     else is a plain keystroke.
 *   - COMMAND mode: focus sits on the cell SHELL (a `tabIndex=-1`
 *     element), not the editor. Single-letter keybinds (j/k/a/b/dd/
 *     z/m/y) drive navigation + structural edits. No keystroke ever
 *     mutates source here.
 *
 * Esc (from an editor) drops to command mode (blur → focus the shell).
 * Enter (in command mode) enters edit mode (mount/focus the cell editor).
 * This hook owns the *derived* mode + the
 * imperative focus moves; the authoritative active-cell id stays in the
 * notebook store so selection survives re-render.
 *
 * Keybinds are dispatched from the cells-container `onKeyDown`. Because
 * focused editable descendants swallow their own keys (the cell row's run
 * handler is the only escape hatch), the container handler only ever sees
 * keys while focus is on a cell shell — i.e. command mode. We still guard
 * defensively against an editable target so a stray bubble can't fire a
 * structural op mid-type.
 */

import { useCallback, useMemo, useRef } from 'react';
import {
  isNotebookCodeCell,
  isNotebookMarkdownCell,
  type NotebookCellV1,
  type NotebookV1,
} from '../../../shared/notebook';

export type NotebookCellMode = 'command' | 'edit';

/** Window (ms) within which a second `d` press counts as `dd`. */
const DOUBLE_D_WINDOW_MS = 600;

export interface NotebookCommandModeActions {
  /** Insert a code cell ABOVE the active cell + focus it in edit mode. */
  readonly insertCodeAbove: (activeCellId: string) => void;
  /** Insert a code cell BELOW the active cell + focus it in edit mode. */
  readonly insertCodeBelow: (activeCellId: string) => void;
  /** Delete the active cell (Jupyter `dd`). */
  readonly deleteCell: (activeCellId: string) => void;
  /** Re-insert the most-recently deleted cell (Jupyter `z`). */
  readonly undoDelete: () => void;
  /** Transform the active cell to markdown (Jupyter `m`). */
  readonly toMarkdown: (activeCellId: string) => void;
  /** Transform the active cell to code (Jupyter `y`). */
  readonly toCode: (activeCellId: string) => void;
  /** Move the active cell up / down (Ctrl/Alt+ArrowUp / ArrowDown). */
  readonly moveCell: (activeCellId: string, direction: 'up' | 'down') => void;
  /** Run the active cell in place (Cmd/Ctrl+Enter). */
  readonly runInPlace: (activeCellId: string) => void;
  /** Run the active cell + advance / create-below (Shift+Enter). */
  readonly runAndAdvance: (activeCellId: string) => void;
  /** Run the active cell + insert below (Alt+Enter). */
  readonly runAndInsertBelow: (activeCellId: string) => void;
  /** Interrupt the running kernel (Ctrl+C). */
  readonly interrupt: () => void;
  /** Move active selection to a cell by id. */
  readonly setActiveCell: (cellId: string) => void;
  /**
   * Signal a cell to swap into its editor. Markdown rows start in
   * preview, and code rows now mount Monaco only while editing, so
   * command-mode Enter must flip the target before focus lands.
   */
  readonly requestEdit: (cellId: string) => void;
}

export interface UseNotebookCommandModeParams {
  readonly notebook: NotebookV1 | undefined;
  readonly activeCellId: string | null;
  readonly disabled: boolean;
  readonly isAnyCellRunning: boolean;
  readonly actions: NotebookCommandModeActions;
}

export interface UseNotebookCommandModeResult {
  /**
   * `onKeyDown` for the cells container. Handles every command-mode
   * keybind; never fires while an editor owns focus. This is the only
   * surface the view wires — selection + edit/command focus moves are
   * driven internally via the `actions` callbacks.
   */
  readonly handleContainerKeyDown: (
    event: React.KeyboardEvent<HTMLElement>
  ) => void;
}

/**
 * Imperatively focus a cell SHELL (command mode). Run after the next
 * paint so a freshly-created / reordered cell exists in the DOM first.
 */
function focusShell(cellId: string): void {
  requestAnimationFrame(() => {
    // The shell IS the `[data-cell-id]` element; it carries the
    // `data-notebook-cell-shell` marker so we can target it without
    // clobbering the row's existing `data-testid`.
    const el = document.querySelector<HTMLElement>(
      `[data-cell-id="${cellId}"][data-notebook-cell-shell="true"]`
    );
    el?.focus();
  });
}

/**
 * Imperatively focus a cell's EDITOR (edit mode). Markdown rows swap to a
 * textarea when they see the `requestEdit` signal; code rows mount Monaco
 * and focus themselves in `onMount`. The code-cell textarea selector remains
 * for component tests that mock Monaco with a textarea.
 */
function focusEditor(cellId: string): void {
  requestAnimationFrame(() => {
    const root = document.querySelector<HTMLElement>(
      `[data-cell-id="${cellId}"]`
    );
    const editable = root?.querySelector<HTMLTextAreaElement>(
      '[data-testid="notebook-code-cell-source"], [data-testid="notebook-markdown-cell-source"]'
    );
    editable?.focus();
  });
}

export function useNotebookCommandMode({
  notebook,
  activeCellId,
  disabled,
  isAnyCellRunning,
  actions,
}: UseNotebookCommandModeParams): UseNotebookCommandModeResult {
  // Timestamp of the last bare `d` press, for the `dd` delete chord.
  const lastDPressRef = useRef<number>(0);

  const cells: ReadonlyArray<NotebookCellV1> = useMemo(
    () => notebook?.cells ?? [],
    [notebook]
  );

  const enterEditMode = useCallback(
    (cellId: string) => {
      actions.setActiveCell(cellId);
      // Flip the row into its editor first. Markdown focus is applied on
      // the next frame; Monaco code cells focus themselves when mounted.
      actions.requestEdit(cellId);
      focusEditor(cellId);
    },
    [actions]
  );

  const navigate = useCallback(
    (direction: 'next' | 'prev') => {
      if (cells.length === 0) return;
      const currentIdx =
        activeCellId === null
          ? -1
          : cells.findIndex((c) => c.id === activeCellId);
      let targetIdx: number;
      if (currentIdx === -1) {
        targetIdx = direction === 'next' ? 0 : cells.length - 1;
      } else {
        targetIdx = direction === 'next' ? currentIdx + 1 : currentIdx - 1;
      }
      if (targetIdx < 0 || targetIdx >= cells.length) return;
      const target = cells[targetIdx];
      if (!target) return;
      actions.setActiveCell(target.id);
      focusShell(target.id);
    },
    [actions, activeCellId, cells]
  );

  const handleContainerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      // Never intercept while focus is in an editable surface: that is
      // EDIT mode, where keystrokes belong to the editor (and the run
      // family is handled inside the cell row). This is the hard line
      // that keeps single-letter keybinds out of typed source.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'TEXTAREA' ||
          target.tagName === 'INPUT' ||
          // implementation — the cell-header language `<select>` is
          // focusable; without this a keyboard user operating the
          // selector (option type-ahead) would also trigger single-letter
          // command-mode ops (j/k/d/a/b/m) on the cell.
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const active = activeCellId;
      // Most ops need an active cell; the few that don't (`z` undo)
      // are handled before this guard short-circuits.
      const activeCell = active
        ? cells.find((c) => c.id === active) ?? null
        : null;

      const key = event.key;
      const ctrlOrAlt = event.ctrlKey || event.altKey;

      // ---- Ctrl+C — interrupt the kernel -------------------------------
      // Always fire the best-effort interrupt: `stop()` is idempotent
      // and a no-op when nothing is in flight, so we don't gate it on a
      // possibly-stale `isAnyCellRunning` snapshot. `preventDefault`
      // only when a run is actually in flight so an idle Ctrl+C can
      // still reach a native copy when there is a selection.
      if (event.ctrlKey && (key === 'c' || key === 'C')) {
        if (isAnyCellRunning) event.preventDefault();
        actions.interrupt();
        return;
      }

      // ---- Ctrl/Alt + ArrowUp / ArrowDown — move the active cell -------
      if (ctrlOrAlt && (key === 'ArrowUp' || key === 'ArrowDown')) {
        if (active && !disabled) {
          event.preventDefault();
          actions.moveCell(active, key === 'ArrowUp' ? 'up' : 'down');
          // Keep the moved cell selected + focused at its new spot.
          focusShell(active);
        }
        return;
      }

      // ---- Run family in command mode ---------------------------------
      if (key === 'Enter') {
        if (event.metaKey || event.ctrlKey) {
          if (active && !disabled && !isAnyCellRunning) {
            event.preventDefault();
            actions.runInPlace(active);
          }
          return;
        }
        if (event.shiftKey) {
          if (active && !disabled && !isAnyCellRunning) {
            event.preventDefault();
            actions.runAndAdvance(active);
          }
          return;
        }
        if (event.altKey) {
          if (active && !disabled && !isAnyCellRunning) {
            event.preventDefault();
            actions.runAndInsertBelow(active);
          }
          return;
        }
        // Plain Enter — enter EDIT mode on the active cell.
        if (activeCell) {
          event.preventDefault();
          enterEditMode(activeCell.id);
        }
        return;
      }

      // Any further keybind that carries a modifier is not ours.
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // Any bare key OTHER than `d` breaks a half-armed `dd` chord, so a
      // later `d` starts a fresh chord rather than completing a stale one
      // (otherwise `d`, `j`, `d` within the window would delete the
      // now-different active cell — a destructive surprise). Jupyter
      // resets the chord on any intervening keystroke the same way.
      if (key !== 'd') lastDPressRef.current = 0;

      switch (key) {
        // ---- Navigation ----------------------------------------------
        case 'j':
        case 'ArrowDown':
          event.preventDefault();
          navigate('next');
          return;
        case 'k':
        case 'ArrowUp':
          event.preventDefault();
          navigate('prev');
          return;

        // ---- Insert --------------------------------------------------
        case 'a':
          if (active && !disabled) {
            event.preventDefault();
            actions.insertCodeAbove(active);
          }
          return;
        case 'b':
          if (active && !disabled) {
            event.preventDefault();
            actions.insertCodeBelow(active);
          }
          return;

        // ---- Delete (dd chord) ---------------------------------------
        case 'd': {
          if (!active || disabled) return;
          event.preventDefault();
          const now = Date.now();
          if (now - lastDPressRef.current <= DOUBLE_D_WINDOW_MS) {
            lastDPressRef.current = 0;
            actions.deleteCell(active);
          } else {
            lastDPressRef.current = now;
          }
          return;
        }

        // ---- Undo delete ---------------------------------------------
        case 'z':
          if (!disabled) {
            event.preventDefault();
            actions.undoDelete();
          }
          return;

        // ---- Transform kind ------------------------------------------
        case 'm':
          if (active && !disabled && activeCell && isNotebookCodeCell(activeCell)) {
            event.preventDefault();
            actions.toMarkdown(active);
          }
          return;
        case 'y':
          if (
            active &&
            !disabled &&
            activeCell &&
            isNotebookMarkdownCell(activeCell)
          ) {
            event.preventDefault();
            actions.toCode(active);
          }
          return;

        default:
          return;
      }
    },
    [
      actions,
      activeCellId,
      cells,
      disabled,
      enterEditMode,
      isAnyCellRunning,
      navigate,
    ]
  );

  return { handleContainerKeyDown };
}
