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
  /**
   * RL-097 (SQL import) fold F — import a dropped or picked file as a
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

  // RL-097 (SQL import) fold F — the import affordance. A real <button>
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
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-bg-panel-alt text-fg-subtle transition-colors hover:border-border-strong hover:bg-bg-panel hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50"
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
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-bg-panel-alt text-fg-subtle transition-colors hover:border-border-strong hover:bg-bg-panel hover:text-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50"
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
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImportFile(file, 'picker');
              // Reset so picking the same file twice still fires change.
              event.target.value = '';
            }}
          />
        ) : null}
      </header>
      {/* RL-097 Slice 3 (SQL OPFS) — storage-backing chip. Always
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
          {/* RL-097 (SQL import) fold F — additive drag-drop target.
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
                      'group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-body-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
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
                        className="shrink-0 font-mono text-micro tabular-nums text-fg-subtle"
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
