/**
 * RL-043 Slice A — Single markdown-cell row.
 *
 * Two-mode UX:
 *   - Edit mode: `<textarea>` with the raw source.
 *   - Preview mode: rendered via the existing `<RecipeMarkdown>`
 *     4-element subset renderer (paragraphs / headings / inline code
 *     / fenced code / bullets). NO HTML pass-through, NO
 *     `dangerouslySetInnerHTML`.
 *
 * Default mode is preview when the cell has content + edit when
 * empty. Double-click on the preview swaps to edit; blur returns to
 * preview.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react';
import type { NotebookMarkdownCellV1 } from '../../../shared/notebook';
import { RecipeMarkdown } from '../Recipes/recipeMarkdown';
import { cn } from '../../utils/cn';

export interface NotebookMarkdownCellRowProps {
  readonly cell: NotebookMarkdownCellV1;
  readonly cellIndex: number;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly disabled: boolean;
  onSourceChange: (cellId: string, source: string) => void;
  onMoveUp: (cellId: string) => void;
  onMoveDown: (cellId: string) => void;
  onDelete: (cellId: string) => void;
}

export function NotebookMarkdownCellRow({
  cell,
  cellIndex,
  canMoveUp,
  canMoveDown,
  disabled,
  onSourceChange,
  onMoveUp,
  onMoveDown,
  onDelete,
}: NotebookMarkdownCellRowProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(cell.source.length === 0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 400)}px`;
  }, [cell.source, editing]);

  return (
    <article
      data-testid="notebook-markdown-cell-row"
      data-cell-id={cell.id}
      data-cell-kind="markdown"
      className="grid gap-2 rounded-md border border-border/40 bg-surface/30 p-3"
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="inline-flex h-5 items-center rounded bg-slate-500/15 px-1.5 text-[10px] font-bold uppercase tracking-wider text-muted ring-1 ring-slate-500/30"
            data-testid="notebook-markdown-cell-kind"
          >
            MD
          </span>
          <span
            className="text-[10px] uppercase tracking-wider text-muted"
            data-testid="notebook-markdown-cell-index"
          >
            {t('notebook.cell.indexLabel', { index: cellIndex + 1 })}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setEditing((current) => !current)}
            disabled={disabled}
            aria-label={t(editing ? 'notebook.cell.previewMarkdown' : 'notebook.cell.editMarkdown')}
            data-testid="notebook-markdown-cell-toggle-edit"
            aria-pressed={editing}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-surface-strong/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Pencil size={11} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onMoveUp(cell.id)}
            disabled={!canMoveUp || disabled}
            aria-label={t('notebook.cell.moveUp')}
            data-testid="notebook-markdown-cell-move-up"
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-surface-strong/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowUp size={11} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onMoveDown(cell.id)}
            disabled={!canMoveDown || disabled}
            aria-label={t('notebook.cell.moveDown')}
            data-testid="notebook-markdown-cell-move-down"
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-surface-strong/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowDown size={11} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(cell.id)}
            disabled={disabled}
            aria-label={t('notebook.cell.delete')}
            data-testid="notebook-markdown-cell-delete"
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-rose-500/10 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={11} aria-hidden="true" />
          </button>
        </div>
      </header>
      {editing ? (
        <textarea
          ref={textareaRef}
          value={cell.source}
          onChange={(event) => onSourceChange(cell.id, event.target.value)}
          onBlur={() => {
            if (cell.source.length > 0) setEditing(false);
          }}
          disabled={disabled}
          data-testid="notebook-markdown-cell-source"
          placeholder={t('notebook.cell.markdownSourcePlaceholder')}
          rows={3}
          spellCheck
          className={cn(
            'min-h-[48px] resize-none rounded border border-border/60 bg-background p-2 font-mono text-xs text-foreground outline-none',
            'focus:border-border-strong disabled:cursor-not-allowed'
          )}
        />
      ) : (
        <div
          data-testid="notebook-markdown-cell-preview"
          onDoubleClick={() => setEditing(true)}
          className="cursor-text rounded border border-transparent p-2 hover:border-border/40"
        >
          {cell.source.length === 0 ? (
            <p className="text-[11px] italic text-muted">
              {t('notebook.cell.markdownSourcePlaceholder')}
            </p>
          ) : (
            <RecipeMarkdown source={cell.source} />
          )}
        </div>
      )}
    </article>
  );
}
