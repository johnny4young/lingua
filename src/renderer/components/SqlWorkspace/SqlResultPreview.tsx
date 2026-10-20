/**
 * Results below the SQL editor: status + Table / JSON / Profile, the SQL
 * strip naming what produced the rows, a typed grid where a click selects a
 * row and Cmd/Ctrl+C copies it as JSON, and Export full result… in the footer.
 */

import { AlertTriangle, Bookmark, Download, Hash, Loader2, Search, X } from 'lucide-react';
import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  buildColumnProfileQuery,
  type SqlColumnProfileOutcome,
} from '../../runtime/sqlColumnProfile';
import {
  currentShortcutDisplayPlatform,
  formatShortcutCombo,
} from '../../data/keyboardShortcuts';
import type { SqlQueryStatus, SqlResponseV1 } from '../../../shared/sqlWorkspace';
import { EmptyState } from '../ui/EmptyState';
import { ResultHeader } from '../ui/ResultHeader';
import { StatusBadge, type StatusBadgeTone } from '../ui/StatusBadge';
import { SqlRunHistory } from './SqlRunHistory';
import { SqlColumnProfilePanel } from './SqlColumnProfilePanel';
import { ErrorBand, JsonView, ResultTable } from './SqlResultPreviewParts';
import { SqlExportDialog, type SqlResultHandoffs } from './SqlExportDialog';
import { copyToClipboard } from './sqlResultActions';
import { filterRows, nextSortState, sortRows, type SqlSortState } from './sqlResultGrid';

/** Where the rows on screen came from: an editor run, or a table opened from the Explorer. */
export type SqlResultSource =
  | { origin: 'editor'; sql: string }
  | { origin: 'table'; sql: string; tableName: string };

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
  handoffs?: SqlResultHandoffs;
}

type ResultBodyTab = 'table' | 'json' | 'profile';

/** DuckDB status → StatusBadge tone. */
function toneForStatus(status: SqlQueryStatus): StatusBadgeTone {
  if (status === 'success') return 'success';
  if (status === 'sql-error') return 'error';
  if (status === 'timeout' || status === 'too-large') return 'warning';
  return 'neutral';
}

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
  handoffs = {},
}: SqlResultPreviewProps) {
  const { t } = useTranslation();
  // The picked view survives re-runs: the user's last view is the one they want next.
  const [bodyTab, setBodyTab] = useState<ResultBodyTab>('table');
  // Sort and filter work on the fetched rows; they never re-run the query.
  const [sort, setSort] = useState<SqlSortState>({ column: null, direction: 'asc' });
  const [filter, setFilter] = useState<string>('');
  const [selection, setSelection] = useState<{ key: string; index: number } | null>(null);
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
  const selectionKey = `${responseKey}|${filter}|${sort.column}:${sort.direction}`;
  const selectedRow = selection?.key === selectionKey ? selection.index : null;
  const setSelectedRow = useCallback(
    (index: number | null) => setSelection(index === null ? null : { key: selectionKey, index }),
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

  const filteredSortedRows = useMemo(() => {
    if (!response || response.rows.length === 0) return [];
    return sortRows(filterRows(response.rows, filter), sort);
  }, [response, filter, sort]);
  const displayRows = useMemo(
    () => filteredSortedRows.slice(0, Math.max(1, rowDisplayLimit)),
    [filteredSortedRows, rowDisplayLimit]
  );
  const filteredCount = filteredSortedRows.length;

  const copySelectedRow = useCallback(() => {
    const row = selectedRow === null ? undefined : displayRows[selectedRow];
    if (!row) return false;
    copyToClipboard(JSON.stringify(row, jsonReplacer, 2), {
      messageKey: 'sqlWorkspace.grid.rowCopied',
    });
    return true;
  }, [displayRows, selectedRow]);

  const handleGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (displayRows.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setSelectedRow(
        Math.min(displayRows.length - 1, Math.max(0, (selectedRow ?? (step > 0 ? -1 : 1)) + step))
      );
      return;
    }
    const isCopy = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c';
    // A text selection in the grid copies as text, the platform default.
    if (isCopy && (window.getSelection()?.toString() ?? '') === '' && copySelectedRow()) {
      event.preventDefault();
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

  const tone = toneForStatus(response.status);
  const hasResultBody = response.status === 'success' || response.status === 'too-large';
  const meta = hasResultBody
    ? [
        t('sqlWorkspace.response.rowCount', { count: response.rowCount }),
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
      className="relative flex h-full min-w-0 flex-col bg-bg-base"
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
          showStatementCount ? (
            <span
              data-testid="sql-result-preview-statement-count"
              className="rounded-sm bg-bg-panel-alt px-1.5 py-0.5 text-eyebrow font-medium text-fg-muted"
            >
              {t('sqlWorkspace.response.statementCount', { count: response.statementCount })}
            </span>
          ) : undefined
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
      response.status === 'engine-load-failed' ? (
        <ErrorBand
          status={response.status}
          message={response.errorMessage}
          // Only the newest run can be matched to the editor text.
          querySource={selectedResponseIndex === 0 ? querySource : undefined}
          onApplyFix={selectedResponseIndex === 0 ? onApplyFix : undefined}
        />
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

      {showGridChrome && response.rows.length > 0 ? (
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <span className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border-default bg-bg-inset px-2 py-1 focus-within:border-border-strong">
            <Search size={11} aria-hidden="true" className="shrink-0 text-fg-subtle" />
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
          data-testid="sql-result-preview-table-container"
          tabIndex={displayRows.length > 0 && activeTab === 'table' ? 0 : undefined}
          aria-label={activeTab === 'table' ? t('sqlWorkspace.grid.ariaLabel') : undefined}
          onKeyDown={activeTab === 'table' ? handleGridKeyDown : undefined}
          className="min-h-[6.5rem] flex-1 overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
        >
          {displayRows.length > 0 ? (
            activeTab === 'json' ? (
              <JsonView rows={displayRows} />
            ) : (
              <ResultTable
                columns={response.columns}
                rows={displayRows}
                sort={sort}
                onSort={handleSort}
                selectedRowIndex={selectedRow}
                onSelectRow={setSelectedRow}
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
          columns={response.columns}
          rows={filteredSortedRows}
          totalRowCount={response.rowCount}
          handoffs={handoffs}
          onClose={() => setExportOpen(false)}
        />
      ) : null}
    </div>
  );
}
