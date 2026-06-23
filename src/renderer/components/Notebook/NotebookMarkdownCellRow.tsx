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
import { StatusBadge } from '../ui/StatusBadge';
import { cn } from '../../utils/cn';

export interface NotebookMarkdownCellRowProps {
  readonly cell: NotebookMarkdownCellV1;
  readonly cellIndex: number;
  /**
   * Signal-Slate — true when this is the active cell (keyboard target).
   * Drives the left accent bar + the Command/Edit mode label so markdown
   * cells participate in the same command/edit model as code cells.
   */
  readonly isActive: boolean;
  /**
   * Signal-Slate — bumped by the parent when command-mode Enter targets
   * this cell, flipping the preview into its editor. `null` when no edit
   * has been requested. The nonce lets a repeat-Enter re-trigger.
   */
  readonly editRequestNonce?: number | null;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly disabled: boolean;
  /** Mark this cell active (mouse / focus). */
  onActivate: (cellId: string) => void;
  onSourceChange: (cellId: string, source: string) => void;
  onMoveUp: (cellId: string) => void;
  onMoveDown: (cellId: string) => void;
  onDelete: (cellId: string) => void;
}

export function NotebookMarkdownCellRow({
  cell,
  cellIndex,
  isActive,
  editRequestNonce = null,
  canMoveUp,
  canMoveDown,
  disabled,
  onActivate,
  onSourceChange,
  onMoveUp,
  onMoveDown,
  onDelete,
}: NotebookMarkdownCellRowProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(cell.source.length === 0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const mode: 'command' | 'edit' = editing ? 'edit' : 'command';

  useEffect(() => {
    if (!editing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 400)}px`;
  }, [cell.source, editing]);

  // Signal-Slate — command-mode Enter flips this preview into its editor.
  // The parent bumps `editRequestNonce`; we open edit mode + focus the
  // textarea on the next frame once it's mounted. The flip lands inside
  // the rAF callback (not the effect body) so we don't synchronously
  // setState during the effect — the focus + render happen together on
  // the next paint, after the textarea has mounted.
  useEffect(() => {
    if (editRequestNonce === null) return;
    const id = requestAnimationFrame(() => {
      setEditing(true);
      // A second frame guarantees the textarea is mounted before focus.
      requestAnimationFrame(() => textareaRef.current?.focus());
    });
    return () => cancelAnimationFrame(id);
  }, [editRequestNonce]);

  return (
    <article
      ref={shellRef}
      data-testid="notebook-markdown-cell-row"
      data-notebook-cell-shell="true"
      data-cell-id={cell.id}
      data-cell-kind="markdown"
      data-cell-mode={isActive ? mode : undefined}
      data-active={isActive ? 'true' : undefined}
      tabIndex={-1}
      onMouseDown={() => onActivate(cell.id)}
      onFocus={() => onActivate(cell.id)}
      className={cn(
        'relative grid gap-2 rounded-md border bg-surface/30 p-3 pl-4 outline-none transition-colors',
        isActive
          ? 'border-primary/60 ring-1 ring-primary/25'
          : 'border-border/40'
      )}
    >
      {isActive ? (
        <span
          aria-hidden="true"
          data-testid="notebook-cell-accent"
          className={cn(
            'absolute inset-y-1 left-0 w-[3px] rounded-full',
            mode === 'edit' ? 'bg-primary' : 'bg-primary/40'
          )}
        />
      ) : null}
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {/* FASE 4 — the MD type badge reuses the canonical
              StatusBadge (neutral tone) so the markdown + code cell
              headers share one chip primitive, matching the proto's
              MD/JS glyph treatment. Token-only. */}
          <span data-testid="notebook-markdown-cell-kind">
            <StatusBadge tone="neutral">MD</StatusBadge>
          </span>
          <span
            className="text-eyebrow uppercase tracking-wider text-muted"
            data-testid="notebook-markdown-cell-index"
          >
            {t('notebook.cell.indexLabel', { index: cellIndex + 1 })}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isActive ? (
            <span
              data-testid="notebook-cell-mode"
              data-mode={mode}
              className={cn(
                'mr-1 hidden rounded px-1.5 text-micro font-semibold uppercase tracking-wider sm:inline',
                mode === 'edit'
                  ? 'bg-primary/15 text-primary'
                  : 'bg-bg-panel-alt text-fg-subtle'
              )}
            >
              {t(
                mode === 'edit'
                  ? 'notebook.command.modeEdit'
                  : 'notebook.command.modeCommand'
              )}
            </span>
          ) : null}
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
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-error-bg hover:text-error-fg disabled:cursor-not-allowed disabled:opacity-50"
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
          onKeyDown={(event) => {
            // Esc renders the markdown back to preview + drops into
            // command mode (focus the shell), matching the code cell's
            // Esc → command behavior and Jupyter's render-on-Esc.
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              if (cell.source.length > 0) setEditing(false);
              shellRef.current?.focus();
            }
          }}
          onBlur={() => {
            if (cell.source.length > 0) setEditing(false);
          }}
          disabled={disabled}
          data-testid="notebook-markdown-cell-source"
          placeholder={t('notebook.cell.markdownSourcePlaceholder')}
          rows={3}
          spellCheck
          className={cn(
            'min-h-[48px] resize-none rounded border border-border/60 bg-background p-2 font-mono text-body-sm text-foreground outline-none',
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
            <p className="text-caption italic text-muted">
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
