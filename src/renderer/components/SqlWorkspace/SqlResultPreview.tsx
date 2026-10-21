/**
 * Results below the SQL editor: status + Table / JSON / Profile, the SQL
 * strip naming what produced the rows, a virtualized typed grid with filter
 * chips, a cell menu and Load more, the column rail or the value viewer on
 * the right, and Export full result… in the footer.
 */

import { AlertTriangle, ArrowLeft, Bookmark, Columns3, Download, Hash, Loader2 } from 'lucide-react';
import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  buildColumnProfileQuery,
  type SqlColumnProfileOutcome,
} from '../../runtime/sqlColumnProfile';
import {
  currentShortcutDisplayPlatform,
  formatShortcutCombo,
} from '../../data/keyboardShortcuts';
import type { SqlResponseV1 } from '../../../shared/sqlWorkspace';
import { arrowTypeToDuckDb } from '../../../shared/sqlTypeNames';
import type { SqlForeignKey } from '../../runtime/sqlForeignKeys';
import { cn } from '../../utils/cn';
import { formatNumber } from '../../i18n/formatNumber';
import { EmptyState } from '../ui/EmptyState';
import { ResultHeader } from '../ui/ResultHeader';
import { StatusBadge } from '../ui/StatusBadge';
import { toneForSqlStatus } from './sqlStatusTone';
import { SqlRunHistory } from './SqlRunHistory';
import { SqlColumnProfilePanel } from './SqlColumnProfilePanel';
import { ErrorBand, JsonView } from './SqlResultPreviewParts';
import { SqlExportDialog, type SqlResultHandoffs } from './SqlExportDialog';
import { copyToClipboard } from './sqlResultActions';
import { filterRows, nextSortState, sortRows, type SqlSortState } from './sqlResultGrid';
import { applyConditions, buildGridSql, visibleColumns, type SqlColumnLayout, type SqlFilterCondition } from './sqlResultFilters';
import { SqlVirtualGrid, type SqlCellAction, type SqlGridCell } from './SqlVirtualGrid';
import { renderCell } from './sqlResultFormatters';
import { SqlResultToolbar } from './SqlResultToolbar';
import { SqlColumnRail } from './SqlColumnRail';
import { SqlValueViewer } from './SqlValueViewer';
import { DEFAULT_EXPORT_OPTIONS, serializeRows } from './sqlResultExport';

/** Where the rows on screen came from: an editor run, or a table opened from the Explorer. */
export type SqlResultSource =
  | { origin: 'editor'; sql: string }
  | { origin: 'table'; sql: string; tableName: string; backTo?: string };

/** Rows Load more read past the window, and whether the stream has more. */
interface SqlResultMore {
  rows: ReadonlyArray<Record<string, unknown>>;
  /** The open stream can give more rows. */
  canRead: boolean;
  /** The stream ended, so the loaded rows are the whole result. */
  complete?: boolean;
  loading: boolean;
}

/** Foreign keys of an Explorer table: its own key cells link, and other tables point at its rows. */
export interface SqlResultForeignKeys {
  outgoing: ReadonlyArray<SqlForeignKey>;
  incoming: ReadonlyArray<SqlForeignKey>;
  onFollow: (key: SqlForeignKey, value: unknown) => void;
  onOpenReference: (key: SqlForeignKey, value: unknown) => void;
  countReferences: (key: SqlForeignKey, value: unknown) => Promise<number | null>;
}

// Session-wide: the rail stays as the user left it across results.
let railShown = true;

export interface SqlResultPreviewProps {
  /** The response on screen; `null` before the first run. */
  response: SqlResponseV1 | null;
  isExecuting: boolean;
  /** Rows the grid renders at most (Settings › SQL). */
  rowDisplayLimit: number;
  /** An active query exists, so the empty state can offer Run. */
  canRun?: boolean;
  onRun?: () => void;
  onSaveSnippet?: () => void;
  /** Runs the source as a DuckDB column profile for the Profile tab. */
  onProfileQuery?: (query: string) => Promise<SqlColumnProfileOutcome>;
  /**
   * The exact SQL behind the newest response in this session. A profile
   * must describe the rows on screen, never a later editor draft.
   */
  profileQuerySource?: string;
  /** The query's response history, newest first. */
  responses?: ReadonlyArray<SqlResponseV1>;
  selectedResponseIndex?: number;
  onSelectResponse?: (index: number) => void;
  /** Editor text, the context for Explain this error on the newest run. */
  querySource?: string;
  onApplyFix?: (sql: string) => void;
  /** Shown in the SQL strip above the grid. */
  source?: SqlResultSource;
  onEditInEditor?: (sql: string) => void;
  /** Back to the table a foreign-key link came from. */
  onBack?: () => void;
  handoffs?: SqlResultHandoffs;
  more?: SqlResultMore;
  onLoadMore?: () => void;
  foreignKeys?: SqlResultForeignKeys;
  /** Inserts a rail predicate at the editor cursor. */
  onInsertPredicate?: (predicate: string) => void;
  /** Puts the grid's filters, sort and columns into the editor as SQL. */
  onApplySql?: (sql: string) => void;
}

