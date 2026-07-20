/**
 * SQL workspace USABILITY upgrade — collapsible schema/table browser.
 *
 * A TablePlus-style sidebar section that lists the DuckDB session
 * tables. Reuses the existing `SHOW TABLES` introspection (the parent
 * runs the probe + supplies the names + optional column counts). Each
 * table row is a button: clicking it inserts a
 * `SELECT * FROM <name> LIMIT 100;` starter into the active query
 * editor so the user can immediately run it.
 *
 * Token-only visuals (Signal-Slate). No hardcoded copy — all strings
 * resolve through `t()`.
 */

import {
  ChevronDown,
  ChevronRight,
  Cpu,
  Database,
  FilePlus2,
  HardDrive,
  RefreshCw,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';
import {
  SQL_IMPORT_FILE_ACCEPT,
  detectImportFormat,
  type SqlStorageMode,
} from '../../../shared/sqlWorkspace';
import { useFileDropZone } from '../../hooks/useFileDropZone';
import type { SqlImportSource } from '../../hooks/sqlWorkspaceTelemetry';

/** Accept predicate for drag-drop — mirrors the picker's detection. */
function acceptImportItem(item: File | DataTransferItem): boolean {
  if (item instanceof File) {
    return detectImportFormat(item.name, item.type) !== null;
  }
  // DataTransferItem during dragover exposes only the MIME type.
  if (item.type.trim().length === 0) return true;
  return detectImportFormat('', item.type) !== null;
}

/**
 * One column of a discovered session table — name + SQL type. Populated
 * from the single `information_schema.columns` probe the parent runs.
 */
export interface SqlSchemaColumn {
  name: string;
  type: string;
}

/**
 * One discovered session table. Both `columnCount` and `columns` are
 * optional — the parent populates them from a single
 * `information_schema.columns` probe. When `columns` is present it is
 * the authoritative source (its length drives the count chip and its
 * entries drive the expandable column list + editor autocomplete);
 * `columnCount` remains a lightweight fallback for callers that only
 * know the count. `undefined` on both hides the chip.
 */
export interface SqlSchemaTable {
  /** Human-readable label, schema-qualified outside DuckDB's `main`. */
  name: string;
  /** Raw table identifier for generated SQL. Defaults to `name` for legacy callers. */
  sqlName?: string;
  /** Raw non-main schema identifier for generated SQL. */
  schemaName?: string;
  columnCount?: number;
  columns?: ReadonlyArray<SqlSchemaColumn>;
}

export interface SqlSchemaBrowserProps {
  tables: ReadonlyArray<SqlSchemaTable>;
  /** True while a `SHOW TABLES` probe is in flight. */
  isLoading: boolean;
  /** Re-run the `SHOW TABLES` introspection. */
  onRefresh: () => void;
  /**
   * Insert a `SELECT * FROM <name> LIMIT 100;` starter into the active
   * query editor. Disabled (the row is inert) when no query is active.
   */
  onInsertTable: (name: string, schemaName?: string) => void;
  /** Whether a query is active to receive the inserted starter. */
  canInsert: boolean;
  /**
   * implementation (SQL OPFS) — resolved storage backing of the live
   * DuckDB engine. Drives the storage chip below the header. Optional
   * (defaults to `'memory'`) so isolated renders need not wire it; the
   * panel always passes the live value.
   */
  storageMode?: SqlStorageMode;
  /**
   * Whether the user opted into persistence. Distinguishes "in-memory
   * by choice" from "in-memory because OPFS is unavailable". Optional;
   * defaults to `false`.
   */
  persistRequested?: boolean;
  /**
   * implementation note — approximate origin storage label (e.g. `~12 MB`), shown
   * next to the persistent chip. `null` hides it.
   */
  storageUsageLabel?: string | null;
  /**
   * implementation (SQL import) implementation note — import a dropped or picked file as a
   * table. `source` tells the caller whether the file came from the
   * keyboard-accessible picker or a drag-drop, for telemetry. Optional so
   * isolated renders need not wire it; when omitted, the import
   * affordances are hidden.
   */
  onImportFile?: (file: File, source: SqlImportSource) => void;
  /** True while an import preview/import is already in flight. */
  isImportBusy?: boolean;
}

export function SqlSchemaBrowser({
  tables,
  isLoading,
  onRefresh,
  onInsertTable,
  canInsert,
  storageMode = 'memory',
  persistRequested = false,
  storageUsageLabel = null,
  onImportFile,
  isImportBusy = false,
}: SqlSchemaBrowserProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  // Per-table expand state — which tables reveal their column list. A
  // Set keyed by table name; toggling is additive so expanding one table
  // never collapses another. Tables without column metadata are never
  // expandable, so stale names in the set are simply inert.
  const [expandedTables, setExpandedTables] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const toggleExpanded = (name: string) =>
    setExpandedTables((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  // implementation (SQL import) implementation note — the import affordance. A real <button>
  // opens a hidden <input type="file"> via `.click()`, so the import is
  // fully keyboard-operable (Enter/Space on the button → native dialog,
  // which is itself keyboard-accessible). Drag-drop is an ADDITIVE mouse
  // path layered over the same `onImportFile` callback.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const handlePickImport = () => fileInputRef.current?.click();
  const { state: dropState, handlers: dropHandlers } = useFileDropZone({
    onFile: (file) => {
      if (!isImportBusy) onImportFile?.(file, 'drop');
    },
    accept: (item) => !isImportBusy && acceptImportItem(item),
  });

  // implementation (SQL OPFS) — the chip label depends on BOTH the
  // resolved mode and whether persistence was requested: in-memory while
  // persistence was off is normal; in-memory while it was requested means
  // OPFS was unavailable.
  const storageLabelKey =
    storageMode === 'opfs'
      ? 'sqlWorkspace.storage.persistent'
      : persistRequested
        ? 'sqlWorkspace.storage.unavailable'
        : 'sqlWorkspace.storage.memory';

  return (
    <section
      data-testid="sql-schema-browser"
      className="flex shrink-0 flex-col border-t border-border-subtle bg-bg-panel"
    >
      <header className="flex items-center gap-1.5 px-2.5 py-2">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          data-testid="sql-schema-browser-toggle"
          className="inline-flex min-w-0 flex-1 items-center gap-1.5 rounded text-left text-fg-subtle transition-colors hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          {collapsed ? (
            <ChevronRight size={12} aria-hidden="true" />
          ) : (
            <ChevronDown size={12} aria-hidden="true" />
          )}
          <Database size={12} aria-hidden="true" />
          <span className="font-mono text-eyebrow uppercase tracking-[0.14em]">
            {t('sqlWorkspace.schema.label')}
          </span>
          {tables.length > 0 ? (
            <span
              data-testid="sql-schema-browser-count"
              className="ml-1 rounded-sm bg-bg-panel-alt px-1.5 py-0.5 font-mono text-micro tabular-nums text-fg-muted"
            >
              {tables.length}
            </span>
          ) : null}
        </button>
        {onImportFile ? (
          <button
            type="button"
            onClick={handlePickImport}
            disabled={isImportBusy}
            aria-label={t('sqlWorkspace.schema.import')}
            title={t('sqlWorkspace.schema.import')}
            data-testid="sql-schema-browser-import"
            className="focus-ring inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-bg-panel-alt text-fg-subtle transition-colors hover:border-border-strong hover:bg-bg-panel hover:text-fg-base disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FilePlus2 size={11} aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          aria-label={t('sqlWorkspace.schema.refresh')}
          title={t('sqlWorkspace.schema.refresh')}
          data-testid="sql-schema-browser-refresh"
          className="focus-ring inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-bg-panel-alt text-fg-subtle transition-colors hover:border-border-strong hover:bg-bg-panel hover:text-fg-base disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw
            size={11}
            aria-hidden="true"
            className={isLoading ? 'animate-spin' : undefined}
          />
        </button>
        {onImportFile ? (
          <input
            ref={fileInputRef}
            type="file"
            accept={SQL_IMPORT_FILE_ACCEPT}
            disabled={isImportBusy}
            aria-label={t('sqlWorkspace.schema.import')}
            data-testid="sql-schema-browser-import-input"
            className="internal"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImportFile(file, 'picker');
              // Reset so picking the same file twice still fires change.
              event.target.value = '';
            }}
          />
        ) : null}
      </header>
      {/* implementation (SQL OPFS) — storage-backing chip. Always
          visible (even collapsed) so the persistence state is never
          hidden. */}
      <div
        data-testid="sql-schema-browser-storage"
        data-storage-mode={storageMode}
        className="flex items-center gap-1.5 px-2.5 pb-1.5 font-mono text-micro uppercase tracking-[0.12em] text-fg-subtle"
        aria-label={t('sqlWorkspace.storage.ariaLabel')}
        title={t(storageLabelKey)}
      >
        {storageMode === 'opfs' ? (
          <HardDrive size={10} aria-hidden="true" className="text-accent" />
        ) : (
          <Cpu size={10} aria-hidden="true" />
        )}
        <span className="min-w-0 truncate normal-case tracking-normal">
          {t(storageLabelKey)}
        </span>
        {storageMode === 'opfs' && storageUsageLabel ? (
          <span
            data-testid="sql-schema-browser-storage-usage"
            className="shrink-0 normal-case tracking-normal text-fg-muted"
          >
            · {storageUsageLabel}
          </span>
        ) : null}
      </div>
      {collapsed ? null : (
        <div className="max-h-[34vh] overflow-y-auto px-1.5 pb-2">
          {/* implementation (SQL import) implementation note — additive drag-drop target.
              The keyboard path is the header "+" button → native picker;
              this drop zone is a mouse-only convenience. The hint names
              the keyboard alternative so a keyboard user is never stranded
              looking for a drop affordance. */}
          {onImportFile ? (
            <div
              data-testid="sql-schema-browser-dropzone"
              data-drop-state={dropState}
              aria-hidden="true"
              className={cn(
                'mb-1.5 flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1.5 text-caption transition-colors',
                dropState === 'over'
                  ? 'border-accent bg-accent-soft text-accent'
                  : dropState === 'error'
                    ? 'border-error/60 bg-error/8 text-error'
                    : 'border-border-subtle text-fg-subtle'
              )}
              {...dropHandlers}
            >
              <FilePlus2 size={11} aria-hidden="true" className="shrink-0" />
              <span className="min-w-0 leading-snug">
                {t('sqlWorkspace.import.dropHint')}
              </span>
            </div>
          ) : null}
          {tables.length === 0 ? (
            <p
              data-testid="sql-schema-browser-empty"
              className="px-1.5 py-1.5 text-eyebrow leading-relaxed text-fg-subtle"
            >
              {t('sqlWorkspace.schema.empty')}
            </p>
          ) : (
            <ul role="list" className="flex flex-col gap-0.5">
              {tables.map((table) => {
                const columns = table.columns;
                const hasColumns = columns !== undefined && columns.length > 0;
                const columnCount =
                  columns !== undefined ? columns.length : table.columnCount;
                const isExpanded = hasColumns && expandedTables.has(table.name);
                return (
                  <li key={table.name}>
                    <div className="flex items-center gap-0.5">
                      {hasColumns ? (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(table.name)}
                          aria-expanded={isExpanded}
                          aria-label={t(
                            isExpanded
                              ? 'sqlWorkspace.schema.collapseColumns'
                              : 'sqlWorkspace.schema.expandColumns',
                            { name: table.name }
                          )}
                          data-testid="sql-schema-browser-expand"
                          data-table-name={table.name}
                          className="focus-ring inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:text-fg-base"
                        >
                          {isExpanded ? (
                            <ChevronDown size={11} aria-hidden="true" />
                          ) : (
                            <ChevronRight size={11} aria-hidden="true" />
                          )}
                        </button>
                      ) : (
                        <span className="inline-block h-5 w-5 shrink-0" aria-hidden="true" />
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          const name = table.sqlName ?? table.name;
                          if (table.schemaName !== undefined) {
                            onInsertTable(name, table.schemaName);
                          } else {
                            onInsertTable(name);
                          }
                        }}
                        disabled={!canInsert}
                        data-testid="sql-schema-browser-table"
                        data-table-name={table.name}
                        title={t('sqlWorkspace.schema.insertTitle', {
                          name: table.name,
                        })}
                        className={cn(
                          'group flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-body-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                          canInsert
                            ? 'text-fg-muted hover:bg-bg-panel-alt hover:text-fg-base'
                            : 'cursor-not-allowed text-fg-subtle opacity-60'
                        )}
                      >
                        <Database
                          size={11}
                          aria-hidden="true"
                          className="shrink-0 text-accent"
                        />
                        <span className="min-w-0 flex-1 truncate font-mono">
                          {table.name}
                        </span>
                        {columnCount !== undefined ? (
                          <span
                            data-testid="sql-schema-browser-col-count"
                            className="shrink-0 font-mono text-micro tabular-nums text-fg-subtle"
                          >
                            {t('sqlWorkspace.schema.columnCount', {
                              count: columnCount,
                            })}
                          </span>
                        ) : null}
                      </button>
                    </div>
                    {isExpanded ? (
                      <ul
                        role="list"
                        data-testid="sql-schema-browser-columns"
                        className="ml-5 flex flex-col gap-px border-l border-border-subtle pl-2 pt-0.5"
                      >
                        {columns!.map((column) => (
                          <li
                            key={column.name}
                            data-testid="sql-schema-browser-column"
                            data-column-name={column.name}
                            className="flex items-center gap-2 px-2 py-0.5 text-caption"
                          >
                            <span className="min-w-0 flex-1 truncate font-mono text-fg-muted">
                              {column.name}
                            </span>
                            <span className="shrink-0 font-mono text-micro uppercase tracking-[0.08em] text-fg-subtle">
                              {column.type}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
