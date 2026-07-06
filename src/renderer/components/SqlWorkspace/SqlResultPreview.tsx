/**
 * RL-097 Slice 2 — Right column: render the latest SQL response.
 *
 * FASE 3 (MOV.02/03) — Signal-Slate polish. The header converged onto
 * the shared `<ResultHeader>` (StatusBadge + mono `rows · timing` meta +
 * Table/JSON body tabs + copy actions in the trailing slot), the
 * no-result state onto the canonical `<EmptyState>` (No result yet · CTA
 * Run query), and a Save-as-snippet nudge lands beneath a first
 * successful result. All palette colors resolve through DS tokens — no
 * hex / oklch literals.
 *
 * Layout:
 *   - Header: `<ResultHeader>` — status pill + rows·timing meta +
 *     Table/JSON sub-tabs + copy (JSON / CSV / Markdown) trailing.
 *   - Body: scrollable typed-column result table OR JSON view OR error
 *     band OR too-large band, depending on `response.status` + the
 *     active body tab.
 *   - Footer: Save-as-snippet nudge on a successful run.
 *
 * Folds wired here:
 *
 *   - **D** — Copy as CSV / JSON / Markdown buttons in the header when
 *     a successful result is in view.
 *   - **E** — Result row pagination chip. When `response.tooLarge`
 *     is true and `rowCount > rows.length`, the band discloses that
 *     the table and copy actions use the truncated preview.
 *   - **C** — `SHOW TABLES` introspection chip strip rendered above
 *     the table when the panel detects the session has run
 *     `CREATE TABLE ...` statements. Chips are inert read-only signal.
 */

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bookmark,
  CheckCircle2,
  ChevronDown,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  Hash,
  Loader2,
  Search,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { downloadTextFile } from '../../utils/downloadTextFile';
import type {
  SqlColumnMetadata,
  SqlQueryStatus,
  SqlResponseV1,
} from '../../../shared/sqlWorkspace';
import { ExplainErrorButton } from '../AI/ExplainErrorButton';
import { EmptyState } from '../ui/EmptyState';
import { ResultHeader } from '../ui/ResultHeader';
import { StatusBadge, type StatusBadgeTone } from '../ui/StatusBadge';
import { rowsToCsv, rowsToMarkdownTable } from './sqlResultFormatters';
import { SqlRunHistory } from './SqlRunHistory';
import {
  filterRows,
  nextSortState,
  sortRows,
  type SqlSortState,
} from './sqlResultGrid';

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
   * Whether a query is bound to the surface (an active query exists).
   * Drives the no-result EmptyState CTA — without a query there is
   * nothing to run, so the CTA hides.
   */
  canRun?: boolean;
  /** Run the active query (no-result EmptyState CTA). */
  onRun?: () => void;
  /** Stash the active query in the snippet library (footer nudge). */
  onSaveSnippet?: () => void;
  /**
   * Per-query response LRU (newest-first) for the run-history list.
   * Defaults to the single `response` when omitted so callers that
   * don't track history still render a coherent grid.
   */
  responses?: ReadonlyArray<SqlResponseV1>;
  /**
   * Index into `responses` of the run currently shown in the grid
   * (`0` = newest). Drives the history highlight.
   */
  selectedResponseIndex?: number;
  /** Select a history entry to view (by index into `responses`). */
  onSelectResponse?: (index: number) => void;
  /**
   * T19 — the current editor text of the active query, used as the code
   * context for the AI "Explain this error" trigger. A recorded response does
   * NOT store the SQL that produced it, so a historical run being viewed can't
   * be reconstructed; the trigger is therefore only offered for the newest run
   * (`selectedResponseIndex === 0`), where this editor text is what produced
   * the error.
   */
  querySource?: string;
  /**
   * T19 apply-&-re-run: replace the active query's SQL with the AI
   * suggestion and run it. Offered only alongside `querySource` (newest
   * run), since applying over a historical view would be incoherent.
   */
  onApplyFix?: (sql: string) => void;
}

type ResultBodyTab = 'table' | 'json';

/**
 * DuckDB status → StatusBadge tone. Mirrors `<SqlStatusPill>`'s
 * classifier so the header badge and any deep-link pill stay in lockstep.
 */
