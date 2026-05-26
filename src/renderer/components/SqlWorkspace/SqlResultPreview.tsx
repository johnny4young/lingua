/**
 * RL-097 Slice 2 — Right column: render the latest SQL response.
 *
 * Layout:
 *   - Header: status pill + duration + row count + export buttons.
 *   - Body: scrollable result table OR error band OR too-large band
 *     OR engine-load-failed band, depending on `response.status`.
 *
 * Folds wired here:
 *
 *   - **D** — Copy as CSV / JSON / Markdown buttons in the header
 *     when a successful result is in view.
 *   - **E** — Result row pagination chip. When `response.tooLarge`
 *     is true and `rowCount > rows.length`, the band discloses that
 *     the table and copy actions use the truncated preview. A future
 *     slice can add an inline "Load next 10k" affordance; Slice 2
 *     stays static because DuckDB-WASM has no worker-bridge streaming
 *     cursor API today.
 *   - **C** — `SHOW TABLES` introspection chip strip rendered above
 *     the table when the panel detects the session has run
 *     `CREATE TABLE ...` statements. Chips are inert — clicking one
 *     in Slice 3+ would auto-fill `SELECT * FROM <name>` into the
 *     editor. For Slice 2 the chips are pure read-only signal.
 */

import {
  AlertTriangle,
  FileJson,
  FileSpreadsheet,
  FileText,
  Loader2,
  Table as TableIcon,
} from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import type {
  SqlColumnMetadata,
  SqlResponseV1,
} from '../../../shared/sqlWorkspace';
import { SqlStatusPill } from './SqlStatusPill';
import { rowsToCsv, rowsToMarkdownTable } from './sqlResultFormatters';

export interface SqlResultPreviewProps {
  /**
   * Most-recent response for the active query. `null` is the
   * empty-state (the user has not run anything yet for this query).
   */
  response: SqlResponseV1 | null;
  isExecuting: boolean;
  /**
   * Cap rendered rows in the table to this many. Defaults to all
   * available preview rows in the response. Settings exposes a
   * `sqlWorkspaceRowDisplayLimit` toggle that the parent threads in
   * here.
   */
  rowDisplayLimit: number;
  /**
   * Session-scoped list of CREATE TABLE table names (Fold C). The
   * parent maintains this via a SHOW TABLES probe after each
   * successful run; passes `[]` if none known.
   */
  knownTableNames: ReadonlyArray<string>;
  /**
   * Fold C — fire `SHOW TABLES` against the active connection. The
   * parent decides what to do with the result (typically: stuff the
   * table names into `knownTableNames`).
   */
  onShowTables: () => void;
}

