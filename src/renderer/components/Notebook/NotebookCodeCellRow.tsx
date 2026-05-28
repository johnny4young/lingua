/**
 * RL-043 Slice A — Single code-cell row.
 *
 * Layout:
 *   - Header: language badge + cell index + status pill + action row
 *     (Run cell / Move up / Move down / Delete cell).
 *   - Body: source `<textarea>` (auto-grow to content height).
 *   - Outputs: stdout (slate) + stderr (rose) inline below the source.
 *
 * Slice A intentionally uses a textarea instead of Monaco. Slice B+
 * promotes to a virtualized Monaco editor — the surface contract
 * (source string, language, run handler) stays unchanged.
 */

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleDot,
  Loader2,
  Play,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type {
  NotebookCellLanguage,
  NotebookCodeCellV1,
} from '../../../shared/notebook';
import type { NotebookCellRunStatus } from '../../stores/notebookStore';
import { cn } from '../../utils/cn';
import { languageLabel } from '../../utils/languageMeta';

export interface NotebookCodeCellRowProps {
  readonly cell: NotebookCodeCellV1;
  readonly cellIndex: number;
  readonly status: NotebookCellRunStatus;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly disabled: boolean;
  onSourceChange: (cellId: string, source: string) => void;
  onRunCell: (cellId: string) => void;
  /**
   * Jupyter-parity keybind — `Shift+Enter` runs the cell then moves
   * focus to the next cell (creating one when this is the last). Falls
   * back to a plain in-place run when not provided.
   */
  onRunAndAdvance?: (cellId: string) => void;
  /**
   * Jupyter-parity keybind — `Alt+Enter` runs the cell then inserts a
   * fresh code cell directly below + focuses it. Falls back to a plain
   * in-place run when not provided.
   */
  onRunAndInsertBelow?: (cellId: string) => void;
  onMoveUp: (cellId: string) => void;
  onMoveDown: (cellId: string) => void;
  onDelete: (cellId: string) => void;
}

const STATUS_TONE: Record<NotebookCellRunStatus, string> = {
  idle: 'border-border/60 bg-surface/40 text-muted',
  running: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  ok: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  error: 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  stopped: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
};

const LANGUAGE_BADGE: Record<NotebookCellLanguage, string> = {
  javascript: 'bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300',
  typescript: 'bg-sky-500/15 text-sky-700 ring-sky-500/30 dark:text-sky-300',
  python: 'bg-emerald-500/15 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300',
};

const LANGUAGE_LABEL: Record<NotebookCellLanguage, string> = {
  javascript: 'JS',
  typescript: 'TS',
  python: 'PY',
};

function statusKey(status: NotebookCellRunStatus): string {
  switch (status) {
    case 'idle':
      return 'idle';
    case 'running':
      return 'running';
    case 'ok':
      return 'ok';
    case 'error':
      return 'error';
    case 'stopped':
      return 'stopped';
  }
}

