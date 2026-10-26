import { ChevronsDownUp, Download, PanelLeftClose, RefreshCw, Sparkles } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';
import { formatNumber } from '../../i18n/formatNumber';
import { useShortcutLabel } from '../../hooks/useShortcutLabel';
import { useFileDropZone } from '../../hooks/useFileDropZone';
import type { SqlImportSource } from '../../hooks/sqlWorkspaceTelemetry';
import { detectImportFormat, type SqlStorageMode } from '../../../shared/sqlWorkspace';
import {
  DEFAULT_EXPANDED_NODES,
  buildExplorerSchemas,
  filterSystemViews,
  type SqlCatalog,
  type SqlSchemaTable,
} from './sqlExplorerModel';
import { TreeRow } from './SqlTreeRow';
import '../../i18n/sqlConnectionsCatalog';

/** Accept predicate for drag-drop; mirrors the picker's detection. */
function acceptImportItem(item: File | DataTransferItem): boolean {
  if (item instanceof File) return detectImportFormat(item.name, item.type) !== null;
  // A DataTransferItem during dragover exposes only the MIME type.
  if (item.type.trim().length === 0) return true;
  return detectImportFormat('', item.type) !== null;
}

/** DuckDB's own catalog schema: an identifier, not copy. */
const SYSTEM_SCHEMA = 'information_schema';

const ICON_BUTTON =
  'focus-ring inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-bg-panel-alt hover:text-fg-base disabled:cursor-not-allowed disabled:opacity-40';

export interface SqlExplorerProps {
  catalog: SqlCatalog;
  isLoading: boolean;
  /** False until the first catalog read settles, so the empty state does not flash. */
  hasLoaded?: boolean;
  onRefresh: () => void;
  onOpenTable: (table: SqlSchemaTable) => void;
  /** The table whose rows the results area shows, if any. */
  openedTableName?: string | null;
  onFold: () => void;
  onImportFile: (file: File, source: SqlImportSource) => void;
  isImportBusy: boolean;
  onTrySample: () => void;
  isCreatingSample?: boolean;
  storageMode: SqlStorageMode;
  persistRequested: boolean;
  storageUsageLabel: string | null;
  filter: string;
  onFilterChange: (value: string) => void;
  /** The Queries section, rendered under the tree. */
  children?: ReactNode;
  /** A database connection's tree, shown instead of Local; the signal changes on Collapse all. */
  renderRemoteTree?: (collapseSignal: number) => ReactNode;
}

