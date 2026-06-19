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
  HardDrive,
  RefreshCw,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';
import type { SqlStorageMode } from '../../../shared/sqlWorkspace';

/**
 * One discovered session table. `columnCount` is optional — the
 * parent only computes it when cheap (a single `PRAGMA table_info`
 * per table on the same connection). `undefined` hides the chip.
 */
export interface SqlSchemaTable {
  name: string;
  columnCount?: number;
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
  onInsertTable: (name: string) => void;
  /** Whether a query is active to receive the inserted starter. */
  canInsert: boolean;
  /**
   * RL-097 Slice 3 (SQL OPFS) — resolved storage backing of the live
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
   * Fold C — approximate origin storage label (e.g. `~12 MB`), shown
   * next to the persistent chip. `null` hides it.
   */
  storageUsageLabel?: string | null;
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
}: SqlSchemaBrowserProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  // RL-097 Slice 3 (SQL OPFS) — the chip label depends on BOTH the
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
          <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
            {t('sqlWorkspace.schema.label')}
          </span>
          {tables.length > 0 ? (
            <span
              data-testid="sql-schema-browser-count"
              className="ml-1 rounded-sm bg-bg-panel-alt px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-fg-muted"
            >
              {tables.length}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          aria-label={t('sqlWorkspace.schema.refresh')}
          title={t('sqlWorkspace.schema.refresh')}
          data-testid="sql-schema-browser-refresh"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-bg-panel-alt text-fg-subtle transition-colors hover:border-border-strong hover:bg-bg-panel hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw
            size={11}
            aria-hidden="true"
            className={isLoading ? 'animate-spin' : undefined}
          />
        </button>
      </header>
      {/* RL-097 Slice 3 (SQL OPFS) — storage-backing chip. Always
          visible (even collapsed) so the persistence state is never
          hidden. */}
      <div
        data-testid="sql-schema-browser-storage"
        data-storage-mode={storageMode}
        className="flex items-center gap-1.5 px-2.5 pb-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-fg-subtle"
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
          {tables.length === 0 ? (
            <p
              data-testid="sql-schema-browser-empty"
              className="px-1.5 py-1.5 text-[10.5px] leading-relaxed text-fg-subtle"
            >
              {t('sqlWorkspace.schema.empty')}
            </p>
          ) : (
            <ul role="list" className="flex flex-col gap-0.5">
              {tables.map((table) => (
                <li key={table.name}>
                  <button
                    type="button"
                    onClick={() => onInsertTable(table.name)}
                    disabled={!canInsert}
                    data-testid="sql-schema-browser-table"
                    data-table-name={table.name}
                    title={t('sqlWorkspace.schema.insertTitle', {
                      name: table.name,
                    })}
                    className={cn(
                      'group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
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
                    {table.columnCount !== undefined ? (
                      <span
                        data-testid="sql-schema-browser-col-count"
                        className="shrink-0 font-mono text-[9.5px] tabular-nums text-fg-subtle"
                      >
                        {t('sqlWorkspace.schema.columnCount', {
                          count: table.columnCount,
                        })}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