export function SqlResultPreview({
  response,
  isExecuting,
  rowDisplayLimit,
  knownTableNames,
  onShowTables,
}: SqlResultPreviewProps) {
  const { t } = useTranslation();

  const displayRows = useMemo(() => {
    if (!response || response.rows.length === 0) return [];
    return response.rows.slice(0, Math.max(1, rowDisplayLimit));
  }, [response, rowDisplayLimit]);

  const handleCopyJson = useCallback(() => {
    if (!response) return;
    copyToClipboard(
      JSON.stringify(response.rows, null, 2),
      copyNoticeFor(response, 'json')
    );
  }, [response]);

  const handleCopyCsv = useCallback(() => {
    if (!response) return;
    const csv = rowsToCsv(response.columns, response.rows);
    copyToClipboard(csv, copyNoticeFor(response, 'csv'));
  }, [response]);

  const handleCopyMarkdown = useCallback(() => {
    if (!response) return;
    const md = rowsToMarkdownTable(response.columns, response.rows);
    copyToClipboard(md, copyNoticeFor(response, 'markdown'));
  }, [response]);

  if (response === null) {
    return (
      <div
        data-testid="sql-result-preview"
        data-state={isExecuting ? 'executing' : 'empty'}
        className="flex h-full flex-col items-center justify-center gap-2 px-4 py-6 text-center"
      >
        {isExecuting ? (
          <>
            <Loader2
              size={18}
              aria-hidden="true"
              className="animate-spin text-muted"
            />
            <div className="text-xs text-muted">
              {t('sqlWorkspace.response.loading')}
            </div>
          </>
        ) : (
          <div className="text-xs text-muted">
            {t('sqlWorkspace.response.emptyResult')}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="sql-result-preview"
      data-state={response.status}
      className="flex h-full min-w-0 flex-col"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border/40 px-3 py-2">
        <SqlStatusPill
          status={response.status}
          rowCount={response.rowCount}
          durationMs={response.durationMs}
        />
        {response.statementCount > 1 ? (
          <span
            data-testid="sql-result-preview-statement-count"
            className="rounded bg-surface-strong/60 px-1.5 py-0.5 text-[10px] font-medium text-muted"
          >
            {t('sqlWorkspace.response.statementCount', {
              count: response.statementCount,
            })}
          </span>
        ) : null}
        {response.status === 'success' || response.status === 'too-large' ? (
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={handleCopyJson}
              data-testid="sql-result-preview-copy-json"
              title={t('sqlWorkspace.action.copyAsJson')}
              aria-label={t('sqlWorkspace.action.copyAsJson')}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-surface/40 text-muted hover:border-border-strong hover:bg-background hover:text-foreground"
            >
              <FileJson size={11} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={handleCopyCsv}
              data-testid="sql-result-preview-copy-csv"
              title={t('sqlWorkspace.action.copyAsCsv')}
              aria-label={t('sqlWorkspace.action.copyAsCsv')}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-surface/40 text-muted hover:border-border-strong hover:bg-background hover:text-foreground"
            >
              <FileSpreadsheet size={11} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={handleCopyMarkdown}
              data-testid="sql-result-preview-copy-markdown"
              title={t('sqlWorkspace.action.copyAsMarkdown')}
              aria-label={t('sqlWorkspace.action.copyAsMarkdown')}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-surface/40 text-muted hover:border-border-strong hover:bg-background hover:text-foreground"
            >
              <FileText size={11} aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </header>

      {/* Fold C — schema introspection chip strip. Renders SHOW TABLES
          button + the discovered table names as inert chips. */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/30 px-3 py-1.5 text-[10px]">
        <button
          type="button"
          onClick={onShowTables}
          data-testid="sql-result-preview-show-tables"
          className="inline-flex h-5 items-center gap-1 rounded-md border border-border/60 bg-surface/40 px-1.5 text-[10px] font-medium text-muted hover:border-border-strong hover:bg-background hover:text-foreground"
        >
          {/* Reviewer pass — swapped `ClipboardCopy` (reads as copy-to-clipboard,
              semantic mismatch) for the `Table` lucide glyph so the chip strip's
              left affordance reads as "list tables", not "copy". */}
          <TableIcon size={9} aria-hidden="true" />
          <span>{t('sqlWorkspace.action.showTables')}</span>
        </button>
        {knownTableNames.length === 0 ? (
          <span className="text-muted/70">
            {t('sqlWorkspace.response.tablesEmpty')}
          </span>
        ) : (
          knownTableNames.map((name) => (
            <span
              key={name}
              data-testid="sql-result-preview-table-chip"
              className="inline-flex items-center rounded-full bg-sky-500/15 px-2 py-0.5 font-mono text-[10px] text-sky-700 dark:text-sky-300 ring-1 ring-sky-500/30"
            >
              {name}
            </span>
          ))
        )}
      </div>

      {response.status === 'sql-error' ||
      response.status === 'timeout' ||
      response.status === 'engine-load-failed' ? (
        <ErrorBand status={response.status} message={response.errorMessage} />
      ) : null}

      {response.tooLarge ? (
        <div
          role="alert"
          data-testid="sql-result-preview-too-large"
          className="border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">
                {t('sqlWorkspace.response.tooLargeBand', {
                  shown: displayRows.length,
                  total: response.rowCount,
                })}
              </p>
              <p className="mt-0.5 text-[10px] text-amber-100/80">
                {t('sqlWorkspace.response.tooLargeHint')}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div
        data-testid="sql-result-preview-table-container"
        className="min-h-0 flex-1 overflow-auto"
      >
        {displayRows.length > 0 ? (
          <ResultTable columns={response.columns} rows={displayRows} />
        ) : response.status === 'success' ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-4 py-6 text-center text-xs text-muted">
            {t('sqlWorkspace.response.noRows')}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ErrorBand({
  status,
  message,
}: {
  status: SqlResponseV1['status'];
  message: string | undefined;
}) {
  const { t } = useTranslation();
  const bandKey =
    status === 'timeout'
      ? 'sqlWorkspace.response.timeoutBand'
      : status === 'engine-load-failed'
        ? 'sqlWorkspace.response.engineLoadFailedBand'
        : 'sqlWorkspace.response.errorBand';
  const hintKey =
    status === 'engine-load-failed'
      ? 'sqlWorkspace.response.engineLoadFailedHint'
      : null;
  return (
    <div
      role="alert"
      data-testid={`sql-result-preview-error-${status}`}
      className="border-b border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">{t(bandKey)}</p>
          {message ? (
            <pre className="mt-1 max-h-[120px] overflow-auto whitespace-pre-wrap break-all rounded bg-rose-500/15 p-2 font-mono text-[10px] text-rose-100">
              {message}
            </pre>
          ) : null}
          {hintKey ? (
            <p className="mt-1 text-[10px] text-rose-100/80">{t(hintKey)}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface ResultTableProps {
  columns: ReadonlyArray<SqlColumnMetadata>;
  rows: ReadonlyArray<Record<string, unknown>>;
}

function ResultTable({ columns, rows }: ResultTableProps) {
  return (
    <table
      data-testid="sql-result-preview-table"
      className="w-full min-w-max table-fixed border-collapse font-mono text-[11px]"
    >
      <thead className="sticky top-0 z-10 bg-surface/95 backdrop-blur">
        <tr>
          {columns.map((col) => (
            <th
              key={col.name}
              scope="col"
              className="border-b border-border/40 px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-wider text-muted"
            >
              <span className="text-foreground">{col.name}</span>
              <span className="ml-1 text-fg-subtle">{col.type}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr
            key={idx}
            data-testid="sql-result-preview-row"
            className="border-b border-border/20 hover:bg-surface-strong/40"
          >
            {columns.map((col) => (
              <td
                key={col.name}
                className="break-all px-2 py-1 align-top text-foreground"
              >
                {renderCell(row[col.name])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return value.toString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

type CopyFormat = 'csv' | 'json' | 'markdown';

const COPY_SUCCESS_KEYS: Record<CopyFormat, string> = {
  csv: 'sqlWorkspace.action.copiedCsv',
  json: 'sqlWorkspace.action.copiedJson',
  markdown: 'sqlWorkspace.action.copiedMarkdown',
};

const COPY_PREVIEW_SUCCESS_KEYS: Record<CopyFormat, string> = {
  csv: 'sqlWorkspace.action.copiedCsvPreview',
  json: 'sqlWorkspace.action.copiedJsonPreview',
  markdown: 'sqlWorkspace.action.copiedMarkdownPreview',
};

function copyNoticeFor(
  response: SqlResponseV1,
  format: CopyFormat
): { messageKey: string; values?: Record<string, string | number> } {
  if (response.tooLarge) {
    return {
      messageKey: COPY_PREVIEW_SUCCESS_KEYS[format],
      values: {
        shown: response.rows.length,
        total: response.rowCount,
      },
    };
  }
  return {
    messageKey: COPY_SUCCESS_KEYS[format],
  };
}

function copyToClipboard(
  text: string,
  successNotice: { messageKey: string; values?: Record<string, string | number> }
): void {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    useUIStore.getState().pushStatusNotice({
      tone: 'warning',
      messageKey: 'sqlWorkspace.action.clipboardUnavailable',
    });
    return;
  }
  void navigator.clipboard
    .writeText(text)
    .then(() => {
      useUIStore.getState().pushStatusNotice({
        tone: 'success',
        messageKey: successNotice.messageKey,
        values: successNotice.values,
      });
    })
    .catch(() => {
      useUIStore.getState().pushStatusNotice({
        tone: 'warning',
        messageKey: 'sqlWorkspace.action.clipboardUnavailable',
      });
    });
}
