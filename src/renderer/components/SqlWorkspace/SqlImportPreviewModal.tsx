/**
 * RL-097 (SQL import) fold D — import preview modal. The heart of the UX.
 *
 * Reuses `<ModalShell>` (title-header variant) so focus-trap,
 * Esc-to-close, scrim-close, focus-restore-to-trigger, `role=dialog`, and
 * `aria-labelledby` all come for free. On open, focus lands on the
 * table-name input (it is the first focusable element ModalShell sees).
 *
 * Tab order: table-name input → Import (primary) → Cancel. Enter inside
 * the name input submits the import (when the name is valid); Esc cancels
 * (handled by ModalShell). The footer states plainly what Import will do.
 *
 * The content makes intent obvious at a glance:
 *
 *   - a FORMAT badge (CSV / JSON / Parquet)
 *   - an editable, labelled table-name input, validated LIVE (invalid /
 *     empty disables Import + shows an inline hint)
 *   - the detected column names as chips
 *   - a small scrollable sample table (first ~10 rows)
 *   - the total row count
 *
 * Token-only visuals (Signal-Slate). Every string resolves through `t()`.
 */

import { useCallback, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2 } from 'lucide-react';
import { isValidTableName, type SqlImportFormat } from '../../../shared/sqlWorkspace';
import { cn } from '../../utils/cn';
import { ModalShell } from '../ui/ModalShell';
import type { ImportPreview } from '../../runtime/duckdbClient';

const FORMAT_BADGE_LABEL: Readonly<Record<SqlImportFormat, string>> = {
  csv: 'CSV',
  json: 'JSON',
  parquet: 'Parquet',
};

