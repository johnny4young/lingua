import { Archive, Code2, Copy, Download, Loader2, Table2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';
import { formatNumber } from '../../i18n/formatNumber';
import { useShortcutLabel } from '../../hooks/useShortcutLabel';
import { downloadFile, downloadTextFile } from '../../utils/downloadTextFile';
import { duckDbErrorDetail } from '../../runtime/duckdbClient';
import { SqlExportError } from '../../runtime/duckdbExport';
import { exportFullResult, exportLoadedRows } from './sqlFullExport';
import { isValidTableName, type SqlColumnMetadata } from '../../../shared/sqlWorkspace';
import { ModalShell } from '../ui/ModalShell';
import { copyToClipboard } from './sqlResultActions';
import {
  CLIPBOARD_ROW_CAP,
  CSV_DELIMITERS,
  DEFAULT_EXPORT_OPTIONS,
  SQL_EXPORT_FORMATS,
  buildExportFilename,
  exportMimeType,
  isTextExportFormat,
  serializeRows,
  type SqlExportFormat,
  type SqlExportOptions,
} from './sqlResultExport';
import { useUIStore } from '../../stores/uiStore';

export interface SqlResultHandoffs {
  /** Present when the SQL that produced the result is known and is one read statement. */
  saveAsTable?: {
    suggestedName: string;
    existingNames: ReadonlyArray<string>;
    onSave: (tableName: string) => Promise<boolean>;
  };
  /** Receives the rows the dialog would export. */
  onSendToPython?: (rows: ReadonlyArray<Record<string, unknown>>) => void;
  onSaveCapsule?: () => void;
  /** Present when the result can be read again in full: the source is one read statement. */
  fullResult?: { sql: string; timeoutMs: number };
  /** The result came from a saved connection, so nothing re-runs it on Local. */
  remote?: true;
}

interface SqlExportDialogProps {
  columns: ReadonlyArray<SqlColumnMetadata>;
  /** The fetched rows, as filtered and sorted in the grid. */
  rows: ReadonlyArray<Record<string, unknown>>;
  /** Rows the query produced, which can exceed what was fetched. */
  totalRowCount: number;
  /** The total is only what DuckDB sent before the row window stopped the result. */
  totalIsLowerBound?: boolean;
  /** The query for every row, with the grid's conditions, sort and columns applied. */
  fullSql?: string;
  handoffs: SqlResultHandoffs;
  onClose: () => void;
}

const CHIP =
  'focus-ring inline-flex h-6 items-center rounded-full border px-2.5 text-caption transition-colors disabled:opacity-40';
const chipClass = (pressed: boolean) =>
  cn(
    CHIP,
    pressed
      ? 'border-accent bg-accent-tint text-accent-fg'
      : 'border-border-default text-fg-muted hover:text-fg-base'
  );
const BUTTON =
  'focus-ring inline-flex h-[26px] items-center gap-1.5 rounded-md border border-border-default bg-bg-panel px-2.5 text-body-sm font-medium text-fg-base transition-colors hover:border-border-strong hover:bg-bg-panel-alt disabled:cursor-not-allowed disabled:opacity-40';

/** Export full result…: one dialog for every format, plus the Local hand-offs. */
export function SqlExportDialog({
  columns,
  rows,
  totalRowCount,
  totalIsLowerBound = false,
  fullSql,
  handoffs,
  onClose,
}: SqlExportDialogProps) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const [format, setFormat] = useState<SqlExportFormat>('csv');
  const [options, setOptions] = useState<SqlExportOptions>(DEFAULT_EXPORT_OPTIONS);
  const [tableName, setTableName] = useState(handoffs.saveAsTable?.suggestedName ?? '');
  const [savingTable, setSavingTable] = useState(false);
  const capsuleCombo = useShortcutLabel('run-export-capsule');

  const partial = totalIsLowerBound || totalRowCount > rows.length;
  const canReadFull = fullSql !== undefined;
  const [scope, setScope] = useState<'loaded' | 'full'>(canReadFull && partial ? 'full' : 'loaded');
  // Parquet is written by DuckDB, so it always reads the query again.
  const full = canReadFull && (scope === 'full' || format === 'parquet');
  const [progress, setProgress] = useState<number | null>(null);
  const jobRef = useRef<AbortController | null>(null);
  useEffect(() => () => jobRef.current?.abort(), []);
  const exporting = progress !== null;

  const countLabel = full
    ? t(totalIsLowerBound ? 'sqlWorkspace.export.fullCountAtLeast' : 'sqlWorkspace.export.fullCount', {
        count: totalRowCount,
        formatted: formatNumber(totalRowCount, i18n.language),
      })
    : partial
      ? t(totalIsLowerBound ? 'sqlWorkspace.export.partialCountAtLeast' : 'sqlWorkspace.export.partialCount', {
          shown: formatNumber(rows.length, i18n.language),
          total: formatNumber(totalRowCount, i18n.language),
        })
      : t('sqlWorkspace.export.count', { count: rows.length });
  const formatLabel = SQL_EXPORT_FORMATS.find(entry => entry.id === format)?.label ?? format;
  const downloadBlocked = format === 'parquet' && !canReadFull ? t('sqlWorkspace.export.parquetNeedsQuery') : null;
  const copyBlocked = !isTextExportFormat(format)
    ? t('sqlWorkspace.export.fileOnly')
    : full
      ? t('sqlWorkspace.export.copyLoadedOnly')
      : rows.length > CLIPBOARD_ROW_CAP
        ? t('sqlWorkspace.export.copyTooMany', { limit: formatNumber(CLIPBOARD_ROW_CAP, i18n.language) })
        : null;

  const nameTaken =
    handoffs.saveAsTable?.existingNames.some(
      existing => existing.toLowerCase() === tableName.trim().toLowerCase()
    ) ?? false;
  const canSaveTable = isValidTableName(tableName) && !nameTaken && !savingTable;

  const finish = (data: string | Uint8Array, count: number, truncated: boolean) => {
    const filename = buildExportFilename(format);
    if (typeof data === 'string') downloadTextFile(data, filename, exportMimeType(format));
    else downloadFile(data, filename, exportMimeType(format));
    const values = { format: formatLabel, count, formatted: formatNumber(count, i18n.language) };
    useUIStore.getState().pushStatusNotice(
      truncated
        ? { tone: 'warning', messageKey: 'sqlWorkspace.export.truncated', values }
        : { tone: 'success', messageKey: 'sqlWorkspace.export.exported', values }
    );
    onClose();
  };

  const handleExport = async () => {
    if (!full || fullSql === undefined) {
      // Text is serialized only when used: the dialog can hold every fetched row.
      const data = isTextExportFormat(format)
        ? serializeRows(format, columns, rows, options)
        : await exportLoadedRows(format, columns, rows, options);
      finish(data, rows.length, false);
      return;
    }
    const controller = new AbortController();
    jobRef.current = controller;
    setProgress(0);
    try {
      const result = await exportFullResult(fullSql, format, options, {
        signal: controller.signal,
        onProgress: setProgress,
        ...(handoffs.fullResult ? { timeoutMs: handoffs.fullResult.timeoutMs } : {}),
      });
      if (!controller.signal.aborted) finish(result.data, result.rowCount, result.truncated);
    } catch (err) {
      const cancelled = controller.signal.aborted || (err instanceof SqlExportError && err.status === 'cancelled');
      const detail = cancelled ? undefined : duckDbErrorDetail(err);
      useUIStore.getState().pushStatusNotice({
        tone: cancelled ? 'info' : 'error',
        messageKey: cancelled ? 'sqlWorkspace.export.cancelled' : 'sqlWorkspace.export.failed',
        values: { format: formatLabel },
        ...(detail ? { detail } : {}),
      });
    } finally {
      if (jobRef.current === controller) {
        jobRef.current = null;
        setProgress(null);
      }
    }
  };

  const handleCopy = () => {
    if (!isTextExportFormat(format)) return;
    copyToClipboard(serializeRows(format, columns, rows, options), {
      messageKey: 'sqlWorkspace.export.copied',
      values: { format: formatLabel, count: rows.length, formatted: formatNumber(rows.length, i18n.language) },
    });
  };

  const handleSaveTable = async () => {
    if (!handoffs.saveAsTable || !canSaveTable) return;
    setSavingTable(true);
    const ok = await handoffs.saveAsTable.onSave(tableName.trim());
    setSavingTable(false);
    if (ok) onClose();
  };

  const usesHeader = format === 'csv' || format === 'tsv';
  const usesNull = format === 'csv' || format === 'tsv' || format === 'markdown';

  return (
    <ModalShell
      onClose={onClose}
      size="max-w-[560px]"
      labelledById={titleId}
      headerClose="button"
      closeLabel={t('sqlWorkspace.export.close')}
      icon={<Download size={16} aria-hidden="true" />}
      header={
        <div className="min-w-0">
          <h2 id={titleId} className="truncate text-body-lg font-semibold text-fg-base">
            {t('sqlWorkspace.export.title')}
          </h2>
        </div>
      }
      footerLegend={
        <span
          data-testid="sql-export-count"
          className="truncate font-mono text-caption text-fg-muted"
        >
          {countLabel}
        </span>
      }
    >
      <div data-testid="sql-export-dialog" className="flex flex-col gap-4 py-1">
        <div
          role="radiogroup"
          aria-label={t('sqlWorkspace.export.formatAria')}
          className="flex w-fit flex-wrap rounded-[7px] border border-border-subtle bg-bg-inset p-0.5"
        >
          {SQL_EXPORT_FORMATS.map(entry => (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={format === entry.id}
              data-testid={`sql-export-format-${entry.id}`}
              disabled={exporting}
              onClick={() => setFormat(entry.id)}
              className={cn(
                'focus-ring h-6 rounded-[5px] px-2 text-caption transition-colors disabled:opacity-40',
                format === entry.id
                  ? 'bg-bg-panel text-fg-base shadow-[0_1px_2px_rgba(0,0,0,0.35)]'
                  : 'text-fg-muted hover:text-fg-base'
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {canReadFull && partial ? (
          <div className="flex flex-col gap-1">
            <div
              role="radiogroup"
              aria-label={t('sqlWorkspace.export.scopeAria')}
              className="flex w-fit rounded-[7px] border border-border-subtle bg-bg-inset p-0.5"
            >
              {(['loaded', 'full'] as const).map(entry => (
                <button
                  key={entry}
                  type="button"
                  role="radio"
                  aria-checked={(entry === 'full') === full}
                  data-testid={`sql-export-scope-${entry}`}
                  disabled={exporting || (entry === 'loaded' && format === 'parquet')}
                  onClick={() => setScope(entry)}
                  className={cn(
                    'focus-ring h-6 rounded-[5px] px-2 text-caption transition-colors disabled:opacity-40',
                    (entry === 'full') === full
                      ? 'bg-bg-panel text-fg-base shadow-[0_1px_2px_rgba(0,0,0,0.35)]'
                      : 'text-fg-muted hover:text-fg-base'
                  )}
                >
                  {entry === 'loaded'
                    ? t('sqlWorkspace.export.scopeLoaded', { formatted: formatNumber(rows.length, i18n.language) })
                    : t('sqlWorkspace.export.scopeFull')}
                </button>
              ))}
            </div>
            {full ? (
              <p data-testid="sql-export-scope-hint" className="text-caption text-fg-subtle">
                {t('sqlWorkspace.export.scopeFullHint')}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5">
          {usesHeader ? (
            <button
              type="button"
              aria-pressed={options.header}
              data-testid="sql-export-header"
              onClick={() => setOptions(o => ({ ...o, header: !o.header }))}
              className={chipClass(options.header)}
            >
              {t('sqlWorkspace.export.headerRow')}
            </button>
          ) : null}
          {format === 'csv' ? (
            <button
              type="button"
              data-testid="sql-export-delimiter"
              aria-label={t('sqlWorkspace.export.delimiterAria', { delimiter: options.delimiter })}
              onClick={() =>
                setOptions(o => ({
                  ...o,
                  delimiter:
                    CSV_DELIMITERS[
                      (CSV_DELIMITERS.indexOf(o.delimiter) + 1) % CSV_DELIMITERS.length
                    ]!,
                }))
              }
              className={chipClass(false)}
            >
              {t('sqlWorkspace.export.delimiter', { delimiter: options.delimiter })}
            </button>
          ) : null}
          {usesNull ? (
            <button
              type="button"
              aria-pressed={options.nullAsEmpty}
              data-testid="sql-export-null-empty"
              onClick={() => setOptions(o => ({ ...o, nullAsEmpty: !o.nullAsEmpty }))}
              className={chipClass(options.nullAsEmpty)}
            >
              {t('sqlWorkspace.export.nullAsEmpty')}
            </button>
          ) : null}
          {format === 'sql-insert' ? (
            <label className="flex items-center gap-1.5 text-caption text-fg-muted">
              {t('sqlWorkspace.export.insertTable')}
              <input
                value={options.tableName}
                onChange={event => setOptions(o => ({ ...o, tableName: event.target.value }))}
                data-testid="sql-export-insert-table"
                className="h-6 w-36 rounded-md border border-border-default bg-bg-inset px-2 font-mono text-caption text-fg-base focus:border-border-strong focus:outline-none"
              />
            </label>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={exporting || downloadBlocked !== null || (!full && rows.length === 0)}
              data-testid="sql-export-download"
              className="focus-ring inline-flex h-[26px] items-center gap-1.5 rounded-md bg-accent px-3 text-body-sm font-semibold text-fg-on-accent transition-colors hover:bg-accent-hover disabled:opacity-40"
            >
              {exporting ? (
                <Loader2 size={12} aria-hidden="true" className="animate-spin" />
              ) : (
                <Download size={12} aria-hidden="true" />
              )}
              {t('sqlWorkspace.export.download')}
            </button>
            {exporting ? (
              <>
                <button
                  type="button"
                  onClick={() => jobRef.current?.abort()}
                  data-testid="sql-export-cancel"
                  className={BUTTON}
                >
                  {t('sqlWorkspace.export.cancel')}
                </button>
                <span data-testid="sql-export-progress" role="status" className="truncate font-mono text-caption text-fg-muted">
                  {progress && progress > 0
                    ? t('sqlWorkspace.export.progressRows', {
                        count: progress,
                        formatted: formatNumber(progress, i18n.language),
                      })
                    : t('sqlWorkspace.export.progress')}
                </span>
              </>
            ) : (
              <button
                type="button"
                onClick={handleCopy}
                disabled={copyBlocked !== null || rows.length === 0}
                title={copyBlocked ?? undefined}
                data-testid="sql-export-copy"
                className={BUTTON}
              >
                <Copy size={12} aria-hidden="true" />
                {t('sqlWorkspace.export.copy')}
              </button>
            )}
          </div>
          {!exporting && (downloadBlocked ?? copyBlocked) ? (
            <p data-testid="sql-export-blocked" className="text-caption text-fg-subtle">
              {downloadBlocked ?? copyBlocked}
            </p>
          ) : null}
        </div>

        <section
          aria-labelledby={`${titleId}-handoffs`}
          className="border-t border-border-subtle pt-3"
        >
          <h3
            id={`${titleId}-handoffs`}
            className="mb-1.5 font-mono text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle"
          >
            {t('sqlWorkspace.export.handoffs')}
          </h3>
          <div className="flex min-h-[30px] items-center gap-2.5 text-body-sm">
            <Table2 size={13} aria-hidden="true" className="shrink-0 text-fg-subtle" />
            <span className="font-semibold text-fg-base">
              {t('sqlWorkspace.export.saveAsTable')}
            </span>
            {handoffs.saveAsTable ? (
              <>
                <input
                  value={tableName}
                  onChange={event => setTableName(event.target.value)}
                  aria-label={t('sqlWorkspace.export.saveAsTableName')}
                  aria-invalid={!isValidTableName(tableName) || nameTaken}
                  data-testid="sql-export-save-table-name"
                  className="h-6 w-36 rounded-md border border-border-default bg-bg-inset px-2 font-mono text-caption text-fg-base focus:border-border-strong focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleSaveTable()}
                  disabled={!canSaveTable}
                  data-testid="sql-export-save-table"
                  className={BUTTON}
                >
                  {savingTable ? (
                    <Loader2 size={12} aria-hidden="true" className="animate-spin" />
                  ) : null}
                  {t('sqlWorkspace.export.create')}
                </button>
                <span className="truncate font-mono text-caption text-fg-subtle">
                  {nameTaken ? t('sqlWorkspace.import.nameTaken') : 'CREATE TABLE … AS'}
                </span>
              </>
            ) : (
              <span
                data-testid="sql-export-save-table-unavailable"
                className="text-caption text-fg-subtle"
              >
                {handoffs.remote ? t('sqlWorkspace.export.saveAsTableRemote') : t('sqlWorkspace.export.saveAsTableUnavailable')}
              </span>
            )}
          </div>
          <div className="flex min-h-[30px] items-center gap-2.5 text-body-sm">
            <Code2 size={13} aria-hidden="true" className="shrink-0 text-fg-subtle" />
            <button
              type="button"
              onClick={() => {
                handoffs.onSendToPython?.(rows);
                onClose();
              }}
              disabled={!handoffs.onSendToPython || rows.length === 0}
              data-testid="sql-export-send-python"
              className="focus-ring font-semibold text-fg-base hover:text-accent-fg disabled:opacity-40"
            >
              {t('sqlWorkspace.export.sendToPython')}
            </button>
            <span className="text-caption text-fg-subtle">
              {t('sqlWorkspace.export.sendToPythonHint')}
            </span>
          </div>
          <div className="flex min-h-[30px] items-center gap-2.5 text-body-sm">
            <Archive size={13} aria-hidden="true" className="shrink-0 text-fg-subtle" />
            <button
              type="button"
              onClick={() => {
                handoffs.onSaveCapsule?.();
                onClose();
              }}
              disabled={!handoffs.onSaveCapsule}
              data-testid="sql-export-save-capsule"
              className="focus-ring font-semibold text-fg-base hover:text-accent-fg disabled:opacity-40"
            >
              {t('sqlWorkspace.export.saveCapsule')}
            </button>
            {capsuleCombo ? (
              <span className="font-mono text-caption text-fg-subtle">{capsuleCombo}</span>
            ) : null}
          </div>
        </section>
      </div>
    </ModalShell>
  );
}