type ResultBodyTab = 'table' | 'json' | 'profile';

const jsonReplacer = (_key: string, value: unknown) =>
  typeof value === 'bigint' ? value.toString() : value;

const COPY_ROW_COMBO = { tokens: ['Mod', 'c'] } as const;

export function SqlResultPreview({
  response,
  isExecuting,
  rowDisplayLimit,
  canRun = false,
  onRun,
  onSaveSnippet,
  onProfileQuery,
  profileQuerySource,
  responses,
  selectedResponseIndex = 0,
  onSelectResponse,
  querySource,
  onApplyFix,
  source,
  onEditInEditor,
  onBack,
  handoffs = {},
  more,
  onLoadMore,
  foreignKeys,
  onInsertPredicate,
  onApplySql,
}: SqlResultPreviewProps) {
  const { t, i18n } = useTranslation();
  const num = (value: number) => formatNumber(value, i18n.language);
  // The picked view survives re-runs: the user's last view is the one they want next.
  const [bodyTab, setBodyTab] = useState<ResultBodyTab>('table');
  // Sort and filter work on the fetched rows; they never re-run the query.
  const [sort, setSort] = useState<SqlSortState>({ column: null, direction: 'asc' });
  const [filter, setFilter] = useState<string>('');
  const [conditions, setConditions] = useState<SqlFilterCondition[]>([]);
  const [layout, setLayout] = useState<SqlColumnLayout>({ order: [], hidden: [] });
  const [pages, setPages] = useState({ key: '', count: 1 });
  const [selection, setSelection] = useState<{ key: string; cell: SqlGridCell } | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [showRail, setShowRail] = useState(railShown);
  const [exportOpen, setExportOpen] = useState(false);
  const profileRequestIdRef = useRef(0);
  const [profileState, setProfileState] = useState<{
    responseKey: string;
    outcome: SqlColumnProfileOutcome | null;
  } | null>(null);

  // A profile belongs to one exact response; the key keeps a late answer off a newer result.
  const responseKey = response ? `${response.recordedAt}:${selectedResponseIndex}` : null;
  const visibleProfile =
    responseKey !== null && profileState?.responseKey === responseKey ? profileState : null;

  // A selection belongs to one view of one response; a new run, filter or sort clears it.
  const selectionKey = `${responseKey}|${filter}|${JSON.stringify(conditions)}|${sort.column}:${sort.direction}`;
  const selected = selection?.key === selectionKey ? selection.cell : null;
  const setSelected = useCallback(
    (cell: SqlGridCell | null) => setSelection(cell === null ? null : { key: selectionKey, cell }),
    [selectionKey]
  );

  const handleSort = useCallback((column: string) => {
    setSort((current) => nextSortState(current, column));
  }, []);

  // Memoized: stripping literals and comments walks the whole source on every keystroke otherwise.
  const isProfileableSource = useMemo(
    () => profileQuerySource !== undefined && buildColumnProfileQuery(profileQuerySource) !== null,
    [profileQuerySource]
  );
  const canProfile =
    response !== null &&
    response.status === 'success' &&
    selectedResponseIndex === 0 &&
    onProfileQuery !== undefined &&
    isProfileableSource;

  const handleProfile = useCallback(async () => {
    if (!canProfile || profileQuerySource === undefined || !onProfileQuery || responseKey === null) {
      return;
    }
    const requestId = profileRequestIdRef.current + 1;
    profileRequestIdRef.current = requestId;
    setProfileState({ responseKey, outcome: null });
    let outcome: SqlColumnProfileOutcome;
    try {
      outcome = await onProfileQuery(profileQuerySource);
    } catch (error) {
      outcome = {
        status: 'sql-error',
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
    if (profileRequestIdRef.current === requestId) setProfileState({ responseKey, outcome });
  }, [canProfile, onProfileQuery, profileQuerySource, responseKey]);

  // Profile shows only once requested for this response; a new run falls back to the table.
  const activeTab: ResultBodyTab =
    bodyTab === 'profile' ? (canProfile && visibleProfile !== null ? 'profile' : 'table') : bodyTab;

  // The window, plus what Load more read past it.
  const loadedRows = useMemo(
    () => (!response ? [] : more && more.rows.length > 0 ? [...response.rows, ...more.rows] : response.rows),
    [response, more]
  );
  const columns = useMemo(() => (response ? response.columns : []), [response]);
  // Typing stays responsive while a large result is searched.
  const searchText = useDeferredValue(filter);
  const filteredRows = useMemo(
    () => (loadedRows.length === 0 ? [] : applyConditions(filterRows(loadedRows, searchText), conditions, columns)),
    [loadedRows, searchText, conditions, columns]
  );
  const filteredSortedRows = useMemo(() => sortRows(filteredRows, sort), [filteredRows, sort]);
  // Rows on screen grow by one page per Load more; a new response starts over.
  const pageCount = pages.key === responseKey ? pages.count : 1;
  const pageSize = Math.max(1, rowDisplayLimit);
  const displayRows = useMemo(
    () => filteredSortedRows.slice(0, pageSize * pageCount),
    [filteredSortedRows, pageSize, pageCount]
  );
  const filteredCount = filteredSortedRows.length;
  const shownColumns = useMemo(() => visibleColumns(columns, layout), [columns, layout]);
  const gridSql = useMemo(
    () => (source ? buildGridSql(source.sql, conditions, sort, columns, layout) : null),
    [source, conditions, sort, columns, layout]
  );
  const canShowMore = displayRows.length < filteredCount || (more?.canRead === true && !more.loading);
  const handleLoadMore = () => {
    setPages({ key: responseKey ?? '', count: pageCount + 1 });
    // Read from the stream once the loaded rows run out.
    if (pageSize * (pageCount + 1) > filteredCount && more?.canRead) onLoadMore?.();
  };
  const outgoingByColumn = useMemo(
    () => new Map((foreignKeys?.outgoing ?? []).map((key) => [key.column, key])),
    [foreignKeys]
  );
  const linkedColumns = useMemo(() => new Set(outgoingByColumn.keys()), [outgoingByColumn]);

  const copyRow = useCallback(
    (index: number) => {
      const row = displayRows[index];
      if (!row) return;
      copyToClipboard(JSON.stringify(row, jsonReplacer, 2), { messageKey: 'sqlWorkspace.grid.rowCopied' });
    },
    [displayRows]
  );

  const handleCellAction = (action: SqlCellAction, cell: SqlGridCell) => {
    const row = displayRows[cell.row];
    if (!row) return;
    const value = row[cell.column];
    const isNull = value === null || value === undefined;
    if (action === 'filter' || action === 'exclude') {
      const op = action === 'filter' ? (isNull ? 'is-null' : '=') : isNull ? 'not-null' : '!=';
      setConditions((current) => [...current, { id: crypto.randomUUID(), column: cell.column, op, value: isNull ? '' : renderCell(value) }]);
    } else if (action === 'copy-value') {
      copyToClipboard(renderCell(value), { messageKey: 'sqlWorkspace.grid.valueCopied' });
    } else if (action === 'copy-row') {
      copyRow(cell.row);
    } else if (action === 'copy-insert') {
      copyToClipboard(serializeRows('sql-insert', shownColumns, [row], DEFAULT_EXPORT_OPTIONS), {
        messageKey: 'sqlWorkspace.grid.insertCopied',
      });
    } else {
      setSelected(cell);
      setViewerOpen(true);
    }
  };

  if (response === null) {
    return (
      <div
        data-testid="sql-result-preview"
        data-state={isExecuting ? 'executing' : 'empty'}
        className="grid h-full place-items-center bg-bg-base px-6 py-10 text-center"
      >
        {isExecuting ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 size={18} aria-hidden="true" className="animate-spin text-fg-subtle" />
            <div className="text-body-sm text-fg-subtle">{t('sqlWorkspace.response.loading')}</div>
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

  const tone = toneForSqlStatus(response.status);
  const hasResultBody = response.status === 'success' || response.status === 'too-large';
  const knownTotal = Math.max(response.rowCount, loadedRows.length);
  const totalIsLowerBound = response.rowCountIsLowerBound === true && more?.complete !== true;
  const meta = hasResultBody
    ? [
        displayRows.length < knownTotal || totalIsLowerBound
          ? t(totalIsLowerBound ? 'sqlWorkspace.response.inViewAtLeast' : 'sqlWorkspace.response.inView', {
              shown: num(displayRows.length),
              total: num(knownTotal),
              count: knownTotal,
            })
          : t('sqlWorkspace.response.rowCount', { count: knownTotal, formatted: num(knownTotal) }),
        `${Math.max(0, Math.round(response.durationMs))} ms`,
      ].join(' · ')
    : undefined;
  const showStatementCount = response.statementCount > 1;
  const showSnippetNudge = response.status === 'success' && onSaveSnippet !== undefined;
  const tabs = hasResultBody
    ? [
        { id: 'table', label: t('sqlWorkspace.response.tabTable') },
        { id: 'json', label: t('sqlWorkspace.response.tabJson') },
        ...(canProfile ? [{ id: 'profile', label: t('sqlWorkspace.response.tabProfile') }] : []),
      ]
    : undefined;
  const showGridChrome = hasResultBody && activeTab !== 'profile';

  return (
    <div
      data-testid="sql-result-preview"
      data-state={response.status}
      // A short pane scrolls as a whole rather than letting the bands cover the grid.
      className="relative flex h-full min-w-0 flex-col overflow-y-auto bg-bg-base"
    >
      <ResultHeader
        status={
          <span data-testid="sql-status-pill" data-tone={tone} data-status={response.status}>
            <StatusBadge tone={tone} dot>
              {t(`sqlWorkspace.statusPill.${response.status}`)}
            </StatusBadge>
          </span>
        }
        meta={meta}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(id) => {
          setBodyTab(id as ResultBodyTab);
          if (id === 'profile' && visibleProfile === null) void handleProfile();
        }}
        trailing={
          <>
            {showStatementCount ? (
              <span
                data-testid="sql-result-preview-statement-count"
                className="rounded-sm bg-bg-panel-alt px-1.5 py-0.5 text-eyebrow font-medium text-fg-muted"
              >
                {t('sqlWorkspace.response.statementCount', { count: response.statementCount })}
              </span>
            ) : null}
            {showGridChrome && response.rows.length > 0 ? (
              <button
                type="button"
                aria-pressed={showRail}
                onClick={() => {
                  railShown = !showRail;
                  setShowRail(railShown);
                }}
                data-testid="sql-column-rail-toggle"
                title={t('sqlWorkspace.rail.toggle')}
                className={cn(
                  'focus-ring inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-caption transition-colors',
                  showRail ? 'bg-bg-panel-alt text-fg-base' : 'text-fg-muted hover:text-fg-base'
                )}
              >
                <Columns3 size={12} aria-hidden="true" />
                {t('sqlWorkspace.rail.label')}
              </button>
            ) : null}
          </>
        }
      />

      {source !== undefined && selectedResponseIndex === 0 ? (
        <div
          data-testid="sql-result-strip"
          data-origin={source.origin}
          className="mx-2.5 mt-2 flex h-[30px] shrink-0 items-center gap-2 rounded-[7px] border border-border-default bg-bg-panel px-2.5"
        >
          <span className="font-mono text-micro text-fg-subtle">{t('sqlWorkspace.strip.label')}</span>
          <span
            data-testid="sql-result-strip-sql"
            title={source.sql}
            className="min-w-0 flex-1 truncate font-mono text-caption text-fg-base"
          >
            {source.sql.replace(/\s+/g, ' ').trim()}
          </span>
          <span className="shrink-0 font-mono text-micro text-fg-subtle">
            {source.origin === 'table'
              ? t('sqlWorkspace.strip.fromTable', { name: source.tableName })
              : t('sqlWorkspace.strip.fromEditor')}
          </span>
          {source.origin === 'table' && source.backTo && onBack ? (
            <button
              type="button"
              onClick={onBack}
              data-testid="sql-result-strip-back"
              className="focus-ring inline-flex h-[22px] shrink-0 items-center gap-1 rounded-md border border-border-default bg-bg-panel-alt px-2 text-caption font-medium text-fg-base transition-colors hover:border-border-strong"
            >
              <ArrowLeft size={11} aria-hidden="true" />
              {t('sqlWorkspace.strip.backTo', { name: source.backTo })}
            </button>
          ) : null}
          {source.origin === 'table' && onEditInEditor ? (
            <button
              type="button"
              onClick={() => onEditInEditor(source.sql)}
              data-testid="sql-result-strip-edit"
              className="focus-ring inline-flex h-[22px] shrink-0 items-center rounded-md border border-border-default bg-bg-panel-alt px-2 text-caption font-medium text-fg-base transition-colors hover:border-border-strong"
            >
              {t('sqlWorkspace.strip.editInEditor')}
            </button>
          ) : null}
        </div>
      ) : null}

      {response.status === 'sql-error' ||
      response.status === 'timeout' ||
      response.status === 'engine-load-failed' ||
      response.status === 'connection-failed' ||
      response.status === 'blocked-target' ? (
        <ErrorBand
          status={response.status}
          message={response.errorMessage}
          // Only the newest run can be matched to the editor text.
          querySource={selectedResponseIndex === 0 ? querySource : undefined}
          onApplyFix={selectedResponseIndex === 0 ? onApplyFix : undefined}
        />
      ) : null}

      {response.status === 'cancelled' ? (
        <div
          role="status"
          data-testid="sql-result-preview-cancelled"
          className="border-b border-border-subtle bg-bg-panel-alt px-3 py-2 text-caption text-fg-muted"
        >
          {t('sqlWorkspace.response.cancelledBand')}
        </div>
      ) : null}

      {response.tooLarge && activeTab !== 'profile' ? (
        <div
          role="alert"
          data-testid="sql-result-preview-too-large"
          className="border-b border-warning-border bg-warning-bg px-3 py-2 text-caption text-warning-fg"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">
                {t(
                  response.rowCountIsLowerBound
                    ? 'sqlWorkspace.response.tooLargeBandAtLeast'
                    : 'sqlWorkspace.response.tooLargeBand',
                  { shown: num(displayRows.length), total: num(knownTotal) }
                )}
              </p>
              <p className="mt-0.5 text-eyebrow text-warning-fg/80">
                {t('sqlWorkspace.response.tooLargeHint')}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {showGridChrome && response.rows.length > 0 ? (
        <SqlResultToolbar
          columns={columns}
          search={filter}
          onSearchChange={setFilter}
          searchCount={
            filter.trim().length > 0 || conditions.length > 0
              ? t('sqlWorkspace.grid.filterMatches', { shown: num(filteredCount), total: num(loadedRows.length) })
              : null
          }
          conditions={conditions}
          onConditionsChange={setConditions}
          sort={sort}
          onSortChange={setSort}
          layout={layout}
          onLayoutChange={setLayout}
          gridSql={gridSql}
          {...(onApplySql ? { onApplySql } : {})}
        />
      ) : null}

      {activeTab === 'profile' ? (
        <div className="flex min-h-[6.5rem] flex-1 flex-col">
          <SqlColumnProfilePanel
            outcome={visibleProfile?.outcome ?? null}
            isLoading={visibleProfile === null || visibleProfile.outcome === null}
            onRetry={() => void handleProfile()}
          />
        </div>
      ) : (
        <div className="flex min-h-[9.5rem] flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {displayRows.length > 0 ? (
              activeTab === 'json' ? (
                <div className="min-h-[6.5rem] flex-1 overflow-auto">
                  <JsonView rows={displayRows} />
                </div>
              ) : (
                <SqlVirtualGrid
                  columns={shownColumns}
                  rows={displayRows}
                  sort={sort}
                  onSort={handleSort}
                  selected={selected}
                  onSelect={setSelected}
                  onCellAction={handleCellAction}
                  onCopyRow={copyRow}
                  linkedColumns={linkedColumns}
                  {...(foreignKeys
                    ? { onFollowLink: (column: string, value: unknown) => foreignKeys.onFollow(outgoingByColumn.get(column)!, value) }
                    : {})}
                />
              )
            ) : hasResultBody && loadedRows.length > 0 && filteredCount === 0 ? (
              <div
                data-testid="sql-result-preview-filter-empty"
                className="grid min-h-[6.5rem] flex-1 place-items-center px-4 py-6 text-center text-body-sm text-fg-subtle"
              >
                {t('sqlWorkspace.grid.filterEmpty')}
              </div>
            ) : response.status === 'success' ? (
              <div className="grid min-h-[6.5rem] flex-1 place-items-center px-4 py-6 text-center text-body-sm text-fg-subtle">
                {t('sqlWorkspace.response.noRows')}
              </div>
            ) : null}
          </div>
          {activeTab === 'table' && viewerOpen && selected && displayRows[selected.row] ? (
            <SqlValueViewer
              column={selected.column}
              duckType={arrowTypeToDuckDb((selected ? shownColumns.find((column) => column.name === selected.column) : undefined)?.type ?? '')}
              value={displayRows[selected.row]![selected.column]}
              row={displayRows[selected.row]!}
              {...(foreignKeys
                ? {
                    incoming: foreignKeys.incoming,
                    countReferences: foreignKeys.countReferences,
                    onOpenReference: foreignKeys.onOpenReference,
                  }
                : {})}
              onClose={() => setViewerOpen(false)}
            />
          ) : showGridChrome && showRail && displayRows.length > 0 ? (
            // Load order, not the sort: a sort changes neither the stats nor which rows a sampled rail reads.
            <SqlColumnRail columns={shownColumns} rows={filteredRows} {...(onInsertPredicate ? { onInsert: onInsertPredicate } : {})} />
          ) : null}
        </div>
      )}

      {activeTab !== 'profile' && responses && responses.length > 1 && onSelectResponse ? (
        <SqlRunHistory
          responses={responses}
          selectedIndex={selectedResponseIndex}
          onSelect={onSelectResponse}
        />
      ) : null}

      {hasResultBody && response.rows.length > 0 ? (
        <footer
          data-testid="sql-result-footer"
          className="flex h-10 shrink-0 items-center gap-2 border-t border-border-subtle px-2.5"
        >
          {canShowMore ? (
            <button
              type="button"
              onClick={handleLoadMore}
              data-testid="sql-result-load-more"
              className="focus-ring inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-md border border-border-default bg-bg-panel px-2.5 text-body-sm font-medium text-fg-base transition-colors hover:border-border-strong hover:bg-bg-panel-alt"
            >
              {t('sqlWorkspace.grid.loadMore', { count: num(pageSize) })}
            </button>
          ) : more?.loading ? (
            <span data-testid="sql-result-loading-more" className="inline-flex shrink-0 items-center gap-1.5 text-caption text-fg-muted">
              <Loader2 size={12} aria-hidden="true" className="animate-spin" />
              {t('sqlWorkspace.grid.loadingMore')}
            </span>
          ) : null}
          <kbd className="inline-flex h-[18px] items-center rounded border border-border-default px-1 font-mono text-micro text-fg-muted">
            {formatShortcutCombo(COPY_ROW_COMBO, currentShortcutDisplayPlatform())}
          </kbd>
          <span className="truncate font-mono text-caption text-fg-muted">
            {t('sqlWorkspace.grid.copyRowHint')}
          </span>
          {showSnippetNudge ? (
            <button
              type="button"
              onClick={onSaveSnippet}
              title={t('sqlWorkspace.snippet.nudge')}
              data-testid="sql-result-preview-save-snippet"
              className="focus-ring ml-auto inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-md px-2 text-body-sm text-fg-muted transition-colors hover:bg-bg-panel-alt hover:text-fg-base"
            >
              <Bookmark size={12} aria-hidden="true" />
              {t('sqlWorkspace.snippet.cta')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            data-testid="sql-result-preview-export"
            className={`focus-ring ${showSnippetNudge ? '' : 'ml-auto '}inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-md border border-border-default bg-bg-panel px-2.5 text-body-sm font-medium text-fg-base transition-colors hover:border-border-strong hover:bg-bg-panel-alt`}
          >
            <Download size={12} aria-hidden="true" />
            {t('sqlWorkspace.export.open')}
          </button>
        </footer>
      ) : null}

      {exportOpen ? (
        <SqlExportDialog
          columns={shownColumns}
          rows={filteredSortedRows}
          totalRowCount={response.rowCount}
          totalIsLowerBound={response.rowCountIsLowerBound === true}
          {...(handoffs.fullResult ? { fullSql: gridSql ?? handoffs.fullResult.sql } : {})}
          handoffs={handoffs}
          onClose={() => setExportOpen(false)}
        />
      ) : null}
    </div>
  );
}
