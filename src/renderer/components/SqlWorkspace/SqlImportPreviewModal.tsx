/**
 * Import preview modal. The heart of the UX.
 *
 * Reuses `<ModalShell>` (title-header variant) so focus-trap,
 * Esc-to-close, scrim-close, focus-restore-to-trigger, `role=dialog`, and
 * `aria-labelledby` all come for free. On open, focus lands on the
 * table-name input (it is the first focusable element ModalShell sees).
 *
 * The rows go into a new table (name validated live) or an existing one.
 * Each file column maps onto a table column or is skipped; a CSV also
 * picks its header row and delimiter, which re-read the preview. The
 * footer states plainly what Import will do.
 *
 * Token-only visuals (Signal-Slate). Every string resolves through `t()`.
 */

import { useCallback, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2 } from 'lucide-react';
import { isValidTableName, type SqlImportFormat } from '../../../shared/sqlWorkspace';
import {
  IMPORT_CSV_DELIMITERS,
  mappingProblem,
  type SqlImportColumnMap,
  type SqlImportCsvOptions,
  type SqlImportDelimiter,
  type SqlImportProblem,
} from '../../../shared/sqlImportPlan';
import { cn } from '../../utils/cn';
import { ModalShell } from '../ui/ModalShell';
import type { ImportPreview } from '../../runtime/duckdbClient';
import type { SqlSchemaTable } from './sqlExplorerModel';

const FORMAT_BADGE_LABEL: Readonly<Record<SqlImportFormat, string>> = {
  csv: 'CSV',
  json: 'JSON',
  parquet: 'Parquet',
};

const DELIMITER_KEY: Readonly<Record<SqlImportDelimiter, string>> = {
  ',': 'comma',
  ';': 'semicolon',
  '\t': 'tab',
  '|': 'pipe',
};

const PROBLEM_KEY: Readonly<Record<SqlImportProblem, string>> = {
  'nothing-mapped': 'sqlWorkspace.import.mapping.nothing',
  'duplicate-target': 'sqlWorkspace.import.mapping.duplicate',
  'empty-target': 'sqlWorkspace.import.mapping.empty',
};

type SqlImportModalTarget = { mode: 'new' } | { mode: 'existing'; table: string };

