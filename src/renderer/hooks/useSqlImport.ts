/**
 * Orchestration hook for importing a CSV / JSON /
 * Parquet file as a DuckDB table.
 *
 * Owns the whole flow so the panel + the preview modal stay thin:
 *
 *   1. `startImport(file, source)` — validate type (accept list) + size
 *      (capped) BEFORE reading bytes, read the bytes, run
 *      `previewImportFile`, and open the preview modal with the sample +
 *      a sanitized, de-collided suggested table name.
 *   2. The modal picks a new table (name validated live) or an existing
 *      one, maps file columns onto it, sets CSV header and delimiter (which
 *      re-read the preview), then Confirm → `confirmImport` (runs
 *      `importFileAsTable`, refreshes the Explorer, fires telemetry, pushes
 *      a success notice) or Cancel → `cancelImport` (no table).
 *
 * Every failure path pushes a SPECIFIC translated notice via the
 * tone-safe status helpers, never a silent failure. Only a failed insert into
 * an existing table adds DuckDB's reason as the notice detail. Errors are caught and mapped so a malformed CSV/JSON yields
 * `errorParse` and leaves no table behind (the runtime helpers drop the
 * registered virtual file on settle).
 */

import { useCallback, useState } from 'react';
import {
  MAX_IMPORT_BYTES,
  dedupeTableName,
  detectImportFormat,
  isValidTableName,
  sanitizeTableName,
  type SqlImportFormat,
} from '../../shared/sqlWorkspace';
import {
  DEFAULT_IMPORT_CSV,
  defaultMapping,
  mappingProblem,
  type SqlImportColumnMap,
  type SqlImportCsvOptions,
  type SqlImportTarget,
} from '../../shared/sqlImportPlan';
import type { SqlSchemaTable } from '../components/SqlWorkspace/sqlExplorerModel';
import { duckDbErrorDetail, importFileAsTable, previewImportFile, type ImportPreview } from '../runtime/duckdbClient';
import { trackSqlTableImported, type SqlImportSource } from './sqlWorkspaceTelemetry';
import { pushErrorNotice, pushSuccessNotice } from '../utils/statusNotice';

/** A label for the format, used in the `errorParse` notice interpolation. */
const FORMAT_LABEL: Readonly<Record<SqlImportFormat, string>> = {
  csv: 'CSV',
  json: 'JSON',
  parquet: 'Parquet',
};

/**
 * Open state of the import preview modal. `null` when no import is in
 * flight. Carries everything the modal renders + everything
 * `confirmImport` needs to finish the import without re-reading the file.
 */
interface SqlImportModalState {
  /** Detected format of the file being imported. */
  format: SqlImportFormat;
  /** Original file name (shown in the modal title context, not the table name). */
  fileName: string;
  /** Preview: columns + sample rows + total row count. */
  preview: ImportPreview;
  /** The current (editable) target table name. */
  tableName: string;
  /** The file bytes, retained so Confirm need not re-read the file. */
  bytes: Uint8Array;
  /** Where the import was initiated (drop vs picker), for telemetry. */
  source: SqlImportSource;
  csv: SqlImportCsvOptions;
  /** `new`, or the display name of the existing table that receives the rows. */
  target: { mode: 'new' } | { mode: 'existing'; table: string };
  mapping: SqlImportColumnMap[];
}

interface UseSqlImportArgs {
  /** Names of tables already in the database — used for the collision de-duper. */
  existingTableNames: ReadonlyArray<string>;
  /** Tables an import can add rows to, with their columns and types. */
  tables?: ReadonlyArray<SqlSchemaTable>;
  /** After a successful import: record the table's source format and refresh the Explorer. */
  onImported: (table: { tableName: string; format: SqlImportFormat; created: boolean }) => void;
}