export interface SqlImportPreviewModalProps {
  format: SqlImportFormat;
  preview: ImportPreview;
  tableName: string;
  existingTableNames: ReadonlyArray<string>;
  isImporting: boolean;
  onTableNameChange: (name: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SqlImportPreviewModal({
  format,
  preview,
  tableName,
  existingTableNames,
  isImporting,
  onTableNameChange,
  onConfirm,
  onCancel,
}: SqlImportPreviewModalProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const nameInputId = useId();
  const nameHintId = useId();

  const trimmedName = tableName.trim();
  const nameTaken = existingTableNames.some(
    (existing) => existing.toLowerCase() === trimmedName.toLowerCase()
  );
  const nameValid = isValidTableName(tableName) && !nameTaken;
  const canImport = nameValid && !isImporting;
  const nameHint = nameTaken
    ? t('sqlWorkspace.import.nameTaken')
    : nameValid
      ? t('sqlWorkspace.import.tableNameHint')
      : t('sqlWorkspace.import.invalidName');
  const handleClose = useCallback(() => {
    if (!isImporting) onCancel();
  }, [isImporting, onCancel]);

  // Enter inside the name input submits the import — the modal's primary
  // action — when the name is valid. ModalShell owns Esc → cancel.
  const handleNameKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (canImport) onConfirm();
      }
    },
    [canImport, onConfirm]
  );

  const sampleColumns = preview.columns;
  const hasRows = preview.sampleRows.length > 0;

  return (
    <ModalShell
      onClose={handleClose}
      size="max-w-[760px]"
      labelledById={titleId}
      // RL-097 UX — `esc` (not the `button` X) so the table-name input is the
      // first focusable element ModalShell focuses on open: a keyboard user
      // lands on the primary field, not on a close button. Esc keycap hint
      // stays in the header; Cancel + scrim still close for the mouse.
      headerClose="esc"
      icon={<Download size={16} aria-hidden="true" />}
      header={
        <div className="min-w-0">
          <h2
            id={titleId}
            className="truncate text-body-lg font-semibold tracking-[-0.01em] text-fg-base"
          >
            {t('sqlWorkspace.import.modalTitle')}
          </h2>
        </div>
      }
      footerLegend={
        <div
          className="flex min-w-0 items-center gap-3"
          data-testid="sql-import-modal-footer"
        >
          <button
            type="button"
            data-testid="sql-import-modal-confirm"
            onClick={onConfirm}
            disabled={!canImport}
            className={cn(
              'focus-ring inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-1.5 text-body-sm font-semibold text-fg-on-accent transition-colors',
              'hover:bg-accent-hover',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {isImporting ? (
              <Loader2 size={13} aria-hidden="true" className="animate-spin" />
            ) : (
              <Download size={13} aria-hidden="true" />
            )}
            {t('sqlWorkspace.import.confirm')}
          </button>
          <button
            type="button"
            data-testid="sql-import-modal-cancel"
            onClick={onCancel}
            disabled={isImporting}
            className={cn(
              'focus-ring inline-flex items-center rounded-md border border-border-subtle bg-bg-panel-alt px-3 py-1.5 text-body-sm font-medium text-fg-muted transition-colors',
              'hover:border-border-strong hover:text-fg-base',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {t('sqlWorkspace.import.cancel')}
          </button>
        </div>
      }
      trailing={
        <span className="truncate text-caption text-fg-subtle">
          {nameValid
            ? t('sqlWorkspace.import.footerSummary', {
                name: trimmedName,
                count: preview.rowCount,
              })
            : nameHint}
        </span>
      }
    >
      <div className="flex flex-col gap-4 px-1 py-1">
        {/* Format + row count summary */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5 text-eyebrow uppercase tracking-[0.14em] text-fg-subtle">
            {t('sqlWorkspace.import.formatLabel')}
            <span
              data-testid="sql-import-modal-format"
              className="rounded-sm bg-accent-soft px-1.5 py-0.5 font-mono text-micro font-semibold normal-case tracking-normal text-accent"
            >
              {FORMAT_BADGE_LABEL[format]}
            </span>
          </span>
          <span
            data-testid="sql-import-modal-rowcount"
            className="text-caption tabular-nums text-fg-muted"
          >
            {t('sqlWorkspace.import.rowCountLabel', { count: preview.rowCount })}
          </span>
        </div>

        {/* Editable table-name input — first focusable, validated live. */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={nameInputId}
            className="text-eyebrow font-medium uppercase tracking-[0.14em] text-fg-subtle"
          >
            {t('sqlWorkspace.import.tableNameLabel')}
          </label>
          <input
            id={nameInputId}
            type="text"
            data-testid="sql-import-modal-name"
            value={tableName}
            onChange={(event) => onTableNameChange(event.target.value)}
            onKeyDown={handleNameKeyDown}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!nameValid}
            aria-describedby={nameHintId}
            className={cn(
              'focus-ring w-full rounded-md border bg-bg-inset px-2.5 py-1.5 font-mono text-body-sm text-fg-base transition-colors',
              nameValid ? 'border-border-subtle' : 'border-error/70'
            )}
          />
          <p
            id={nameHintId}
            data-testid="sql-import-modal-name-hint"
            className={cn(
              'text-caption',
              nameValid ? 'text-fg-subtle' : 'text-error'
            )}
          >
            {nameHint}
          </p>
        </div>

        {/* Detected columns */}
        <div className="flex flex-col gap-1.5">
          <span className="text-eyebrow font-medium uppercase tracking-[0.14em] text-fg-subtle">
            {t('sqlWorkspace.import.columnsLabel')}
          </span>
          <div className="flex flex-wrap gap-1.5" data-testid="sql-import-modal-columns">
            {sampleColumns.map((column) => (
              <span
                key={column}
                className="rounded-sm bg-bg-panel-alt px-1.5 py-0.5 font-mono text-micro text-fg-muted"
              >
                {column}
              </span>
            ))}
          </div>
        </div>

        {/* Sample rows */}
        <div className="flex flex-col gap-1.5">
          <span className="text-eyebrow font-medium uppercase tracking-[0.14em] text-fg-subtle">
            {t('sqlWorkspace.import.sampleLabel')}
          </span>
          <div className="max-h-[34vh] overflow-auto rounded-md border border-border-subtle">
            <table
              data-testid="sql-import-modal-sample"
              className="w-full border-collapse text-left text-caption"
            >
              <thead className="sticky top-0 bg-bg-panel-alt">
                <tr>
                  {sampleColumns.map((column) => (
                    <th
                      key={column}
                      scope="col"
                      className="whitespace-nowrap border-b border-border-subtle px-2 py-1 font-mono text-micro font-semibold uppercase tracking-[0.08em] text-fg-subtle"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hasRows ? (
                  preview.sampleRows.map((row, rowIndex) => (
                    <tr key={`row-${rowIndex}`} className="even:bg-bg-inset/40">
                      {row.map((cell, cellIndex) => (
                        <td
                          key={`cell-${rowIndex}-${cellIndex}`}
                          className="max-w-[18rem] truncate border-b border-border-subtle/60 px-2 py-1 font-mono tabular-nums text-fg-muted"
                        >
                          {formatCell(cell)}
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={Math.max(1, sampleColumns.length)}
                      className="px-2 py-3 text-center text-fg-subtle"
                    >
                      {t('sqlWorkspace.response.noRows')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

/**
 * Render a sample cell value for the preview table. Null/undefined show an
 * em dash; objects/arrays JSON-stringify; everything else stringifies.
 * Preview-only, never persisted.
 */
function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