export interface SqlImportPreviewModalProps {
  format: SqlImportFormat;
  preview: ImportPreview;
  tableName: string;
  existingTableNames: ReadonlyArray<string>;
  /** Tables the rows can go into; views are left out. */
  tables: ReadonlyArray<SqlSchemaTable>;
  target: SqlImportModalTarget;
  mapping: ReadonlyArray<SqlImportColumnMap>;
  csv: SqlImportCsvOptions;
  isImporting: boolean;
  /** The preview is being read again after a CSV option changed. */
  isPreviewing?: boolean;
  onTableNameChange: (name: string) => void;
  onTargetChange: (target: SqlImportModalTarget) => void;
  onMappingChange: (index: number, target: string | null) => void;
  onCsvChange: (csv: SqlImportCsvOptions) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SqlImportPreviewModal({
  format,
  preview,
  tableName,
  existingTableNames,
  tables,
  target,
  mapping,
  csv,
  isImporting,
  isPreviewing = false,
  onTableNameChange,
  onTargetChange,
  onMappingChange,
  onCsvChange,
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
  const baseTables = tables.filter((table) => table.kind !== 'view');
  const existing = target.mode === 'existing' ? baseTables.find((table) => table.name === target.table) : undefined;
  const nameValid = target.mode === 'existing' ? existing !== undefined : isValidTableName(tableName) && !nameTaken;
  const problem = mappingProblem(mapping);
  const canImport = nameValid && problem === null && !isImporting && !isPreviewing;
  const nameHint = nameTaken
    ? t('sqlWorkspace.import.nameTaken')
    : nameValid
      ? t('sqlWorkspace.import.tableNameHint')
      : t('sqlWorkspace.import.invalidName');
  const mappedCount = mapping.filter((entry) => entry.target !== null).length;
  const summary = !nameValid
    ? nameHint
    : problem !== null
      ? t(PROBLEM_KEY[problem])
      : target.mode === 'new'
        ? t('sqlWorkspace.import.footerSummary', { name: trimmedName, count: preview.rowCount })
        : t('sqlWorkspace.import.footerInto', {
            name: target.table,
            count: preview.rowCount,
            mapped: mappedCount,
            total: mapping.length,
          });
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
      // `esc` (not the `button` X) so the table-name input is the
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
              'disabled:cursor-not-allowed disabled:opacity-40'
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
              'disabled:cursor-not-allowed disabled:opacity-40'
            )}
          >
            {t('sqlWorkspace.import.cancel')}
          </button>
        </div>
      }
      trailing={
        <span
          data-testid="sql-import-modal-summary"
          className={cn('truncate text-caption', nameValid && problem === null ? 'text-fg-subtle' : 'text-error')}
        >
          {summary}
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

        {/* Target: a new table by name (first focusable) or an existing table. */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={nameInputId}
            className="text-eyebrow font-medium uppercase tracking-[0.14em] text-fg-subtle"
          >
            {target.mode === 'new' ? t('sqlWorkspace.import.tableNameLabel') : t('sqlWorkspace.import.existingTableLabel')}
          </label>
          <div className="flex min-w-0 items-center gap-2">
            {target.mode === 'new' ? (
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
                  'focus-ring min-w-0 flex-1 rounded-md border bg-bg-inset px-2.5 py-1.5 font-mono text-body-sm text-fg-base transition-colors',
                  nameValid ? 'border-border-subtle' : 'border-error/70'
                )}
              />
            ) : (
              <select
                id={nameInputId}
                data-testid="sql-import-modal-table"
                value={target.table}
                onChange={(event) => onTargetChange({ mode: 'existing', table: event.target.value })}
                className="focus-ring min-w-0 flex-1 rounded-md border border-border-subtle bg-bg-inset px-2 py-1.5 font-mono text-body-sm text-fg-base"
              >
                {baseTables.map((table) => (
                  <option key={table.name} value={table.name}>
                    {table.name}
                  </option>
                ))}
              </select>
            )}
            <div
              role="radiogroup"
              aria-label={t('sqlWorkspace.import.target.label')}
              className="flex shrink-0 rounded-[7px] border border-border-subtle bg-bg-inset p-0.5"
            >
              {(['new', 'existing'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={target.mode === mode}
                  data-testid={`sql-import-target-${mode}`}
                  disabled={mode === 'existing' && baseTables.length === 0}
                  onClick={() =>
                    onTargetChange(mode === 'new' ? { mode } : { mode, table: existing?.name ?? baseTables[0]!.name })
                  }
                  className={cn(
                    'focus-ring h-7 rounded-[5px] px-2.5 text-caption transition-colors',
                    target.mode === mode
                      ? 'bg-bg-panel text-fg-base shadow-[0_1px_2px_rgba(0,0,0,0.35)]'
                      : 'text-fg-muted hover:text-fg-base',
                    'disabled:cursor-not-allowed disabled:opacity-40'
                  )}
                >
                  {t(`sqlWorkspace.import.target.${mode}`)}
                </button>
              ))}
            </div>
          </div>
          {target.mode === 'new' ? (
            <p
              id={nameHintId}
              data-testid="sql-import-modal-name-hint"
              className={cn('text-caption', nameValid ? 'text-fg-subtle' : 'text-error')}
            >
              {nameHint}
            </p>
          ) : null}
        </div>

        {format === 'csv' ? (
          <div className="flex flex-wrap items-center gap-4 text-caption text-fg-muted" data-testid="sql-import-csv">
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                data-testid="sql-import-csv-header"
                checked={csv.header}
                disabled={isPreviewing}
                onChange={(event) => onCsvChange({ ...csv, header: event.target.checked })}
                className="focus-ring accent-accent"
              />
              {t('sqlWorkspace.import.csv.header')}
            </label>
            <label className="inline-flex items-center gap-1.5">
              {t('sqlWorkspace.import.csv.delimiter')}
              <select
                data-testid="sql-import-csv-delimiter"
                value={csv.delimiter}
                disabled={isPreviewing}
                onChange={(event) => onCsvChange({ ...csv, delimiter: event.target.value as SqlImportDelimiter })}
                className="focus-ring rounded-md border border-border-subtle bg-bg-inset px-1.5 py-0.5 text-caption text-fg-base"
              >
                {IMPORT_CSV_DELIMITERS.map((delimiter) => (
                  <option key={DELIMITER_KEY[delimiter]} value={delimiter}>
                    {t(`sqlWorkspace.import.csv.${DELIMITER_KEY[delimiter]}`)}
                  </option>
                ))}
              </select>
            </label>
            {isPreviewing ? <Loader2 size={13} aria-hidden="true" className="animate-spin text-fg-subtle" /> : null}
          </div>
        ) : null}

        {/* Column mapping: file column → table column, or skipped. */}
        <div className="flex flex-col gap-1.5">
          <span className="text-eyebrow font-medium uppercase tracking-[0.14em] text-fg-subtle">
            {t('sqlWorkspace.import.columnsLabel')}
          </span>
          <div className="max-h-[22vh] overflow-auto rounded-md border border-border-subtle" data-testid="sql-import-modal-columns">
            <table className="w-full border-collapse text-left text-caption">
              <thead className="sticky top-0 bg-bg-panel-alt">
                <tr className="text-micro uppercase tracking-[0.08em] text-fg-subtle">
                  <th scope="col" className="px-2 py-1 font-semibold">{t('sqlWorkspace.import.mapping.file')}</th>
                  <th scope="col" className="px-2 py-1 font-semibold">{t('sqlWorkspace.import.mapping.type')}</th>
                  <th scope="col" className="px-2 py-1 font-semibold">{t('sqlWorkspace.import.mapping.target')}</th>
                </tr>
              </thead>
              <tbody>
                {mapping.map((entry, index) => (
                  <tr key={`${entry.source}-${index}`} data-testid="sql-import-map-row" className="border-t border-border-subtle/60">
                    <td className="max-w-[14rem] truncate px-2 py-1 font-mono text-fg-base">{entry.source}</td>
                    <td className="whitespace-nowrap px-2 py-1 font-mono text-micro text-fg-subtle">{preview.types[index] ?? ''}</td>
                    <td className="px-2 py-1">
                      {target.mode === 'new' ? (
                        <span className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            data-testid="sql-import-map-include"
                            checked={entry.target !== null}
                            aria-label={t('sqlWorkspace.import.mapping.include', { name: entry.source })}
                            onChange={(event) => onMappingChange(index, event.target.checked ? entry.source : null)}
                            className="focus-ring accent-accent"
                          />
                          <input
                            type="text"
                            data-testid="sql-import-map-target"
                            value={entry.target ?? ''}
                            disabled={entry.target === null}
                            spellCheck={false}
                            autoComplete="off"
                            aria-label={t('sqlWorkspace.import.mapping.rename', { name: entry.source })}
                            onChange={(event) => onMappingChange(index, event.target.value)}
                            className="focus-ring min-w-0 flex-1 rounded-sm border border-border-subtle bg-bg-inset px-1.5 py-0.5 font-mono text-caption text-fg-base disabled:opacity-40"
                          />
                        </span>
                      ) : (
                        <select
                          data-testid="sql-import-map-target"
                          value={entry.target ?? ''}
                          aria-label={t('sqlWorkspace.import.mapping.into', { name: entry.source })}
                          onChange={(event) => onMappingChange(index, event.target.value === '' ? null : event.target.value)}
                          className="focus-ring w-full rounded-sm border border-border-subtle bg-bg-inset px-1.5 py-0.5 font-mono text-caption text-fg-base"
                        >
                          <option value="">{t('sqlWorkspace.import.mapping.skip')}</option>
                          {(existing?.columns ?? []).map((column) => (
                            <option key={column.name} value={column.name}>
                              {`${column.name} · ${column.type}`}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Sample rows */}
        <div className="flex flex-col gap-1.5">
          <span className="text-eyebrow font-medium uppercase tracking-[0.14em] text-fg-subtle">
            {t('sqlWorkspace.import.sampleLabel')}
          </span>
          <div className="max-h-[24vh] overflow-auto rounded-md border border-border-subtle">
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