interface UseSqlImportReturn {
  /** The open modal state, or `null` when no import is in flight. */
  modal: SqlImportModalState | null;
  /** True while the file is being read + previewed (before the modal opens). */
  isPreviewing: boolean;
  /** True while `importFileAsTable` is running (Confirm pressed). */
  isImporting: boolean;
  /** Validate + read + preview a file, then open the modal. */
  startImport: (file: File, source: SqlImportSource) => Promise<void>;
  /** Update the editable table name in the open modal. */
  setTableName: (name: string) => void;
  /** Import into a new table, or into the existing table with this display name. */
  setTarget: (target: SqlImportModalState['target']) => void;
  /** Point a file column at a target column, or skip it with `null`. */
  setMapping: (index: number, target: string | null) => void;
  /** Change CSV header or delimiter; the preview is read again. */
  setCsv: (csv: SqlImportCsvOptions) => Promise<void>;
  /** Run the import for the open modal, then close it. */
  confirmImport: () => Promise<void>;
  /** Close the modal without importing (drops the in-flight preview). */
  cancelImport: () => void;
}

/** The plan target for the modal's choice, with the existing table's columns. */
function planTarget(
  modal: SqlImportModalState,
  tables: ReadonlyArray<SqlSchemaTable>
): SqlImportTarget | null {
  if (modal.target.mode === 'new') return { mode: 'new', table: modal.tableName.trim() };
  const chosen = modal.target.table;
  const table = tables.find((candidate) => candidate.name === chosen);
  if (!table) return null;
  return {
    mode: 'existing',
    table: table.sqlName ?? table.name,
    ...(table.schemaName ? { schema: table.schemaName } : {}),
    columns: table.columns ?? [],
  };
}