export function SqlExplorer({
  catalog,
  isLoading,
  hasLoaded = true,
  onRefresh,
  onOpenTable,
  openedTableName = null,
  onFold,
  onImportFile,
  isImportBusy,
  onTrySample,
  isCreatingSample = false,
  storageMode,
  persistRequested,
  storageUsageLabel,
  filter,
  onFilterChange,
  children,
  renderRemoteTree,
}: SqlExplorerProps) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(DEFAULT_EXPANDED_NODES);
  const [collapseSignal, setCollapseSignal] = useState(0);
  const remote = renderRemoteTree !== undefined;
  const combo = useShortcutLabel('view-toggle-sidebar');
  const foldLabel = combo
    ? t('sqlWorkspace.explorer.hideWithShortcut', { combo })
    : t('sqlWorkspace.explorer.hide');
  const { state: dropState, handlers: dropHandlers } = useFileDropZone({
    onFile: file => {
      if (!isImportBusy && !remote) onImportFile(file, 'drop');
    },
    // Files become Local tables, so the tree of another connection takes none.
    accept: item => !isImportBusy && !remote && acceptImportItem(item),
  });

  const filtering = filter.trim().length > 0;
  const schemas = useMemo(() => buildExplorerSchemas(catalog, filter), [catalog, filter]);
  const systemViews = useMemo(
    () => filterSystemViews(catalog.systemViews, filter),
    [catalog.systemViews, filter]
  );
  const hasUserObjects = schemas.some(
    schema => schema.tables.length + schema.views.length + schema.macros.length > 0
  );
  // While filtering every matching branch is open, so nothing that matches hides.
  const isOpen = (key: string) => filtering || expanded.has(key);
  const toggle = (key: string) =>
    setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const storageLabelKey =
    storageMode === 'opfs'
      ? 'sqlWorkspace.storage.persistent'
      : persistRequested
        ? 'sqlWorkspace.storage.unavailable'
        : 'sqlWorkspace.storage.memory';

  const renderTable = (table: SqlSchemaTable, depth: number) => {
    const key = `table:${table.name}`;
    const open = expanded.has(key);
    const selected = openedTableName === table.name;
    const hasColumns = (table.columns?.length ?? 0) > 0;
    return (
      <li key={table.name}>
        <div
          style={{ paddingLeft: 8 + depth * 12 }}
          className={cn(
            'group flex h-5 items-center gap-[5px] pr-2.5 font-mono text-caption',
            selected
              ? 'bg-accent-tint font-semibold'
              : 'hover:bg-bg-panel-alt'
          )}
        >
          <button
            type="button"
            onClick={() => toggle(key)}
            disabled={!hasColumns}
            aria-expanded={hasColumns ? open : undefined}
            aria-label={t(
              open ? 'sqlWorkspace.schema.collapseColumns' : 'sqlWorkspace.schema.expandColumns',
              { name: table.name }
            )}
            data-testid="sql-explorer-expand"
            data-table-name={table.name}
            className="focus-ring w-2 shrink-0 text-left text-fg-subtle disabled:opacity-0"
          >
            <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          </button>
          <button
            type="button"
            onClick={() => onOpenTable(table)}
            data-testid="sql-explorer-table"
            data-table-name={table.name}
            aria-current={selected ? 'true' : undefined}
            title={t('sqlWorkspace.explorer.openTable', { name: table.name })}
            className={cn(
              'focus-ring min-w-0 flex-1 truncate text-left',
              selected ? 'text-accent-fg' : 'text-fg-muted group-hover:text-fg-base'
            )}
          >
            {table.sqlName ?? table.name}
          </button>
          {table.rowCount !== undefined ? (
            <span
              data-testid="sql-explorer-row-count"
              title={t('sqlWorkspace.explorer.rowCount', { count: table.rowCount })}
              className="shrink-0 tabular-nums text-fg-subtle"
            >
              {formatNumber(table.rowCount, i18n.language)}
            </span>
          ) : null}
          {table.copiedFrom ? (
            <span
              data-testid="sql-explorer-copied-from"
              title={t('sqlWorkspace.explorer.copiedFromTitle', {
                connection: table.copiedFrom.connection,
                date: new Date(table.copiedFrom.at).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
              })}
              className="max-w-[7rem] shrink-0 truncate text-micro text-fg-subtle"
            >
              {table.copiedFrom.connection}
            </span>
          ) : null}
          {table.source ? (
            <span
              data-testid="sql-explorer-source"
              title={t('sqlWorkspace.explorer.sourceTitle', { format: table.source })}
              className="shrink-0 text-micro text-fg-subtle"
            >
              {table.source}
            </span>
          ) : null}
        </div>
        {open && hasColumns ? (
          <ul role="list" data-testid="sql-explorer-columns">
            {table.columns!.map(column => (
              <li
                key={column.name}
                data-testid="sql-explorer-column"
                data-column-name={column.name}
                style={{ paddingLeft: 8 + (depth + 1) * 12 + 10 }}
                className="flex h-5 items-center gap-2 pr-2.5 font-mono text-caption"
              >
                <span className="min-w-0 flex-1 truncate text-fg-muted">{column.name}</span>
                <span className="shrink-0 text-micro uppercase tracking-[0.04em] text-fg-subtle">
                  {column.type}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <section
      data-testid="sql-explorer"
      aria-label={t('sqlWorkspace.explorer.label')}
      className="flex h-full min-h-0 flex-col bg-bg-panel"
      {...dropHandlers}
    >
      <header className="flex h-[30px] shrink-0 items-center gap-0.5 border-b border-border-subtle pl-2.5 pr-1">
        <span className="font-mono text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">
          {t('sqlWorkspace.explorer.label')}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => {
            setExpanded(new Set(['local']));
            setCollapseSignal(signal => signal + 1);
          }}
          aria-label={t('sqlWorkspace.explorer.collapseAll')}
          title={t('sqlWorkspace.explorer.collapseAll')}
          data-testid="sql-explorer-collapse-all"
          className={ICON_BUTTON}
        >
          <ChevronsDownUp size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          aria-label={t('sqlWorkspace.schema.refresh')}
          title={t('sqlWorkspace.schema.refresh')}
          data-testid="sql-explorer-refresh"
          className={ICON_BUTTON}
        >
          <RefreshCw
            size={12}
            aria-hidden="true"
            className={isLoading ? 'animate-spin' : undefined}
          />
        </button>
        <button
          type="button"
          onClick={onFold}
          aria-label={foldLabel}
          title={foldLabel}
          data-testid="sql-explorer-fold"
          className={ICON_BUTTON}
        >
          <PanelLeftClose size={12} aria-hidden="true" />
        </button>
      </header>
      <div className="flex h-8 shrink-0 items-center border-b border-border-subtle px-2">
        <input
          type="search"
          value={filter}
          onChange={event => onFilterChange(event.target.value)}
          placeholder={t('sqlWorkspace.explorer.filter')}
          aria-label={t('sqlWorkspace.explorer.filter')}
          data-testid="sql-explorer-filter"
          className="h-[22px] min-w-0 flex-1 rounded-md border border-border-default bg-bg-inset px-2 text-body-sm text-fg-base placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="py-[5px]">
          {remote ? (
            renderRemoteTree(collapseSignal)
          ) : (
            <>
              <TreeRow
                depth={0}
                expanded={isOpen('local')}
                onToggle={() => toggle('local')}
                testId="sql-explorer-local"
                label={
                  <>
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-fg"
                    />
                    <span className="text-fg-base">{t('sqlWorkspace.connection.localName')}</span>
                    <span
                      data-testid="sql-explorer-storage"
                      data-storage-mode={storageMode}
                      className="truncate text-fg-subtle"
                    >
                      {t(storageLabelKey)}
                      {storageMode === 'opfs' && storageUsageLabel ? ` · ${storageUsageLabel}` : ''}
                    </span>
                  </>
                }
              />
              {dropState === 'over' || dropState === 'dropping' || dropState === 'error' ? (
                <div
                  data-testid="sql-explorer-drop-target"
                  data-drop-state={dropState}
                  className={cn(
                    'mx-2 my-1 rounded-[7px] border-[1.5px] border-dashed px-2.5 py-2',
                    dropState === 'error'
                      ? 'border-error-border bg-error-bg text-error-fg'
                      : 'border-accent-fg bg-accent-tint text-fg-base'
                  )}
                >
                  <p className="flex items-center gap-1.5 text-caption font-semibold">
                    <Download size={12} aria-hidden="true" />
                    {t(
                      dropState === 'error'
                        ? 'sqlWorkspace.explorer.dropRejected'
                        : 'sqlWorkspace.explorer.dropTitle'
                    )}
                  </p>
                  <p className="mt-0.5 font-mono text-micro text-fg-muted">
                    {t('sqlWorkspace.explorer.dropHint')}
                  </p>
                </div>
              ) : null}
              {isOpen('local') ? (
                <ul role="list">
                  {schemas.map(schema => {
                    const schemaKey = `schema:${schema.name}`;
                    const groups: Array<{ id: 'tables' | 'views' | 'macros'; count: number }> = [
                      { id: 'tables', count: schema.tables.length },
                      { id: 'views', count: schema.views.length },
                      { id: 'macros', count: schema.macros.length },
                    ];
                    return (
                      <li key={schema.name}>
                        <TreeRow
                          depth={1}
                          expanded={isOpen(schemaKey)}
                          onToggle={() => toggle(schemaKey)}
                          testId="sql-explorer-schema"
                          nodeName={schema.name}
                          label={<span className="truncate">{schema.name}</span>}
                        />
                        {isOpen(schemaKey) ? (
                          <ul role="list">
                            {groups
                              .filter(group => group.id === 'tables' || group.count > 0)
                              .filter(group => !filtering || group.count > 0)
                              .map(group => {
                                const groupKey = `group:${schema.name}:${group.id}`;
                                return (
                                  <li key={group.id}>
                                    <TreeRow
                                      depth={2}
                                      expanded={isOpen(groupKey)}
                                      onToggle={() => toggle(groupKey)}
                                      testId={`sql-explorer-group-${group.id}`}
                                      nodeName={schema.name}
                                      label={t(`sqlWorkspace.explorer.group.${group.id}`)}
                                      trailing={
                                        <span className="shrink-0 tabular-nums text-fg-subtle">
                                          {group.count}
                                        </span>
                                      }
                                    />
                                    {isOpen(groupKey) ? (
                                      <ul role="list">
                                        {group.id === 'tables'
                                          ? schema.tables.map(table => renderTable(table, 3))
                                          : group.id === 'views'
                                            ? schema.views.map(view => renderTable(view, 3))
                                            : schema.macros.map(macro => (
                                                <li
                                                  key={macro.name}
                                                  data-testid="sql-explorer-macro"
                                                  style={{ paddingLeft: 8 + 3 * 12 + 10 }}
                                                  className="flex h-5 items-center truncate pr-2.5 font-mono text-caption text-fg-muted"
                                                >
                                                  {macro.name}
                                                </li>
                                              ))}
                                      </ul>
                                    ) : null}
                                  </li>
                                );
                              })}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                  {systemViews.length > 0 ? (
                    <li>
                      <TreeRow
                        depth={1}
                        expanded={expanded.has('schema:information_schema')}
                        onToggle={() => toggle('schema:information_schema')}
                        testId="sql-explorer-schema"
                        nodeName={SYSTEM_SCHEMA}
                        label={<span className="truncate">{SYSTEM_SCHEMA}</span>}
                      />
                      {expanded.has('schema:information_schema') ? (
                        <ul role="list">
                          {systemViews.map(view => (
                            <li
                              key={view}
                              style={{ paddingLeft: 8 + 2 * 12 + 10 }}
                              className="flex h-5 items-center truncate pr-2.5 font-mono text-caption text-fg-subtle"
                            >
                              {view}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ) : null}
                </ul>
              ) : null}
              {!hasUserObjects && !filtering && !isLoading && hasLoaded ? (
                <div
                  data-testid="sql-explorer-empty"
                  className="px-2.5 py-2 text-caption leading-relaxed text-fg-subtle"
                >
                  <p>{t('sqlWorkspace.explorer.empty')}</p>
                  <button
                    type="button"
                    onClick={onTrySample}
                    disabled={isCreatingSample}
                    data-testid="sql-explorer-try-sample"
                    className="focus-ring mt-1.5 inline-flex h-[22px] items-center gap-1.5 rounded-md border border-border-default bg-bg-panel-alt px-2 text-caption font-medium text-fg-base transition-colors hover:border-border-strong disabled:opacity-40"
                  >
                    <Sparkles size={11} aria-hidden="true" />
                    {t('sqlWorkspace.sample.cta')}
                  </button>
                </div>
              ) : null}
              {filtering && !hasUserObjects && systemViews.length === 0 ? (
                <p
                  data-testid="sql-explorer-no-match"
                  className="px-2.5 py-2 text-caption text-fg-subtle"
                >
                  {t('sqlWorkspace.explorer.noMatch')}
                </p>
              ) : null}
            </>
          )}
        </div>
        {children}
      </div>
    </section>
  );
}
