/**
 * Copy to Local: runs a read statement on a connection again, reads every
 * row through the bridge's cursor up to the full-export caps, and fills a
 * new Local DuckDB table batch by batch.
 */

import type { SqlDbBridge } from '../../shared/sqlDb';
import { localCopyColumns, LocalCopyValueError } from '../../shared/sqlCopyToLocal';
import { MAX_RESULT_PREVIEW_BYTES } from '../../shared/sqlWorkspace';
import { FULL_EXPORT_BYTE_CAP, FULL_EXPORT_CELL_CAP, FULL_EXPORT_ROW_CAP } from '../components/SqlWorkspace/sqlFullExport';
import { copyBatchesIntoTable } from './duckdbClient';
import { executeRemoteScript } from './sqlRemote';

/** A batch goes to DuckDB at this many rows or bytes, whichever comes first, so wide rows stay bounded too. */
export const COPY_BATCH_ROWS = 50_000;
const COPY_BATCH_BYTES = 32 * 1024 * 1024;
const PAGE_ROWS = 10_000;

export interface CopyToLocalResult {
  rowCount: number;
  /** The result had more rows than the caps allow; the table holds the first ones. */
  truncated: boolean;
}

export class CopyToLocalError extends Error {
  constructor(
    message: string,
    readonly cancelled = false,
    /** The column whose value its type could not hold. */
    readonly value?: { column: string; type: string },
    /** A column name the result has more than once. */
    readonly repeated?: string
  ) {
    super(message);
  }
}

export async function copyConnectionResultToLocal(args: {
  db: SqlDbBridge;
  connectionId: string;
  connectionName: string;
  sql: string;
  table: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onProgress?: (rows: number) => void;
  now?: () => Date;
}): Promise<CopyToLocalResult> {
  const { db, signal } = args;
  const [outcome] = await executeRemoteScript(db, args.connectionId, [args.sql], { timeoutMs: args.timeoutMs, keepCursor: true, ...(signal ? { signal } : {}) });
  if (signal?.aborted) {
    await outcome?.cursor?.close();
    throw new CopyToLocalError('The copy was cancelled.', true);
  }
  if (!outcome || (outcome.status !== 'success' && outcome.status !== 'too-large')) {
    throw new CopyToLocalError(outcome?.errorMessage ?? 'The connection did not return rows.', outcome?.status === 'cancelled');
  }
  const cursor = outcome.cursor;
  const sourceNames = outcome.columns.map((column) => column.name);
  // Rows are keyed by column name, so two columns of one name hold a single value.
  const repeated = sourceNames.find((name, index) => sourceNames.indexOf(name) !== index);
  if (repeated !== undefined) {
    await cursor?.close().catch(() => undefined);
    throw new CopyToLocalError(`Two columns are named ${repeated}.`, false, undefined, repeated);
  }
  const columns = localCopyColumns(outcome.columns);
  const perRow = Math.max(1, columns.length);
  const rowCap = Math.min(FULL_EXPORT_ROW_CAP, Math.floor(FULL_EXPORT_CELL_CAP / perRow));
  let read = 0;
  let bytes = 0;
  let truncated = false;

  async function* batches(): AsyncGenerator<Array<Record<string, unknown>>> {
    let batch: Array<Record<string, unknown>> = [];
    let batchBytes = 0;
    const take = (rows: ReadonlyArray<Record<string, unknown>>, rowBytes: number) => {
      batchBytes += rowBytes;
      const room = rowCap - read;
      const kept = rows.length > room ? rows.slice(0, room) : rows;
      if (kept.length < rows.length) truncated = true;
      batch.push(...kept);
      read += kept.length;
      bytes += rowBytes;
      if (bytes > FULL_EXPORT_BYTE_CAP) truncated = true;
      args.onProgress?.(read);
    };
    // The first window already fits the preview's byte budget.
    take(outcome!.rows, Math.min(MAX_RESULT_PREVIEW_BYTES, outcome!.rows.length * perRow * 16));
    let done = !cursor;
    while (!done && !truncated) {
      if (signal?.aborted) return;
      if (batch.length >= COPY_BATCH_ROWS || batchBytes >= COPY_BATCH_BYTES) {
        yield batch;
        batch = [];
        batchBytes = 0;
      }
      const page = await cursor!.next(PAGE_ROWS);
      take(page.rows, page.bytes);
      done = page.done;
    }
    if (batch.length > 0) yield batch;
  }

  // Cancel stops the run on the server at once, without waiting for the page in flight.
  const stop = () => void cursor?.close().catch(() => undefined);
  signal?.addEventListener('abort', stop, { once: true });
  try {
    const { rowCount } = await copyBatchesIntoTable({
      table: args.table,
      columns,
      sourceNames,
      batches: batches(),
      origin: { connection: args.connectionName, at: (args.now?.() ?? new Date()).toISOString() },
      ...(signal ? { signal } : {}),
    });
    return { rowCount, truncated };
  } catch (err) {
    if (signal?.aborted) throw new CopyToLocalError('The copy was cancelled.', true);
    if (err instanceof LocalCopyValueError) throw new CopyToLocalError(err.message, false, { column: err.column, type: err.type });
    throw new CopyToLocalError(err instanceof Error ? err.message : String(err));
  } finally {
    signal?.removeEventListener('abort', stop);
    await cursor?.close().catch(() => undefined);
  }
}
