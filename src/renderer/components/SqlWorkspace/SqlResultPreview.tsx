/**
 * Results below the SQL editor: the header with the run picker and Table /
 * JSON / Profile, the SQL strip naming an opened table's query, a virtualized
 * typed grid with filter chips and a cell menu, the column rail or the value
 * viewer on the right, and Load more and Save as snippet in the footer.
 */

import { AlertTriangle, ArrowLeft, Bookmark, Hash, Loader2 } from 'lucide-react';
import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  buildColumnProfileQuery,
  type SqlColumnProfileOutcome,
} from '../../runtime/sqlColumnProfile';
import type { SqlResponseV1 } from '../../../shared/sqlWorkspace';
import { arrowTypeToDuckDb } from '../../../shared/sqlTypeNames';
import type { SqlForeignKey } from '../../runtime/sqlForeignKeys';
import { cn } from '../../utils/cn';
import { formatNumber } from '../../i18n/formatNumber';
import { EmptyState } from '../ui/EmptyState';
import { SqlColumnProfilePanel } from './SqlColumnProfilePanel';
import { ErrorBand, JsonView } from './SqlResultPreviewParts';
import { SqlExportDialog, type SqlResultHandoffs } from './SqlExportDialog';
import { copyToClipboard } from './sqlResultActions';
import { filterRows, nextSortState, sortRows, type SqlSortState } from './sqlResultGrid';
import { applyConditions, buildGridSql, visibleColumns, type SqlColumnLayout, type SqlFilterCondition } from './sqlResultFilters';
import { SqlVirtualGrid, type SqlCellAction, type SqlGridCell, type SqlGridEditing } from './SqlVirtualGrid';
import { SqlRowEditBar } from './SqlRowEditBar';
import { addRow, canEditCell, canSetCellNull, overlayRows, stageCell, stagedCount, toggleDelete } from './sqlRowEditModel';
import type { SqlRowEdits } from '../../hooks/useSqlRowEdits';
import { renderCell } from './sqlResultFormatters';
import { SqlResultToolbar } from './SqlResultToolbar';
import { SqlColumnRail } from './SqlColumnRail';
import { columnStats, statsRowLimit } from './sqlColumnStats';
import { resultInstruments } from './sqlColumnInstruments';
import { SqlResultHeader } from './SqlResultHeader';
import { SqlValueViewer } from './SqlValueViewer';
import { DEFAULT_EXPORT_OPTIONS, serializeRows } from './sqlResultExport';
import { useSqlResultPaneLayout } from './useSqlResultPaneLayout';

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

// Session-wide: the rail and the filter bar stay as the user left them across results.
// The rail opens on request; the column heads already carry each column's distribution.
let railShown = false;
let filterShown = false;

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
  /** The name a snippet of the grid's SQL takes. */
  snippetLabel?: string;
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
  /** Staged edits on an Explorer table, when Edit table rows is on. */
  rowEdits?: SqlRowEdits;
  /** Which statement of a multi-statement run is on screen (1-based). */
  statementPosition?: { index: number; total: number };
}

type ResultBodyTab = 'table' | 'json' | 'profile';

const jsonReplacer = (_key: string, value: unknown) =>
  typeof value === 'bigint' ? value.toString() : value;

