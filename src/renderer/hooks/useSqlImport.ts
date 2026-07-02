/**
 * RL-097 (SQL import) — orchestration hook for importing a CSV / JSON /
 * Parquet file as a DuckDB table.
 *
 * Owns the whole flow so the panel + the preview modal stay thin:
 *
 *   1. `startImport(file, source)` — validate type (fold A accept) + size
 *      (fold E cap) BEFORE reading bytes, read the bytes, run
 *      `previewImportFile`, and open the preview modal with the sample +
 *      a sanitized, de-collided (fold C) suggested table name.
 *   2. The modal lets the user edit the name (validated live) and either
 *      Confirm → `confirmImport` (runs `importFileAsTable`, refreshes the
 *      schema browser, fires telemetry fold B, pushes a success notice) or
 *      Cancel → `cancelImport` (drops the in-flight preview; no table).
 *
 * Every failure path pushes a SPECIFIC translated notice via
 * `pushStatusNotice` — never a raw DuckDB error string, never a silent
 * failure. Errors are caught and mapped so a malformed CSV/JSON yields
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
  importFileAsTable,
  previewImportFile,
  type ImportPreview,
} from '../runtime/duckdbClient';
import {
  trackSqlTableImported,
  type SqlImportSource,
} from './sqlWorkspaceTelemetry';
import { useUIStore } from '../stores/uiStore';

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
export interface SqlImportModalState {
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
}

interface UseSqlImportArgs {
  /** Names of tables already in the database — used for the collision de-duper. */
  existingTableNames: ReadonlyArray<string>;
  /** Re-run the schema browser introspection after a successful import. */
  onImported: () => void;
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
  /** Run the import for the open modal, then close it. */
  confirmImport: () => Promise<void>;
  /** Close the modal without importing (drops the in-flight preview). */
  cancelImport: () => void;
}

export function useSqlImport({
  existingTableNames,
  onImported,
}: UseSqlImportArgs): UseSqlImportReturn {
  const [modal, setModal] = useState<SqlImportModalState | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const startImport = useCallback(
    async (file: File, source: SqlImportSource) => {
      const pushStatusNotice = useUIStore.getState().pushStatusNotice;

      // Fold A — type detection from extension, then MIME fallback. An
      // unsupported file never gets read.
      const format = detectImportFormat(file.name, file.type);
      if (format === null) {
        pushStatusNotice({
          tone: 'error',
          messageKey: 'sqlWorkspace.import.errorUnsupported',
        });
        return;
      }

      // Fold E — size cap BEFORE reading the bytes into memory.
      if (file.size > MAX_IMPORT_BYTES) {
        pushStatusNotice({
          tone: 'error',
          messageKey: 'sqlWorkspace.import.errorTooLarge',
          values: { limit: Math.floor(MAX_IMPORT_BYTES / (1024 * 1024)) },
        });
        return;
      }

      // Empty file — nothing to import. Cheaper to catch here than to let
      // `read_*_auto` produce a zero-column table.
      if (file.size === 0) {
        pushStatusNotice({
          tone: 'error',
          messageKey: 'sqlWorkspace.import.errorEmpty',
        });
        return;
      }

      setIsPreviewing(true);
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch {
        setIsPreviewing(false);
        pushStatusNotice({
          tone: 'error',
          messageKey: 'sqlWorkspace.import.errorRead',
        });
        return;
      }

      try {
        const preview = await previewImportFile({
          fileName: file.name,
          format,
          bytes,
        });
        // Fold C — sanitize + de-collide against the live table set so the
        // pre-filled name does not clobber an existing table.
        const suggested = dedupeTableName(
          sanitizeTableName(file.name),
          existingTableNames
        );
        setModal({
          format,
          fileName: file.name,
          preview,
          tableName: suggested,
          bytes,
          source,
        });
      } catch {
        // DuckDB threw parsing the file (malformed CSV/JSON, corrupt
        // Parquet). The runtime helper already dropped the registered
        // virtual file; surface a specific notice and create no table.
        pushStatusNotice({
          tone: 'error',
          messageKey: 'sqlWorkspace.import.errorParse',
          values: { format: FORMAT_LABEL[format] },
        });
      } finally {
        setIsPreviewing(false);
      }
    },
    [existingTableNames]
  );

  const setTableName = useCallback((name: string) => {
    setModal((prev) => (prev === null ? prev : { ...prev, tableName: name }));
  }, []);

  const cancelImport = useCallback(() => {
    // No engine state to release — `previewImportFile` already dropped the
    // registered virtual file when it resolved. Just close the modal.
    setModal(null);
  }, []);

  const confirmImport = useCallback(async () => {
    const current = modal;
    if (current === null) return;
    const tableName = current.tableName.trim();
    const pushStatusNotice = useUIStore.getState().pushStatusNotice;
    const tableNameTaken = existingTableNames.some(
      (existing) => existing.toLowerCase() === tableName.toLowerCase()
    );
    if (!isValidTableName(tableName) || tableNameTaken) {
      pushStatusNotice({
        tone: 'error',
        messageKey: tableNameTaken
          ? 'sqlWorkspace.import.nameTaken'
          : 'sqlWorkspace.import.invalidName',
      });
      return;
    }
    setIsImporting(true);
    try {
      const result = await importFileAsTable({
        fileName: current.fileName,
        tableName,
        format: current.format,
        bytes: current.bytes,
      });
      setModal(null);
      // Fold B — telemetry: closed-enum format + source only.
      trackSqlTableImported(current.format, current.source);
      pushStatusNotice({
        tone: 'success',
        messageKey: 'sqlWorkspace.import.success',
        values: { name: result.table, count: result.rowCount },
      });
      onImported();
    } catch (err) {
      // The DDL threw — no table was created (the helper dropped the
      // virtual file). Keep the modal open so the user can adjust + retry.
      // Classify a name collision honestly instead of blaming the file:
      // a table persisted in OPFS from a previous session can collide
      // even when the (possibly stale) pre-flight list missed it.
      const message = err instanceof Error ? err.message : String(err ?? '');
      const isCollision = /already exists/i.test(message);
      pushStatusNotice({
        tone: 'error',
        messageKey: isCollision
          ? 'sqlWorkspace.import.nameTaken'
          : 'sqlWorkspace.import.errorParse',
        ...(isCollision
          ? {}
          : { values: { format: FORMAT_LABEL[current.format] } }),
      });
    } finally {
      setIsImporting(false);
    }
  }, [existingTableNames, modal, onImported]);

  return {
    modal,
    isPreviewing,
    isImporting,
    startImport,
    setTableName,
    confirmImport,
    cancelImport,
  };
}
