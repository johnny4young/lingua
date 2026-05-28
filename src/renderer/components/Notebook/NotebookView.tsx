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
 * Slice A intentionally renders cells as plain elements (no
 * virtualization). 200-cell cap on the schema means the worst-case
 * mount cost stays bounded; Slice B+ swaps in
 * `@tanstack/react-virtual` once cell editors promote to Monaco.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CodeXml,
  FileText,
  Hammer,
  Loader2,
  Play,
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
import { useNotebookRun } from '../../hooks/useNotebookRun';
import { NotebookCodeCellRow } from './NotebookCodeCellRow';
import { NotebookMarkdownCellRow } from './NotebookMarkdownCellRow';
import {
  exportNotebookAsScript,
  pickNotebookExportLanguage,
} from './notebookExportToScript';
import { cn } from '../../utils/cn';
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
  const createNotebookForTab = useNotebookStore((s) => s.createNotebookForTab);
  const addCell = useNotebookStore((s) => s.addCell);
  const removeCell = useNotebookStore((s) => s.removeCell);
  const updateCellSource = useNotebookStore((s) => s.updateCellSource);
  const moveCell = useNotebookStore((s) => s.moveCell);
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
  const { isAnyCellRunning, runCell, runAll, runAbove, stop } = useNotebookRun();
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const activeCellId = useNotebookStore(
    (s) => s.notebooks[tabId]?.activeCellId ?? null
  );
  const setActiveCell = useNotebookStore((s) => s.setActiveCell);

  const codeCellsCount = useMemo(
    () => notebook?.cells.filter(isNotebookCodeCell).length ?? 0,
    [notebook]
  );
  const preferredCodeLanguage = useMemo<NotebookCellLanguage>(() => {
    if (backingTabLanguage) return backingTabLanguage;
    const firstCodeCell = notebook?.cells.find(isNotebookCodeCell);
    return firstCodeCell?.language ?? 'javascript';
  }, [backingTabLanguage, notebook]);
  const exportLanguage = useMemo(
    () => (notebook ? pickNotebookExportLanguage(notebook) : null),
    [notebook]
  );

  useEffect(() => {
    if (notebook || backingTabName === null) return;
    createNotebookForTab(tabId, notebookTitleFromTabName(backingTabName));
  }, [backingTabName, createNotebookForTab, notebook, tabId]);

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

  const handleMove = useCallback(
    (cellId: string, direction: 'up' | 'down') => {
      if (!notebook) return;
      const idx = notebook.cells.findIndex((c) => c.id === cellId);
      if (idx === -1) return;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= notebook.cells.length) return;
      moveCell(tabId, idx, targetIdx);
    },
    [moveCell, notebook, tabId]
  );

  const handleDelete = useCallback(
    (cellId: string) => {
      removeCell(tabId, cellId);
    },
    [removeCell, tabId]
  );

  // Jupyter-parity run keybinds. Focus is moved imperatively after
  // the next paint (the target cell may have just been created), so
  // we avoid a setState-in-effect cascade — the focus is a DOM side
  // effect, not React state.
  const focusCellSoon = useCallback((cellId: string) => {
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLTextAreaElement>(
        `[data-cell-id="${cellId}"] [data-testid="notebook-code-cell-source"]`
      );
      el?.focus();
    });
  }, []);

  const handleRunAndAdvance = useCallback(
    (cellId: string) => {
      void runCell(tabId, cellId);
      if (!notebook) return;
      const idx = notebook.cells.findIndex((c) => c.id === cellId);
      if (idx === -1) return;
      const nextCodeCell = notebook.cells
        .slice(idx + 1)
        .find(isNotebookCodeCell);
      if (nextCodeCell) {
        focusCellSoon(nextCodeCell.id);
        return;
      }
      // Last cell — create a fresh code cell below to keep the flow
      // going, mirroring Jupyter's Shift+Enter at the bottom.
      if (notebook.cells.length >= MAX_CELLS_PER_NOTEBOOK) {
        pushStatusNotice({
          tone: 'warning',
          messageKey: 'notebook.notice.tooManyCells',
        });
        return;
      }
      const currentCell = notebook.cells[idx];
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
      notebook,
      preferredCodeLanguage,
      pushStatusNotice,
      runCell,
      tabId,
    ]
  );

  const handleRunAndInsertBelow = useCallback(
    (cellId: string) => {
      void runCell(tabId, cellId);
      if (!notebook) return;
      if (notebook.cells.length >= MAX_CELLS_PER_NOTEBOOK) {
        pushStatusNotice({
          tone: 'warning',
          messageKey: 'notebook.notice.tooManyCells',
        });
        return;
      }
      const currentCell = notebook.cells.find((cell) => cell.id === cellId);
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
      notebook,
      preferredCodeLanguage,
      pushStatusNotice,
      runCell,
      tabId,
    ]
  );

  const handleExport = useCallback(() => {
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
      const blob = new Blob([result.source], {
        type: 'text/plain;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.suggestedFileName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      // Defer revoke so the click has time to start the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
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

  if (!notebook) {
    return (
      <div
        data-testid="notebook-view-empty"
        className="grid h-full place-items-center p-6 text-center text-xs text-muted"
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
            className="min-w-0 flex-1 truncate rounded border border-transparent bg-transparent px-2 py-1 font-display text-sm font-semibold tracking-tight text-foreground hover:border-border/40 focus:border-border-strong focus:bg-bg-elevated focus:outline-none"
          />
          <span className="hidden text-[10px] uppercase tracking-wider text-muted sm:inline">
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
            className="inline-flex h-7 items-center gap-1 rounded border border-border/60 bg-surface/40 px-2 text-[11px] text-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileText size={11} aria-hidden="true" />
            {t('notebook.toolbar.addMarkdown')}
          </button>
          <button
            type="button"
            onClick={() => handleAddCode(preferredCodeLanguage)}
            disabled={disabled}
            data-testid="notebook-toolbar-add-code"
            className="inline-flex h-7 items-center gap-1 rounded border border-border/60 bg-surface/40 px-2 text-[11px] text-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
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
            className="inline-flex h-7 items-center gap-1 rounded border border-border/60 bg-surface/40 px-2 text-[11px] text-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Hammer size={11} aria-hidden="true" />
            {t('notebook.toolbar.runAbove')}
          </button>
          <button
            type="button"
            onClick={() => runAll(tabId)}
            disabled={disabled || lastCodeCellId === null}
            data-testid="notebook-toolbar-run-all"
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded border px-2 text-[11px] font-medium',
              disabled
                ? 'border-border/40 bg-surface/40 text-muted'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:border-emerald-500 dark:text-emerald-300',
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
            className="inline-flex h-7 items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 text-[11px] font-medium text-amber-700 hover:border-amber-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-300"
          >
            <Square size={11} aria-hidden="true" />
            {t('notebook.toolbar.stop')}
          </button>
          <span className="mx-1 h-4 w-px bg-border/60" aria-hidden="true" />
          <button
            type="button"
            onClick={handleExport}
            disabled={disabled || codeCellsCount === 0}
            data-testid="notebook-toolbar-export"
            className="inline-flex h-7 items-center gap-1 rounded border border-border/60 bg-surface/40 px-2 text-[11px] text-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles size={11} aria-hidden="true" />
            {t('notebook.toolbar.exportScript', {
              language: exportLanguageLabel,
            })}
          </button>
        </div>
      </header>

      <section
        data-testid="notebook-cells"
        className="min-h-0 overflow-y-auto px-4 py-3"
      >
        {notebook.cells.length === 0 ? (
          <div
            data-testid="notebook-cells-empty"
            className="grid place-items-center rounded border border-dashed border-border/60 p-8 text-center text-xs text-muted"
          >
            <div className="grid gap-2">
              <p>{t('notebook.empty.title')}</p>
              <p className="text-[11px]">{t('notebook.empty.cta')}</p>
            </div>
          </div>
        ) : (
          <ul role="list" className="grid gap-3">
            {notebook.cells.map((cell, idx) => {
              const status: NotebookCellRunStatus =
                cellRunStatusMap?.[cell.id] ?? 'idle';
              const canMoveUp = idx > 0;
              const canMoveDown = idx < notebook.cells.length - 1;
              if (isNotebookMarkdownCell(cell)) {
                return (
                  <li
                    key={cell.id}
                    onFocusCapture={() => setActiveCell(tabId, cell.id)}
                    onMouseDown={() => setActiveCell(tabId, cell.id)}
                    className={cn(
                      activeCellId === cell.id &&
                        'rounded-md ring-1 ring-primary/25'
                    )}
                  >
                    <NotebookMarkdownCellRow
                      cell={cell}
                      cellIndex={idx}
                      canMoveUp={canMoveUp}
                      canMoveDown={canMoveDown}
                      disabled={disabled}
                      onSourceChange={(cellId, source) =>
                        updateCellSource(tabId, cellId, source)
                      }
                      onMoveUp={(cellId) => handleMove(cellId, 'up')}
                      onMoveDown={(cellId) => handleMove(cellId, 'down')}
                      onDelete={handleDelete}
                    />
                  </li>
                );
              }
              return (
                <li
                  key={cell.id}
                  onFocusCapture={() => setActiveCell(tabId, cell.id)}
                  onMouseDown={() => setActiveCell(tabId, cell.id)}
                  className={cn(
                    activeCellId === cell.id &&
                      'rounded-md ring-1 ring-primary/25'
                  )}
                >
                  <NotebookCodeCellRow
                    cell={cell}
                    cellIndex={idx}
                    status={status}
                    canMoveUp={canMoveUp}
                    canMoveDown={canMoveDown}
                    disabled={disabled}
                    onSourceChange={(cellId, source) =>
                      updateCellSource(tabId, cellId, source)
                    }
                    onRunCell={(cellId) => void runCell(tabId, cellId)}
                    onRunAndAdvance={handleRunAndAdvance}
                    onRunAndInsertBelow={handleRunAndInsertBelow}
                    onMoveUp={(cellId) => handleMove(cellId, 'up')}
                    onMoveDown={(cellId) => handleMove(cellId, 'down')}
                    onDelete={handleDelete}
                  />
                </li>
              );
            })}
          </ul>
        )}
        {lastCellId !== null ? (
          <div className="mt-3 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => handleAddCode(preferredCodeLanguage)}
              disabled={disabled}
              data-testid="notebook-cells-append-code"
              className="inline-flex h-7 items-center gap-1 rounded border border-dashed border-border/40 bg-transparent px-3 text-[11px] text-muted hover:border-border-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CodeXml size={11} aria-hidden="true" />
              {t('notebook.toolbar.addCode')}
            </button>
            <button
              type="button"
              onClick={handleAddMarkdown}
              disabled={disabled}
              data-testid="notebook-cells-append-markdown"
              className="inline-flex h-7 items-center gap-1 rounded border border-dashed border-border/40 bg-transparent px-3 text-[11px] text-muted hover:border-border-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
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
