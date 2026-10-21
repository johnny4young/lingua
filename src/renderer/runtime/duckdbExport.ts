import { splitSqlStatements } from '../../shared/sqlStatements';
import type { SqlColumnMetadata } from '../../shared/sqlWorkspace';
import { executeQuery, getDuckDbEngine, type DuckDbExecuteOutcome, type ExecuteQueryOptions } from './duckdbClient';

/** A full-result export that DuckDB stopped, refused or could not run. */
export class SqlExportError extends Error {
  constructor(
    readonly status: DuckDbExecuteOutcome['status'] | 'unsupported',
    message: string
  ) {
    super(message);
    this.name = 'SqlExportError';
  }
}

const failure = (outcome: DuckDbExecuteOutcome) =>
  new SqlExportError(outcome.status, outcome.errorMessage ?? outcome.status);

/** The statement without its semicolon or what follows it, so it can sit inside parentheses. */
const asSubquery = (sql: string) => splitSqlStatements(sql)[0]?.text ?? sql.trim();

/**
 * Writes the whole result with `COPY (sql) TO` into a virtual file and
 * returns its bytes. `copyOptions` is the option list inside `( … )`.
 */
export async function copyQueryToBytes(
  sql: string,
  copyOptions: string,
  extension: string,
  options: ExecuteQueryOptions = {}
): Promise<{ bytes: Uint8Array; rowCount: number }> {
  const engine = await getDuckDbEngine();
  if (!engine.registerEmptyFile || !engine.readFile) {
    throw new SqlExportError('unsupported', 'This engine cannot write files');
  }
  const name = `lingua_export_${crypto.randomUUID()}.${extension}`;
  await engine.registerEmptyFile(name);
  try {
    // The newline keeps a trailing line comment from swallowing the closing parenthesis.
    const outcome = await executeQuery(`COPY (\n${asSubquery(sql)}\n) TO '${name}' (${copyOptions})`, options);
    if (outcome.status !== 'success') throw failure(outcome);
    const count = Number(outcome.rows[0]?.['Count'] ?? Number.NaN);
    const bytes = await engine.readFile(name);
    return { bytes, rowCount: Number.isFinite(count) ? count : 0 };
  } finally {
    await engine.dropFile?.(name).catch(() => {});
  }
}

/**
 * Reads the rows of one read statement until it ends or `cap` rows are in,
 * through the same stream the grid's Load more uses.
 */
export async function streamQueryRows(
  sql: string,
  options: ExecuteQueryOptions & { cap: number; batchSize?: number; onProgress?: (rows: number) => void }
): Promise<{ columns: SqlColumnMetadata[]; rows: Array<Record<string, unknown>>; truncated: boolean }> {
  const { cap, batchSize = 5_000, onProgress, ...query } = options;
  const outcome = await executeQuery(sql, { ...query, keepCursor: true });
  if (outcome.status !== 'success' && outcome.status !== 'too-large') throw failure(outcome);
  let cursor = outcome.cursor;
  const rows = outcome.rows.slice(0, cap);
  let truncated = outcome.rows.length > cap;
  try {
    while (cursor && rows.length < cap) {
      if (query.signal?.aborted) throw new SqlExportError('cancelled', 'Query cancelled');
      onProgress?.(rows.length);
      const next = await cursor.next(Math.min(batchSize, cap - rows.length));
      for (const row of next.rows) rows.push(row);
      if (next.done) cursor = undefined;
    }
    if (cursor) truncated = true;
  } finally {
    await cursor?.close();
  }
  onProgress?.(rows.length);
  return { columns: outcome.columns, rows, truncated };
}
