import type { KeyboardEventHandler, RefObject } from 'react';
import { CodeXml, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  isNotebookMarkdownCell,
  type NotebookCellLanguage,
  type NotebookV1,
} from '../../../shared/notebook';
import type {
  NotebookCellRunStatus,
  NotebookCellVarFlow,
} from '../../stores/notebookStore';
import type { ListWindow } from '../../hooks/useListWindow';
import { NotebookCodeCellRow } from './NotebookCodeCellRow';
import { NotebookMarkdownCellRow } from './NotebookMarkdownCellRow';

interface NotebookCellListProps {
  readonly cellsScrollRef: RefObject<HTMLElement | null>;
  readonly handleContainerKeyDown: KeyboardEventHandler<HTMLElement>;
  readonly handleCellsScroll: () => void;
  readonly notebook: NotebookV1;
  readonly listWindow: ListWindow;
  readonly measureRef: (key: string) => (element: HTMLElement | null) => void;
  readonly cellRunStatusMap: Readonly<Record<string, NotebookCellRunStatus>> | undefined;
  readonly cellDurationMsMap: Readonly<Record<string, number>> | undefined;
  readonly cellVarFlowMap: Readonly<Record<string, NotebookCellVarFlow>> | undefined;
  readonly cellExecutionOrderMap: Readonly<Record<string, number>> | undefined;
  readonly activeCellId: string | null;
  readonly editRequest: { readonly cellId: string; readonly nonce: number } | null;
  readonly disabled: boolean;
  readonly handleActivate: (cellId: string) => void;
  readonly handleSourceChange: (cellId: string, source: string) => void;
  readonly handleRunCell: (cellId: string) => void;
  readonly handleRunAndAdvance: (cellId: string) => void;
  readonly handleRunAndInsertBelow: (cellId: string) => void;
  readonly handleMoveUp: (cellId: string) => void;
  readonly handleMoveDown: (cellId: string) => void;
  readonly handleDelete: (cellId: string) => void;
  readonly handleLanguageChange: (cellId: string, language: NotebookCellLanguage) => void;
  readonly lastCellId: string | null;
  readonly handleAddCode: (language: NotebookCellLanguage) => void;
  readonly preferredCodeLanguage: NotebookCellLanguage;
  readonly handleAddMarkdown: () => void;
}

export function NotebookCellList(props: NotebookCellListProps) {
  const { t } = useTranslation();
  const {
    cellsScrollRef, handleContainerKeyDown, handleCellsScroll, notebook,
    listWindow, measureRef, cellRunStatusMap, cellDurationMsMap, cellVarFlowMap,
    cellExecutionOrderMap, activeCellId, editRequest, disabled, handleActivate,
    handleSourceChange, handleRunCell, handleRunAndAdvance,
    handleRunAndInsertBelow, handleMoveUp, handleMoveDown, handleDelete,
    handleLanguageChange, lastCellId, handleAddCode, preferredCodeLanguage,
    handleAddMarkdown,
  } = props;
  return (
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
  );
}