export function SqlResultPreview({
  response,
  isExecuting,
  rowDisplayLimit,
  canRun = false,
  onRun,
  onSaveSnippet,
  snippetLabel,
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
  rowEdits,
  statementPosition,
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
  const [filterOpen, setFilterOpen] = useState(filterShown);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
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

  // Narrowing from the grid opens the filter bar, so its chips stay in sight.
  const showFilterBar = useCallback(() => {
    filterShown = true;
    setFilterOpen(true);
  }, []);

  const handleSort = useCallback((column: string) => {
    showFilterBar();
    setSort((current) => nextSortState(current, column));
  }, [showFilterBar]);

  // Memoized: stripping literals and comments walks the whole source on every keystroke otherwise.
  const isProfileableSource = useMemo(
    () => profileQuerySource !== undefined && buildColumnProfileQuery(profileQuerySource) !== null,
    [profileQuerySource]
  );
  // The profile re-runs the source on Local DuckDB, so a saved connection's result has none.
  const canProfile =
    response !== null &&
    response.status === 'success' &&
    response.engine === undefined &&
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

  // The window, plus what Load more read past it. Keyed on the rows, not on more: its loading
  // flag and a parent render must not copy and profile the whole result again.
  const moreRows = more?.rows;
  const loadedRows = useMemo(
    () => (!response ? [] : moreRows && moreRows.length > 0 ? [...response.rows, ...moreRows] : response.rows),
    [response, moreRows]
  );
  const columns = useMemo(() => (response ? response.columns : []), [response]);
  const editTarget = rowEdits?.target ?? null;
  const stagedEdits = rowEdits?.edits;
  // Staged changes sit on top of the rows read; new rows come last.
  const shownRows = useMemo(
    () => (editTarget && stagedEdits ? overlayRows(loadedRows, editTarget, stagedEdits) : loadedRows),
    [loadedRows, editTarget, stagedEdits]
  );
  // Typing stays responsive while a large result is searched.
  const searchText = useDeferredValue(filter);
  const filteredRows = useMemo(
    () => (shownRows.length === 0 ? [] : applyConditions(filterRows(shownRows, searchText), conditions, columns)),
    [shownRows, searchText, conditions, columns]
  );
  // The rail describes the rows as read, not the staged changes.
  const railRows = useMemo(
    () => (shownRows === loadedRows ? filteredRows : applyConditions(filterRows(loadedRows, searchText), conditions, columns)),
    [shownRows, loadedRows, filteredRows, searchText, conditions, columns]
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
  const engine = response?.engine;
  const gridSql = useMemo(
    () => (source ? buildGridSql(source.sql, conditions, sort, columns, layout, engine) : null),
    [source, conditions, sort, columns, layout, engine]
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

  const gridEditing = useMemo<SqlGridEditing | undefined>(
    () =>
      editTarget && rowEdits
        ? {
            canEdit: (row, column) => canEditCell(editTarget, row, column),
            canSetNull: (row, column) => canSetCellNull(editTarget, row, column),
            onEditCell: (row, column, value) => rowEdits.update((current) => stageCell(current, editTarget, row, column, value)),
          }
        : undefined,
    [editTarget, rowEdits]
  );

  const handleCellAction = (action: SqlCellAction, cell: SqlGridCell) => {
    const row = displayRows[cell.row];
    if (!row) return;
    if (editTarget && rowEdits && (action === 'set-null' || action === 'delete-row' || action === 'duplicate-row')) {
      rowEdits.update((current) =>
        action === 'set-null'
          ? stageCell(current, editTarget, row, cell.column, null)
          : action === 'delete-row'
            ? toggleDelete(current, editTarget, row)
            : addRow(current, editTarget, row)
      );
      return;
    }
    const value = row[cell.column];
    const isNull = value === null || value === undefined;
    if (action === 'filter' || action === 'exclude') {
      const op = action === 'filter' ? (isNull ? 'is-null' : '=') : isNull ? 'not-null' : '!=';
      showFilterBar();
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

  // One pass feeds whichever shows the distribution: the rail when open, the column heads otherwise.
  const hasRows = displayRows.length > 0;
  const railOpen = showRail && hasRows && activeTab !== 'profile';
  const tableShown = hasRows && activeTab === 'table';
  // The value viewer takes the rail's place, so the heads carry the distribution meanwhile.
  const viewerShown = activeTab === 'table' && viewerOpen && selected !== null && displayRows[selected.row] !== undefined;
  const statsShown = railOpen || tableShown;
  const shownStats = useMemo(
    () => (statsShown ? columnStats(shownColumns, railRows) : null),
    [statsShown, shownColumns, railRows]
  );
  // Load order and the rail's cell budget: a sort changes neither, so it never recomputes.
  const instruments = useMemo(
    () =>
      tableShown
        ? resultInstruments(
            shownColumns,
            filteredRows,
            linkedColumns,
            statsRowLimit(shownColumns.length)
          )
        : undefined,
    [tableShown, shownColumns, filteredRows, linkedColumns]
  );

  const { paneRef, headerRef, bodyRef, pinRef, layout: gridFirst, pinned, short } = useSqlResultPaneLayout(
    (response?.status === 'success' || response?.status === 'too-large') && activeTab !== 'profile' && shownRows.length > 0,
    // Staged writes stay in sight on a short pane.
    rowEdits !== undefined && stagedCount(rowEdits.edits) > 0,
    responseKey
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
            <Loader2 size={18} aria-hidden="true" className="animate-spin text-fg-subtle" />
            <div className="text-body-sm text-fg-subtle">{t('sqlWorkspace.response.loading')}</div>
          </div>
        ) : (
          <EmptyState
            icon={<Hash size={19} aria-hidden="true" />}
            title={t('sqlWorkspace.response.emptyTitle')}
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

  const hasResultBody = response.status === 'success' || response.status === 'too-large';
  const knownTotal = Math.max(response.rowCount, loadedRows.length);
  const totalIsLowerBound = response.rowCountIsLowerBound === true && more?.complete !== true;
  const showSnippetNudge = response.status === 'success' && onSaveSnippet !== undefined;
  const tabs = hasResultBody
    ? [
        { id: 'table', label: t('sqlWorkspace.response.tabTable') },
        { id: 'json', label: t('sqlWorkspace.response.tabJson') },
        ...(canProfile ? [{ id: 'profile', label: t('sqlWorkspace.response.tabProfile') }] : []),
      ]
    : undefined;
  const showGridChrome = hasResultBody && activeTab !== 'profile';
  // The bar never closes on rows it is narrowing.
  const narrowed =
    filter.length > 0 || conditions.length > 0 || sort.column !== null || layout.hidden.length > 0 || layout.order.length > 0;
  const filterBarShown = filterOpen || narrowed;
  const toggleFilter = () => {
    if (narrowed) {
      filterInputRef.current?.focus();
      return;
    }
    filterShown = !filterOpen;
    setFilterOpen(filterShown);
    if (filterShown) requestAnimationFrame(() => filterInputRef.current?.focus());
  };

  return (
    <div
      ref={paneRef}
      data-testid="sql-result-preview"
      data-state={response.status}
      data-grid-first={gridFirst !== null ? 'true' : undefined}
      // A short pane scrolls as a whole rather than letting the bands cover the grid.
      className="relative flex h-full min-w-0 flex-col overflow-y-auto bg-bg-base"
    >
      <div ref={headerRef} className="sticky top-0 z-20 shrink-0">
        <SqlResultHeader
          response={response}
          total={{ count: knownTotal, lowerBound: totalIsLowerBound }}
          shownInView={displayRows.length < knownTotal || totalIsLowerBound ? displayRows.length : null}
          statementPosition={statementPosition}
          density={short ? 'compact' : 'pane'}
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={(id) => {
            setBodyTab(id as ResultBodyTab);
            if (id === 'profile' && visibleProfile === null) void handleProfile();
          }}
          grid={
            showGridChrome && response.rows.length > 0
              ? {
                  filterShown: filterBarShown,
                  onToggleFilter: toggleFilter,
                  railShown: showRail,
                  onToggleRail: () => {
                    railShown = !showRail;
                    setShowRail(railShown);
                  },
                }
              : undefined
          }
          onExport={hasResultBody && response.rows.length > 0 ? () => setExportOpen(true) : undefined}
          runs={
            responses && responses.length > 1 && onSelectResponse
              ? { responses, selectedIndex: selectedResponseIndex, onSelect: onSelectResponse }
              : undefined
          }
        />
      </div>

      {/* An editor run's SQL is the editor above; only rows from elsewhere name their source. */}
      {source?.origin === 'table' && selectedResponseIndex === 0 ? (
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
            {t('sqlWorkspace.strip.fromTable', { name: source.tableName })}
          </span>
          {source.backTo && onBack ? (
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
          {onEditInEditor ? (
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

      {rowEdits && source?.origin === 'table' && response.status === 'success' ? (
        <div
          ref={pinRef}
          className={cn('shrink-0', pinned && 'sticky z-[15] overflow-y-auto bg-bg-base')}
          style={pinned && gridFirst ? { top: gridFirst.headerHeight, maxHeight: gridFirst.viewHeight } : undefined}
        >
          <SqlRowEditBar edits={rowEdits} />
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
          {...(response.engine ? { engine: response.engine } : {})}
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

      {showGridChrome && response.rows.length > 0 && filterBarShown ? (
        <SqlResultToolbar
          searchRef={filterInputRef}
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
          {...(response?.engine ? { engine: response.engine } : {})}
          {...(snippetLabel !== undefined ? { snippetLabel } : {})}
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
        <div
          ref={bodyRef}
          className="flex min-h-[4.5rem] flex-1"
          style={gridFirst ? { flex: 'none', height: gridFirst.gridHeight } : undefined}
        >
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {displayRows.length > 0 ? (
              activeTab === 'json' ? (
                <div className="min-h-[4.5rem] flex-1 overflow-auto">
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
                  {...(gridEditing ? { editing: gridEditing } : {})}
                  {...(shownStats && (!railOpen || viewerShown) ? { stats: shownStats } : {})}
                  {...(instruments ? { instruments } : {})}
                />
              )
            ) : hasResultBody && loadedRows.length > 0 && filteredCount === 0 ? (
              <div
                data-testid="sql-result-preview-filter-empty"
                className="grid min-h-[4.5rem] flex-1 place-items-center px-4 py-6 text-center text-body-sm text-fg-subtle"
              >
                {t('sqlWorkspace.grid.filterEmpty')}
              </div>
            ) : response.status === 'success' ? (
              <div
                data-testid="sql-result-preview-no-rows"
                className="grid min-h-[4.5rem] flex-1 place-items-center px-4 py-6 text-center text-body-sm text-fg-subtle"
              >
                {/* Only the newest run keeps its rows; an earlier one keeps its count. */}
                {t(selectedResponseIndex > 0 && response.rowCount > 0 ? 'sqlWorkspace.response.rowsNotKept' : 'sqlWorkspace.response.noRows')}
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
          ) : railOpen && shownStats ? (
            // Load order, not the sort: a sort changes neither the stats nor which rows a sampled rail reads.
            <SqlColumnRail
              stats={shownStats}
              rowCount={railRows.length}
              {...(onInsertPredicate ? { onInsert: onInsertPredicate } : {})}
            />
          ) : null}
        </div>
      )}

      {hasResultBody && response.rows.length > 0 && (canShowMore || more?.loading || showSnippetNudge) ? (
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