function toneForStatus(status: SqlQueryStatus): StatusBadgeTone {
  if (status === 'success') return 'success';
  if (status === 'sql-error') return 'error';
  if (status === 'timeout' || status === 'too-large') return 'warning';
  return 'neutral';
}

export function SqlResultPreview({
  response,
  isExecuting,
  rowDisplayLimit,
  canRun = false,
  onRun,
  onSaveSnippet,
  responses,
  selectedResponseIndex = 0,
  onSelectResponse,
  querySource,
  onApplyFix,
}: SqlResultPreviewProps) {
  const { t } = useTranslation();
  // Table/JSON view preference. Persists across re-runs by design — the
  // user's last-picked view is the one they want for the next result,
  // so we deliberately do NOT reset it when a fresh response lands.
  const [bodyTab, setBodyTab] = useState<ResultBodyTab>('table');
  // In-memory grid controls. Sort is per-column asc/desc/off; the filter
  // box hides rows whose cells don't contain the needle. Both operate on
  // the already-fetched preview rows — they never re-run the query.
  const [sort, setSort] = useState<SqlSortState>({
    column: null,
    direction: 'asc',
  });
  const [filter, setFilter] = useState<string>('');

  const handleSort = useCallback((column: string) => {
    setSort((current) => nextSortState(current, column));
  }, []);

  // Filter + sort once, reused for the display cap and the pre-cap count
  // (was filtered twice per render).
  const filteredSortedRows = useMemo(() => {
    if (!response || response.rows.length === 0) return [];
    return sortRows(filterRows(response.rows, filter), sort);
  }, [response, filter, sort]);

  // The filtered + sorted + capped rows the table / JSON view render.
  const displayRows = useMemo(
    () => filteredSortedRows.slice(0, Math.max(1, rowDisplayLimit)),
    [filteredSortedRows, rowDisplayLimit]
  );

  // Count of preview rows surviving the filter (before the display cap)
  // so the filter chip can disclose "N of M".
  const filteredCount = filteredSortedRows.length;

  // Copy = WYSIWYG: the filtered / sorted / capped rows the user actually
  // sees in the grid, NOT the full raw result. Copying something other
  // than what is on screen is a silent surprise.
  const handleCopyJson = useCallback(() => {
    if (!response) return;
    copyToClipboard(
      JSON.stringify(displayRows, null, 2),
      copyNoticeFor(response, 'json')
    );
  }, [response, displayRows]);

  const handleCopyCsv = useCallback(() => {
    if (!response) return;
    const csv = rowsToCsv(response.columns, displayRows);
    copyToClipboard(csv, copyNoticeFor(response, 'csv'));
  }, [response, displayRows]);

  const handleCopyMarkdown = useCallback(() => {
    if (!response) return;
    const md = rowsToMarkdownTable(response.columns, displayRows);
    copyToClipboard(md, copyNoticeFor(response, 'markdown'));
  }, [response, displayRows]);

  // Export = same WYSIWYG contract as Copy (the filtered / sorted /
  // capped rows on screen), but written to a downloaded file instead of
  // the clipboard — the natural flow for a result too large to paste.
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!exportMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!exportMenuRef.current?.contains(event.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExportMenuOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [exportMenuOpen]);

  const handleExport = useCallback(
    (format: ExportFormat) => {
      setExportMenuOpen(false);
      if (!response) return;
      const content =
        format === 'json'
          ? JSON.stringify(displayRows, null, 2)
          : format === 'csv'
            ? rowsToCsv(response.columns, displayRows)
            : rowsToMarkdownTable(response.columns, displayRows);
      downloadTextFile(
        content,
        buildExportFilename(format),
        EXPORT_MIME_TYPES[format]
      );
      const notice = exportNoticeFor(response, format);
      useUIStore.getState().pushStatusNotice({
        tone: 'success',
        messageKey: notice.messageKey,
        values: notice.values,
      });
    },
    [response, displayRows]
  );

  if (response === null) {
    return (
      <div
        data-testid="sql-result-preview"
        data-state={isExecuting ? 'executing' : 'empty'}
        className="grid h-full place-items-center bg-bg-base px-6 py-10 text-center"
      >
        {isExecuting ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2
              size={18}
              aria-hidden="true"
              className="animate-spin text-fg-subtle"
            />
            <div className="text-body-sm text-fg-subtle">
              {t('sqlWorkspace.response.loading')}
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<Hash size={19} aria-hidden="true" />}
            title={t('sqlWorkspace.response.emptyTitle')}
            description={t('sqlWorkspace.response.emptyBody')}
            action={
              canRun && onRun ? (
                <button
                  type="button"
                  onClick={onRun}
                  data-testid="sql-result-preview-run"
                  className="inline-flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-body-sm font-semibold text-fg-on-accent transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
                >
                  {t('sqlWorkspace.response.emptyCta')}
                </button>
              ) : undefined
            }
          />
        )}
      </div>
    );
  }

  const tone = toneForStatus(response.status);
  // A successful (or capped-but-successful) run gets the rows·timing
  // meta, the Table/JSON sub-tabs, and the copy actions — an error /
  // timeout / engine-load failure has no result body to act on.
  const hasResultBody =
    response.status === 'success' || response.status === 'too-large';
  const meta = hasResultBody
    ? [
        t('sqlWorkspace.response.rowCount', { count: response.rowCount }),
        `${Math.max(0, Math.round(response.durationMs))} ms`,
      ].join(' · ')
    : undefined;
  const showStatementCount = response.statementCount > 1;
  const showSnippetNudge =
    response.status === 'success' && onSaveSnippet !== undefined;
  const trailing =
    hasResultBody || showStatementCount ? (
      <span className="flex items-center gap-1">
        {showStatementCount ? (
          <span
            data-testid="sql-result-preview-statement-count"
            className="mr-1 rounded-sm bg-bg-panel-alt px-1.5 py-0.5 text-eyebrow font-medium text-fg-muted"
          >
            {t('sqlWorkspace.response.statementCount', {
              count: response.statementCount,
            })}
          </span>
        ) : null}
        {hasResultBody ? (
          <>
            <CopyButton
              onClick={handleCopyJson}
              testId="sql-result-preview-copy-json"
              label={t('sqlWorkspace.action.copyAsJson')}
              icon={<FileJson size={11} aria-hidden="true" />}
            />
            <CopyButton
              onClick={handleCopyCsv}
              testId="sql-result-preview-copy-csv"
              label={t('sqlWorkspace.action.copyAsCsv')}
              icon={<FileSpreadsheet size={11} aria-hidden="true" />}
            />
            <CopyButton
              onClick={handleCopyMarkdown}
              testId="sql-result-preview-copy-markdown"
              label={t('sqlWorkspace.action.copyAsMarkdown')}
              icon={<FileText size={11} aria-hidden="true" />}
            />
            <div className="relative" ref={exportMenuRef}>
              <button
                type="button"
                onClick={() => setExportMenuOpen((open) => !open)}
                data-testid="sql-result-preview-export"
                title={t('sqlWorkspace.action.export')}
                aria-label={t('sqlWorkspace.action.export')}
                aria-haspopup="menu"
                aria-expanded={exportMenuOpen}
                className="inline-flex h-6 items-center gap-0.5 rounded-md border border-border-default bg-bg-panel-alt px-1.5 text-fg-muted transition-colors hover:border-border-strong hover:bg-bg-panel hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <Download size={11} aria-hidden="true" />
                <ChevronDown size={10} aria-hidden="true" />
              </button>
              {exportMenuOpen ? (
                <div
                  role="menu"
                  data-testid="sql-result-preview-export-menu"
                  className="absolute right-0 top-[calc(100%+0.25rem)] z-50 min-w-[9rem] overflow-hidden rounded-md border border-border-default bg-bg-panel py-1 shadow-lg"
                >
                  {EXPORT_FORMATS.map((format) => (
                    <button
                      key={format.id}
                      type="button"
                      role="menuitem"
                      onClick={() => handleExport(format.id)}
                      data-testid={`sql-result-preview-export-${format.id}`}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body-sm text-fg-muted transition-colors hover:bg-bg-panel-alt hover:text-fg-base focus-visible:bg-bg-panel-alt focus-visible:text-fg-base focus-visible:outline-none"
                    >
                      {format.id === 'csv' ? (
                        <FileSpreadsheet size={12} aria-hidden="true" />
                      ) : format.id === 'json' ? (
                        <FileJson size={12} aria-hidden="true" />
                      ) : (
                        <FileText size={12} aria-hidden="true" />
                      )}
                      {t(format.labelKey)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </span>
    ) : undefined;

  return (
    <div
      data-testid="sql-result-preview"
      data-state={response.status}
      className="flex h-full min-w-0 flex-col bg-bg-base"
    >
      <ResultHeader
        status={
          <span
            data-testid="sql-status-pill"
            data-tone={tone}
            data-status={response.status}
          >
            <StatusBadge tone={tone} dot>
              {t(`sqlWorkspace.statusPill.${response.status}`)}
            </StatusBadge>
          </span>
        }
        meta={meta}
        tabs={
          hasResultBody
            ? [
                { id: 'table', label: t('sqlWorkspace.response.tabTable') },
                { id: 'json', label: t('sqlWorkspace.response.tabJson') },
              ]
            : undefined
        }
        activeTab={bodyTab}
        onTabChange={(id) => setBodyTab(id as ResultBodyTab)}
        trailing={trailing}
      />

      {response.status === 'sql-error' ||
      response.status === 'timeout' ||
      response.status === 'engine-load-failed' ? (
        <ErrorBand
          status={response.status}
          message={response.errorMessage}
          // Only offer Explain for the newest run: the editor text can't be
          // matched to a historical response (no SQL is stored per run).
          querySource={selectedResponseIndex === 0 ? querySource : undefined}
          onApplyFix={selectedResponseIndex === 0 ? onApplyFix : undefined}
        />
      ) : null}

      {response.tooLarge ? (
        <div
          role="alert"
          data-testid="sql-result-preview-too-large"
          className="border-b border-warning-border bg-warning-bg px-3 py-2 text-caption text-warning-fg"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle
              size={12}
              className="mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <div>
              <p className="font-semibold">
                {t('sqlWorkspace.response.tooLargeBand', {
                  shown: displayRows.length,
                  total: response.rowCount,
                })}
              </p>
              <p className="mt-0.5 text-eyebrow text-warning-fg/80">
                {t('sqlWorkspace.response.tooLargeHint')}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {hasResultBody && response.rows.length > 0 ? (
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-1.5">
          <span className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border-default bg-bg-panel-alt px-2 py-1 focus-within:border-border-strong">
            <Search
              size={11}
              aria-hidden="true"
              className="shrink-0 text-fg-subtle"
            />
            <input
              type="text"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              data-testid="sql-result-preview-filter"
              placeholder={t('sqlWorkspace.grid.filterPlaceholder')}
              aria-label={t('sqlWorkspace.grid.filterAria')}
              className="min-w-0 flex-1 bg-transparent font-mono text-caption text-fg-base placeholder:text-fg-subtle focus:outline-none"
            />
            {filter.length > 0 ? (
              <button
                type="button"
                onClick={() => setFilter('')}
                aria-label={t('sqlWorkspace.grid.filterClear')}
                title={t('sqlWorkspace.grid.filterClear')}
                data-testid="sql-result-preview-filter-clear"
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <X size={10} aria-hidden="true" />
              </button>
            ) : null}
          </span>
          {filter.trim().length > 0 ? (
            <span
              data-testid="sql-result-preview-filter-count"
              className="shrink-0 font-mono text-eyebrow tabular-nums text-fg-subtle"
            >
              {t('sqlWorkspace.grid.filterMatches', {
                shown: filteredCount,
                total: response.rows.length,
              })}
            </span>
          ) : null}
        </div>
      ) : null}

      <div
        data-testid="sql-result-preview-table-container"
        className="min-h-0 flex-1 overflow-auto"
      >
        {displayRows.length > 0 ? (
          bodyTab === 'json' ? (
            <JsonView rows={displayRows} />
          ) : (
            <ResultTable
              columns={response.columns}
              rows={displayRows}
              sort={sort}
              onSort={handleSort}
            />
          )
        ) : hasResultBody && response.rows.length > 0 && filter.trim().length > 0 ? (
          <div
            data-testid="sql-result-preview-filter-empty"
            className="grid h-full place-items-center px-4 py-6 text-center text-body-sm text-fg-subtle"
          >
            {t('sqlWorkspace.grid.filterEmpty')}
          </div>
        ) : response.status === 'success' ? (
          <div className="grid h-full place-items-center px-4 py-6 text-center text-body-sm text-fg-subtle">
            {t('sqlWorkspace.response.noRows')}
          </div>
        ) : null}
      </div>

      {responses && responses.length > 1 && onSelectResponse ? (
        <SqlRunHistory
          responses={responses}
          selectedIndex={selectedResponseIndex}
          onSelect={onSelectResponse}
        />
      ) : null}

      {showSnippetNudge ? (
        <div
          data-testid="sql-result-preview-snippet-nudge"
          className="mt-auto flex items-center gap-2.5 border-t border-border-subtle bg-bg-panel-alt px-3 py-2"
        >
          <CheckCircle2
            size={13}
            aria-hidden="true"
            className="shrink-0 text-success-fg"
          />
          <span className="text-body-sm text-fg-muted">
            {t('sqlWorkspace.snippet.nudge')}
          </span>
          <button
            type="button"
            onClick={onSaveSnippet}
            data-testid="sql-result-preview-save-snippet"
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border-default bg-bg-panel px-2.5 py-1 text-caption font-medium text-fg-base transition-colors hover:border-border-strong hover:bg-bg-panel-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <Bookmark size={12} aria-hidden="true" />
            {t('sqlWorkspace.snippet.cta')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CopyButton({
  onClick,
  testId,
  label,
  icon,
}: {
  onClick: () => void;
  testId: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      title={label}
      aria-label={label}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border-default bg-bg-panel-alt text-fg-muted transition-colors hover:border-border-strong hover:bg-bg-panel hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      {icon}
    </button>
  );
}

function ErrorBand({
  status,
  message,
  querySource,
  onApplyFix,
}: {
  status: SqlResponseV1['status'];
  message: string | undefined;
  querySource?: string;
  onApplyFix?: (sql: string) => void;
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
      className="border-b border-error-border bg-error-bg px-3 py-2 text-caption text-error-fg"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          size={12}
          className="mt-0.5 shrink-0"
          aria-hidden="true"
        />
        <div>
          <p className="font-semibold">{t(bandKey)}</p>
          {message ? (
            <pre className="mt-1 max-h-[120px] overflow-auto whitespace-pre-wrap break-all rounded bg-error-bg p-2 font-mono text-eyebrow text-error-fg">
              {message}
            </pre>
          ) : null}
          {hintKey ? (
            <p className="mt-1 text-eyebrow text-error-fg/80">{t(hintKey)}</p>
          ) : null}
          {status === 'sql-error' && message && querySource ? (
            <div className="mt-2">
              <ExplainErrorButton
                errorMessage={message}
                code={querySource}
                language="sql"
                {...(onApplyFix ? { onApplyFix } : {})}
                testId="sql-explain-error"
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface ResultTableProps {
  columns: ReadonlyArray<SqlColumnMetadata>;
  rows: ReadonlyArray<Record<string, unknown>>;
  sort: SqlSortState;
  onSort: (column: string) => void;
}

function ResultTable({ columns, rows, sort, onSort }: ResultTableProps) {
  const { t } = useTranslation();
  return (
    <table
      data-testid="sql-result-preview-table"
      className="w-full min-w-max table-fixed border-collapse font-mono text-body-sm"
    >
      <thead className="sticky top-0 z-10 bg-bg-base/95 backdrop-blur">
        <tr>
          {columns.map((col) => {
            const isSorted = sort.column === col.name;
            const ariaSort = isSorted
              ? sort.direction === 'asc'
                ? 'ascending'
                : 'descending'
              : 'none';
            return (
              <th
                key={col.name}
                scope="col"
                aria-sort={ariaSort}
                className="whitespace-nowrap border-b border-border-subtle p-0 text-left"
              >
                <button
                  type="button"
                  onClick={() => onSort(col.name)}
                  data-testid="sql-result-preview-sort"
                  data-column={col.name}
                  data-sort={isSorted ? sort.direction : 'none'}
                  title={t('sqlWorkspace.grid.sortBy', { name: col.name })}
                  className="flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors hover:bg-bg-panel-alt/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
                >
                  <span className="text-eyebrow uppercase tracking-[0.08em] text-fg-muted">
                    {col.name}
                  </span>
                  <span className="text-micro tracking-[0.04em] text-accent">
                    {col.type}
                  </span>
                  {isSorted ? (
                    sort.direction === 'asc' ? (
                      <ArrowUp
                        size={10}
                        aria-hidden="true"
                        className="ml-auto shrink-0 text-fg-base"
                      />
                    ) : (
                      <ArrowDown
                        size={10}
                        aria-hidden="true"
                        className="ml-auto shrink-0 text-fg-base"
                      />
                    )
                  ) : null}
                </button>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr
            key={idx}
            data-testid="sql-result-preview-row"
            className="border-b border-border-subtle hover:bg-bg-panel-alt/60"
          >
            {columns.map((col) => (
              <td
                key={col.name}
                className={cellClass(row[col.name])}
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

/**
 * Token-only typed-column tinting — mirrors the prototype's per-type
 * color (string → syntax-string, boolean → syntax-keyword, numeric →
 * syntax-number, null → fg-subtle, fallback → fg-base).
 */
function cellClass(value: unknown): string {
  const base = 'break-all px-3 py-2 align-top';
  if (value === null || value === undefined) return `${base} text-fg-subtle`;
  if (typeof value === 'string') return `${base} text-syntax-string`;
  if (typeof value === 'boolean') return `${base} text-syntax-keyword`;
  if (typeof value === 'number' || typeof value === 'bigint')
    return `${base} text-syntax-number`;
  return `${base} text-fg-base`;
}

function JsonView({
  rows,
}: {
  rows: ReadonlyArray<Record<string, unknown>>;
}) {
  const serialized = useMemo(() => {
    try {
      return JSON.stringify(rows, jsonReplacer, 2);
    } catch {
      return String(rows);
    }
  }, [rows]);
  return (
    <pre
      data-testid="sql-result-preview-json"
      className="overflow-auto px-3 py-2 font-mono text-body-sm leading-[1.7] text-fg-base"
    >
      {serialized}
    </pre>
  );
}

/** BigInt is not JSON-serializable; coerce to a string so the view
 * never throws on integer columns DuckDB returns as BigInt. */
function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (typeof value === 'bigint') return value.toString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

type ExportFormat = 'csv' | 'json' | 'markdown';

// Module-level so the JSX literal labels never trip the renderer-copy
// guard and the menu order stays a single source of truth.
const EXPORT_FORMATS: ReadonlyArray<{ id: ExportFormat; labelKey: string }> = [
  { id: 'csv', labelKey: 'sqlWorkspace.action.exportAsCsv' },
  { id: 'json', labelKey: 'sqlWorkspace.action.exportAsJson' },
  { id: 'markdown', labelKey: 'sqlWorkspace.action.exportAsMarkdown' },
];

const EXPORT_MIME_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv;charset=utf-8',
  json: 'application/json;charset=utf-8',
  markdown: 'text/markdown;charset=utf-8',
};

const EXPORT_EXTENSIONS: Record<ExportFormat, string> = {
  csv: 'csv',
  json: 'json',
  markdown: 'md',
};

function buildExportFilename(format: ExportFormat): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `lingua-sql-${stamp}.${EXPORT_EXTENSIONS[format]}`;
}

const EXPORT_SUCCESS_KEYS: Record<ExportFormat, string> = {
  csv: 'sqlWorkspace.action.exportedCsv',
  json: 'sqlWorkspace.action.exportedJson',
  markdown: 'sqlWorkspace.action.exportedMarkdown',
};

const EXPORT_PREVIEW_SUCCESS_KEYS: Record<ExportFormat, string> = {
  csv: 'sqlWorkspace.action.exportedCsvPreview',
  json: 'sqlWorkspace.action.exportedJsonPreview',
  markdown: 'sqlWorkspace.action.exportedMarkdownPreview',
};

function exportNoticeFor(
  response: SqlResponseV1,
  format: ExportFormat
): { messageKey: string; values?: Record<string, string | number> } {
  if (response.tooLarge) {
    return {
      messageKey: EXPORT_PREVIEW_SUCCESS_KEYS[format],
      values: {
        shown: response.rows.length,
        total: response.rowCount,
      },
    };
  }
  return { messageKey: EXPORT_SUCCESS_KEYS[format] };
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