export function NotebookCodeCellRow({
  cell,
  cellIndex,
  status,
  canMoveUp,
  canMoveDown,
  disabled,
  onSourceChange,
  onRunCell,
  onRunAndAdvance,
  onRunAndInsertBelow,
  onMoveUp,
  onMoveDown,
  onDelete,
}: NotebookCodeCellRowProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const label = languageLabel(cell.language);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 600)}px`;
  }, [cell.source]);

  return (
    <article
      data-testid="notebook-code-cell-row"
      data-cell-id={cell.id}
      data-cell-kind="code"
      data-status={status}
      className={cn(
        'grid gap-2 rounded-md border border-border/60 bg-background-elevated/60 p-3 transition-colors',
        // Active-cell accent — the focused cell gets a primary-tinted
        // border + faint ring so the user always knows which cell the
        // keyboard targets (Jupyter highlights the active cell the
        // same way).
        'focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/25'
      )}
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'inline-flex h-5 items-center rounded ring-1 px-1.5 text-[10px] font-bold uppercase tracking-wider',
              LANGUAGE_BADGE[cell.language]
            )}
            data-testid="notebook-code-cell-language"
          >
            {LANGUAGE_LABEL[cell.language]}
          </span>
          <span
            className="text-[10px] uppercase tracking-wider text-muted"
            data-testid="notebook-code-cell-index"
          >
            {t('notebook.cell.indexLabel', { index: cellIndex + 1 })}
          </span>
          <span
            className={cn(
              'inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[10px] uppercase tracking-wider',
              STATUS_TONE[status]
            )}
            data-testid="notebook-code-cell-status"
          >
            {status === 'running' ? (
              <Loader2 size={9} aria-hidden="true" className="animate-spin" />
            ) : status === 'ok' ? (
              <Check size={9} aria-hidden="true" />
            ) : status === 'error' ? (
              <X size={9} aria-hidden="true" />
            ) : status === 'stopped' ? (
              <Square size={9} aria-hidden="true" />
            ) : (
              <CircleDot size={9} aria-hidden="true" />
            )}
            {t(`notebook.status.${statusKey(status)}`)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onRunCell(cell.id)}
            disabled={disabled || status === 'running'}
            data-testid="notebook-code-cell-run"
            className="inline-flex h-6 items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 text-[10px] font-medium text-emerald-700 hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-300"
          >
            <Play size={9} aria-hidden="true" />
            {t('notebook.cell.runCell')}
          </button>
          <button
            type="button"
            onClick={() => onMoveUp(cell.id)}
            disabled={!canMoveUp || disabled}
            aria-label={t('notebook.cell.moveUp')}
            data-testid="notebook-code-cell-move-up"
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-surface-strong/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowUp size={11} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onMoveDown(cell.id)}
            disabled={!canMoveDown || disabled}
            aria-label={t('notebook.cell.moveDown')}
            data-testid="notebook-code-cell-move-down"
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-surface-strong/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowDown size={11} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(cell.id)}
            disabled={disabled}
            aria-label={t('notebook.cell.delete')}
            data-testid="notebook-code-cell-delete"
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-rose-500/10 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={11} aria-hidden="true" />
          </button>
        </div>
      </header>
      <textarea
        ref={textareaRef}
        value={cell.source}
        onChange={(event) => onSourceChange(cell.id, event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          // Jupyter-parity run keybinds (the muscle memory every
          // notebook user expects):
          //   Cmd/Ctrl+Enter — run in place, keep focus here.
          //   Shift+Enter    — run, then advance to the next cell
          //                    (create one if this is the last).
          //   Alt+Enter      — run, then insert a fresh cell below.
          // A plain Enter falls through to the textarea (newline).
          const runInPlace = event.metaKey || event.ctrlKey;
          const advance = event.shiftKey;
          const insertBelow = event.altKey;
          if (!runInPlace && !advance && !insertBelow) return;
          event.preventDefault();
          event.stopPropagation();
          if (disabled || status === 'running') return;
          if (advance) {
            (onRunAndAdvance ?? onRunCell)(cell.id);
          } else if (insertBelow) {
            (onRunAndInsertBelow ?? onRunCell)(cell.id);
          } else {
            onRunCell(cell.id);
          }
        }}
        disabled={disabled || status === 'running'}
        data-testid="notebook-code-cell-source"
        spellCheck={false}
        placeholder={t('notebook.cell.codeSourcePlaceholder', {
          language: label,
        })}
        title={t('notebook.cell.codeSourceShortcutHint')}
        rows={3}
        className="min-h-[64px] resize-none rounded border border-border/60 bg-background p-2 font-mono text-xs text-foreground outline-none focus:border-border-strong disabled:cursor-not-allowed"
      />
      {cell.outputs.length > 0 ? (
        <ul
          role="list"
          data-testid="notebook-code-cell-outputs"
          className="grid gap-0.5 rounded border border-border/40 bg-background-elevated/50 p-2"
        >
          {cell.outputs.map((output, idx) => (
            <li
              key={`${cell.id}-output-${idx}`}
              data-stream={output.stream}
              className={cn(
                'whitespace-pre-wrap break-all font-mono text-[11px]',
                output.stream === 'stderr'
                  ? 'text-rose-700 dark:text-rose-300'
                  : 'text-foreground'
              )}
            >
              {output.text}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