export function useSqlImport({
  existingTableNames,
  tables = [],
  onImported,
}: UseSqlImportArgs): UseSqlImportReturn {
  const [modal, setModal] = useState<SqlImportModalState | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const startImport = useCallback(
    async (file: File, source: SqlImportSource) => {
      // Type detection from extension, then MIME fallback. An
      // unsupported file never gets read.
      const format = detectImportFormat(file.name, file.type);
      if (format === null) {
        pushErrorNotice('sqlWorkspace.import.errorUnsupported');
        return;
      }

      // Size cap BEFORE reading the bytes into memory.
      if (file.size > MAX_IMPORT_BYTES) {
        pushErrorNotice('sqlWorkspace.import.errorTooLarge', {
          values: { limit: Math.floor(MAX_IMPORT_BYTES / (1024 * 1024)) },
        });
        return;
      }

      // Empty file — nothing to import. Cheaper to catch here than to let
      // `read_*_auto` produce a zero-column table.
      if (file.size === 0) {
        pushErrorNotice('sqlWorkspace.import.errorEmpty');
        return;
      }

      setIsPreviewing(true);
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch {
        setIsPreviewing(false);
        pushErrorNotice('sqlWorkspace.import.errorRead');
        return;
      }

      try {
        const preview = await previewImportFile({
          fileName: file.name,
          format,
          bytes,
        });
        // Sanitize + de-collide against the live table set so the
        // pre-filled name does not clobber an existing table.
        const suggested = dedupeTableName(sanitizeTableName(file.name), existingTableNames);
        setModal({
          format,
          fileName: file.name,
          preview,
          tableName: suggested,
          bytes,
          source,
          csv: DEFAULT_IMPORT_CSV,
          target: { mode: 'new' },
          mapping: defaultMapping(preview.columns, { mode: 'new', table: suggested }),
        });
      } catch {
        // DuckDB threw parsing the file (malformed CSV/JSON, corrupt
        // Parquet). The runtime helper already dropped the registered
        // virtual file; surface a specific notice and create no table.
        pushErrorNotice('sqlWorkspace.import.errorParse', {
          values: { format: FORMAT_LABEL[format] },
        });
      } finally {
        setIsPreviewing(false);
      }
    },
    [existingTableNames]
  );

  const setTableName = useCallback((name: string) => {
    setModal(prev => (prev === null ? prev : { ...prev, tableName: name }));
  }, []);

  const setTarget = useCallback(
    (target: SqlImportModalState['target']) => {
      setModal((prev) => {
        if (prev === null) return prev;
        const next = { ...prev, target };
        const plan = planTarget(next, tables);
        return { ...next, mapping: plan ? defaultMapping(prev.preview.columns, plan) : prev.mapping };
      });
    },
    [tables]
  );

  const setMapping = useCallback((index: number, target: string | null) => {
    setModal((prev) =>
      prev === null
        ? prev
        : { ...prev, mapping: prev.mapping.map((entry, i) => (i === index ? { ...entry, target } : entry)) }
    );
  }, []);

  const setCsv = useCallback(
    async (csv: SqlImportCsvOptions) => {
      const current = modal;
      if (current === null || current.format !== 'csv') return;
      setIsPreviewing(true);
      try {
        const preview = await previewImportFile({ fileName: current.fileName, format: 'csv', bytes: current.bytes, csv });
        setModal((prev) => {
          if (prev === null) return prev;
          const next = { ...prev, csv, preview };
          const plan = planTarget(next, tables);
          return { ...next, mapping: plan ? defaultMapping(preview.columns, plan) : next.mapping };
        });
      } catch {
        pushErrorNotice('sqlWorkspace.import.errorParse', { values: { format: FORMAT_LABEL.csv } });
      } finally {
        setIsPreviewing(false);
      }
    },
    [modal, tables]
  );

  const cancelImport = useCallback(() => {
    // No engine state to release — `previewImportFile` already dropped the
    // registered virtual file when it resolved. Just close the modal.
    setModal(null);
  }, []);

  const confirmImport = useCallback(async () => {
    const current = modal;
    if (current === null) return;
    const tableName = current.tableName.trim();
    if (current.target.mode === 'new') {
      const tableNameTaken = existingTableNames.some(
        existing => existing.toLowerCase() === tableName.toLowerCase()
      );
      if (!isValidTableName(tableName) || tableNameTaken) {
        pushErrorNotice(
          tableNameTaken ? 'sqlWorkspace.import.nameTaken' : 'sqlWorkspace.import.invalidName'
        );
        return;
      }
    }
    const target = planTarget(current, tables);
    if (target === null || mappingProblem(current.mapping) !== null) {
      pushErrorNotice('sqlWorkspace.import.mappingInvalid');
      return;
    }
    setIsImporting(true);
    try {
      const result = await importFileAsTable({
        fileName: current.fileName,
        tableName,
        format: current.format,
        bytes: current.bytes,
        csv: current.csv,
        target,
        mapping: current.mapping,
      });
      setModal(null);
      // Telemetry: closed-enum format + source only.
      trackSqlTableImported(current.format, current.source);
      pushSuccessNotice(target.mode === 'new' ? 'sqlWorkspace.import.success' : 'sqlWorkspace.import.successInto', {
        values: { name: result.table, count: result.rowCount },
      });
      onImported({ tableName: result.table, format: current.format, created: target.mode === 'new' });
    } catch (err) {
      // The DDL threw — no table was created (the helper dropped the
      // virtual file). Keep the modal open so the user can adjust + retry.
      // Classify a name collision honestly instead of blaming the file:
      // a table persisted in OPFS from a previous session can collide
      // even when the (possibly stale) pre-flight list missed it.
      const message = err instanceof Error ? err.message : String(err ?? '');
      if (target.mode === 'existing') {
        // The insert ran in one transaction that rolled back; DuckDB's reason names the column to fix.
        const detail = duckDbErrorDetail(err);
        pushErrorNotice('sqlWorkspace.import.errorInsert', { values: { name: target.table }, ...(detail ? { detail } : {}) });
        return;
      }
      const isCollision = /already exists/i.test(message);
      pushErrorNotice(
        isCollision ? 'sqlWorkspace.import.nameTaken' : 'sqlWorkspace.import.errorParse',
        {
          ...(isCollision ? {} : { values: { format: FORMAT_LABEL[current.format] } }),
        }
      );
    } finally {
      setIsImporting(false);
    }
  }, [existingTableNames, modal, onImported, tables]);

  return {
    modal,
    isPreviewing,
    isImporting,
    startImport,
    setTableName,
    setTarget,
    setMapping,
    setCsv,
    confirmImport,
    cancelImport,
  };
}
