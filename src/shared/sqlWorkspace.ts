/**
 * RL-097 Slice 2 — SQL workspace schema (DuckDB-WASM).
 *
 * Mirror of `httpWorkspace.ts` for the SQL companion tab. Two
 * versioned shapes:
 *
 *   - `SqlQueryV1` — user-editable query: name + text. Persisted in
 *     `workspaceSqlStore` (CRUD identical to `workspaceToolStore` so
 *     RL-099 Utility Pipelines can iterate over both stores
 *     uniformly).
 *   - `SqlResponseV1` — the result of a query execution. Wrapped
 *     into a `RunCapsuleV1` via `sqlResponseCapsule.ts` so share /
 *     CLI / AI surfaces inherit the existing capsule redaction +
 *     size discipline.
 *
 * Both shapes are pure data — no side effects, no IPC. The runtime
 * layer at `src/renderer/runtime/duckdbClient.ts` consumes the query
 * text and produces the response.
 *
 * Privacy posture:
 *
 *   - Result rows + column metadata are user-supplied content, but
 *     they live ONLY in localStorage of the user's device and never
 *     leave it unless the user explicitly exports a capsule. The
 *     sanitiser in `sqlResponseCapsule.ts` runs the row preview
 *     through the existing capsule sanitiser before any export.
 *   - Caps prevent both DoS and storage exhaustion: 256 KiB on the
 *     query text, 10 000 rows × 256 KiB preview on the result.
 *   - Telemetry events emit ONLY closed-enum status, row-count
 *     bucket, and duration bucket — no query text, no schema names,
 *     no column names on the wire.
 */

/**
 * Closed enum of SQL outcomes Slice 2 surfaces. Aligned with the
 * `RunCapsuleStatus` slots so the capsule mapping is trivial.
 *
 * Mirrored on `update-server/src/telemetry.ts` as `SQL_QUERY_STATUSES`
 * with a parity test.
 */
export const SQL_QUERY_STATUSES = [
  'success',
  'sql-error',
  'timeout',
  'too-large',
  'engine-load-failed',
] as const;
export type SqlQueryStatus = (typeof SQL_QUERY_STATUSES)[number];

/**
 * Closed enum for the `durationBucket` property on the
 * `sql.query_executed` telemetry event. Buckets the wall-clock
 * duration into coarse-grained classes so dashboards group by
 * shape (fast / slow / very-slow) without leaking the exact
 * timing.
 *
 * Mirrored on `update-server/src/telemetry.ts` with a parity test.
 */
export const SQL_DURATION_BUCKETS = [
  '<10ms',
  '<100ms',
  '<1s',
  '<5s',
  '<30s',
  '>=30s',
] as const;
export type SqlDurationBucket = (typeof SQL_DURATION_BUCKETS)[number];

/** Hard cap on the query text. 256 KiB. */
export const MAX_QUERY_BYTES = 256 * 1024;

/**
 * Hard cap on the result preview row count. A 100k-row result blows
 * up the renderer; the 10k cap keeps Monaco + the table renderer
 * responsive while still being enough for visualization sanity
 * checks.
 */
export const MAX_RESULT_ROWS = 10_000;

/**
 * Hard cap on the result preview JSON size. Even within the 10k row
 * limit, a single row with megabyte-sized BLOBs can blow up memory.
 * 256 KiB is enough for the columnar view + JSON tree without
 * over-allocating.
 */
export const MAX_RESULT_PREVIEW_BYTES = 256 * 1024;

/** Default query timeout (30 s). User can override per query, capped at 5 min. */
export const DEFAULT_QUERY_TIMEOUT_MS = 30_000;
export const MAX_QUERY_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * RL-097 Slice 3 (SQL OPFS) — where the persistent DuckDB database
 * file lives in the origin's OPFS (Origin Private File System) when
 * the user opts into table persistence. The `opfs://` protocol is
 * understood natively by `@duckdb/duckdb-wasm`'s `db.open({ path })`.
 * Single fixed name — one persistent database per origin; switching
 * databases is out of scope for this slice.
 */
export const OPFS_SQL_DB_PATH = 'opfs://lingua-sql.db';

/**
 * RL-097 Slice 3 (SQL OPFS) — resolved storage backing of the live
 * DuckDB session.
 *
 *   - `'opfs'`   — the database is persisted to OPFS; tables + rows
 *                  survive a reload / app restart.
 *   - `'memory'` — the database lives only in the worker heap and is
 *                  discarded on reload. This is the default and the
 *                  fallback whenever persistence is off or OPFS is
 *                  unavailable (old Safari, private mode, a cross-tab
 *                  lock, or an `open` failure).
 *
 * This is the *resolved* mode, not the user's *requested* preference:
 * a user who toggled persistence on but whose browser lacks OPFS
 * resolves to `'memory'`. The renderer compares requested vs resolved
 * to surface a "storage unavailable" hint.
 */
export type SqlStorageMode = 'opfs' | 'memory';

/** Closed enum of {@link SqlStorageMode} values — source of truth. */
export const SQL_STORAGE_MODES: readonly SqlStorageMode[] = ['opfs', 'memory'];

// ---------------------------------------------------------------------------
// RL-097 (SQL import) — file → DuckDB table import helpers.
//
// Pure, side-effect-free helpers shared by the renderer import flow and
// its unit tests. The renderer's `duckdbClient` registers the file bytes
// and runs `read_csv_auto` / `read_json_auto` / `read_parquet`; these
// helpers own the format detection, identifier sanitisation, and the
// collision de-duper so all the messy string logic stays unit-testable
// outside the DuckDB engine.
// ---------------------------------------------------------------------------

/**
 * Closed enum of file formats the SQL import flow accepts. Each maps to
 * a DuckDB `read_*` reader in `duckdbClient.importFileAsTable`:
 *
 *   - `'csv'`     → `read_csv_auto`  (UTF-8 text buffer)
 *   - `'json'`    → `read_json_auto` (JSON array OR newline-delimited)
 *   - `'parquet'` → `read_parquet`   (binary columnar buffer)
 *
 * Parquet is statically linked into the bundled `@duckdb/duckdb-wasm`
 * MVP WASM (verified: the `read_parquet` / `parquet_scan` symbols are
 * present in `duckdb-mvp.wasm`), so no runtime extension load is needed.
 *
 * INVARIANT: the renderer must never advertise, accept, or run a format
 * outside this list — adding one requires verifying the reader exists in
 * the shipped WASM bundle first.
 */
export type SqlImportFormat = 'csv' | 'json' | 'parquet';

/**
 * Source of truth for the accepted import formats. Drives the file
 * picker `accept` predicate AND the accept-attribute string, so the two
 * can never drift. Iteration order is irrelevant.
 */
export const SUPPORTED_IMPORT_FORMATS: readonly SqlImportFormat[] = [
  'csv',
  'json',
  'parquet',
];

/**
 * Hard cap on the byte size of an imported file. 25 MiB. Enforced
 * BEFORE the file bytes are read into memory so an oversized drop is
 * rejected cheaply (the `File.size` check), never after a multi-hundred-
 * MB `arrayBuffer()` has already blown the renderer heap. Mirrors the
 * size discipline of the result-preview caps above.
 */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

/**
 * Map of file extension → import format. Lower-cased extension WITHOUT
 * the leading dot. `.jsonl` / `.ndjson` route to `'json'` because
 * `read_json_auto` handles newline-delimited JSON as well as arrays.
 */
const IMPORT_EXTENSION_MAP: Readonly<Record<string, SqlImportFormat>> = {
  csv: 'csv',
  json: 'json',
  jsonl: 'json',
  ndjson: 'json',
  parquet: 'parquet',
  pq: 'parquet',
};

/**
 * Map of MIME type → import format, used as a fallback when a file has
 * no usable extension (a drag-drop of a blob, or a renamed file). Kept
 * deliberately small — only the MIME types browsers reliably set for
 * these formats. `application/x-ndjson` covers newline-delimited JSON.
 */
const IMPORT_MIME_MAP: Readonly<Record<string, SqlImportFormat>> = {
  'text/csv': 'csv',
  'application/csv': 'csv',
  'application/json': 'json',
  'text/json': 'json',
  'application/x-ndjson': 'json',
  'application/x-parquet': 'parquet',
  'application/vnd.apache.parquet': 'parquet',
};

/**
 * Native file-picker `accept` string for the SQL import inputs. Mirrors
 * the extension + MIME maps above so the keyboard picker advertises the
 * same formats `detectImportFormat` accepts at runtime.
 */
export const SQL_IMPORT_FILE_ACCEPT =
  '.csv,.json,.jsonl,.ndjson,.parquet,.pq,text/csv,application/csv,application/json,text/json,application/x-ndjson,application/x-parquet,application/vnd.apache.parquet';

/**
 * Detect the import format for a file from its name (extension first)
 * and, failing that, its MIME type. Returns `null` when neither yields a
 * supported format — the caller surfaces an "unsupported file" notice and
 * imports nothing. Pure: no IO, no engine.
 *
 *   - `data.CSV`            → `'csv'`   (case-insensitive)
 *   - `events.jsonl`        → `'json'`
 *   - `blob` + `text/csv`   → `'csv'`   (extension-less, MIME fallback)
 *   - `notes.txt`           → `null`    (unsupported)
 */
export function detectImportFormat(
  fileName: string,
  mimeType?: string | null
): SqlImportFormat | null {
  const dot = fileName.lastIndexOf('.');
  if (dot !== -1 && dot < fileName.length - 1) {
    const ext = fileName.slice(dot + 1).toLowerCase();
    const byExt = IMPORT_EXTENSION_MAP[ext];
    if (byExt !== undefined) return byExt;
  }
  if (typeof mimeType === 'string' && mimeType.length > 0) {
    // MIME types can carry a `; charset=…` suffix — match on the base.
    const base = mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
    const byMime = IMPORT_MIME_MAP[base];
    if (byMime !== undefined) return byMime;
  }
  return null;
}

/**
 * Derive a valid DuckDB table identifier from a file name. The result is
 * always non-empty and safe to splice into `CREATE TABLE <ident> AS …`
 * after double-quote escaping at the call site.
 *
 * Transform (in order):
 *
 *   1. Strip the directory path + the file extension (`a/b/Sales.csv`
 *      → `Sales`).
 *   2. Lower-case.
 *   3. Replace every run of non `[a-z0-9_]` characters with a single
 *      `_` (spaces, dots, unicode, punctuation all collapse).
 *   4. Trim leading/trailing `_`.
 *   5. Fall back to `table` when nothing survives (the result is empty).
 *   6. Prefix `t_` when the result starts with a digit (DuckDB
 *      identifiers may not begin with a digit). The `table` fallback
 *      never starts with a digit, so it is returned as-is.
 *
 * Examples:
 *
 *   - `Q1 Sales.csv`     → `q1_sales`
 *   - `2024-report.json` → `t_2024_report`
 *   - `café data.csv`    → `caf_data`
 *   - `🙂.csv`           → `table`  (nothing survives → fallback)
 *
 * The result is NOT collision-checked here — pair it with
 * {@link dedupeTableName} against the live table set.
 */
export function sanitizeTableName(fileName: string): string {
  // Strip any directory component first so a path separator never leaks
  // into the identifier.
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  let cleaned = stem
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (cleaned.length === 0) cleaned = 'table';
  if (/^[0-9]/.test(cleaned)) cleaned = `t_${cleaned}`;
  return cleaned;
}

/**
 * Resolve a collision-free table name given the set of names already in
 * the database. Returns `name` unchanged when free; otherwise appends
 * the lowest available `_N` suffix starting at `_2`:
 *
 *   - `sales` (free)              → `sales`
 *   - `sales` (taken)             → `sales_2`
 *   - `sales`, `sales_2` (taken)  → `sales_3`
 *
 * Comparison is case-insensitive because DuckDB identifiers are
 * case-insensitive unless quoted-and-mixed; this avoids `Sales` and
 * `sales` silently clobbering one another. The returned name preserves
 * the lower-cased form produced by {@link sanitizeTableName}.
 */
export function dedupeTableName(
  name: string,
  existingNames: Iterable<string>
): string {
  const taken = new Set<string>();
  for (const existing of existingNames) {
    taken.add(existing.toLowerCase());
  }
  if (!taken.has(name.toLowerCase())) return name;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${name}_${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Validate a user-edited table name from the import preview modal.
 * Mirrors the contract DuckDB enforces on an unquoted identifier so the
 * modal can disable Import + show an inline hint live, BEFORE a bad name
 * reaches `CREATE TABLE`:
 *
 *   - non-empty after trimming
 *   - matches `^[A-Za-z_][A-Za-z0-9_]*$`
 *
 * Returns `true` only for a name safe to splice into the DDL.
 */
export function isValidTableName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name.trim());
}

/** UTF-8 byte count helper. Matches `utf8ByteLength` in httpWorkspace.ts. */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Bucket a wall-clock duration into the closed-enum bucket. Used by
 * the telemetry helper + by tests verifying the bucketing contract.
 * `<0` is defensive — should never happen for a real Date.now() diff.
 */
export function bucketSqlDuration(durationMs: number): SqlDurationBucket {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '<10ms';
  if (durationMs < 10) return '<10ms';
  if (durationMs < 100) return '<100ms';
  if (durationMs < 1_000) return '<1s';
  if (durationMs < 5_000) return '<5s';
  if (durationMs < 30_000) return '<30s';
  return '>=30s';
}

/**
 * One column in a result set. `type` carries the DuckDB SQL type
 * name as a string (e.g. `'INTEGER'`, `'VARCHAR'`, `'DOUBLE'`) so
 * the preview can render type chips alongside header cells.
 */
export interface SqlColumnMetadata {
  name: string;
  type: string;
}

/**
 * A query the user has authored. Mirrors `HttpRequestV1` shape.
 */
export interface SqlQueryV1 {
  /** Hard-coded `1`. `parseSqlQuery` rejects any other value. */
  version: 1;
  /** UUIDv4 from `crypto.randomUUID()`. */
  id: string;
  /** User-editable label shown in the query list. */
  name: string;
  /** Query text. Capped at `MAX_QUERY_BYTES`. */
  query: string;
  /** Optional per-query timeout override. Capped at `MAX_QUERY_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** ISO timestamp (millisecond precision). */
  createdAt: string;
  updatedAt: string;
}

/**
 * The execution result. Mirrors `HttpResponseV1` shape; the
 * `status` field is the SqlQueryStatus closed enum.
 */
export interface SqlResponseV1 {
  /** Hard-coded `1`. `parseSqlResponse` rejects any other value. */
  version: 1;
  /** Closed-enum outcome. */
  status: SqlQueryStatus;
  /**
   * Row preview as JSON-serialisable values. Cell values are the
   * direct JSON projection of the DuckDB row (numbers stay numbers;
   * strings stay strings; BigInts come back as strings to preserve
   * precision when serialised; null is null). Capped at
   * `MAX_RESULT_ROWS` entries and `MAX_RESULT_PREVIEW_BYTES` total.
   */
  rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Column metadata for the result set. Empty for DDL / 0-row results. */
  columns: ReadonlyArray<SqlColumnMetadata>;
  /**
   * Total row count from DuckDB. Equals `rows.length` for results
   * under the cap; exceeds it when `tooLarge: true`. The full row
   * set is NOT in `rows` — DuckDB knows the count even when we
   * trimmed the preview.
   */
  rowCount: number;
  /** Wall-clock duration from execute call to settle, in ms. */
  durationMs: number;
  /** Set when the result hit `MAX_RESULT_ROWS` or `MAX_RESULT_PREVIEW_BYTES`. */
  tooLarge: boolean;
  /**
   * Count of statements executed when the user submitted a
   * multi-statement query (`SELECT 1; SELECT 2;`). DuckDB returns
   * only the LAST statement's result, but we surface the count so
   * the UI can render the "N statements executed" badge.
   */
  statementCount: number;
  /** ISO timestamp the response was recorded. */
  recordedAt: string;
  /**
   * Diagnostic message for the failure statuses
   * (`sql-error` / `timeout` / `too-large` / `engine-load-failed`).
   * Absent on `success` (where rows + rowCount carry the signal).
   */
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Parsers — defense in depth at the localStorage rehydrate boundary.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSqlQueryStatus(value: unknown): value is SqlQueryStatus {
  return (
    typeof value === 'string' &&
    (SQL_QUERY_STATUSES as readonly string[]).includes(value)
  );
}

function parseColumn(value: unknown): SqlColumnMetadata | null {
  if (!isRecord(value)) return null;
  if (typeof value.name !== 'string') return null;
  if (typeof value.type !== 'string') return null;
  return { name: value.name, type: value.type };
}

function parseRow(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  // Preserve every key/value pair. No deep validation — cell values
  // are arbitrary JSON-serialisable shapes (numbers, strings, null,
  // arrays, nested objects). The capsule sanitiser does the
  // PII-defense pass at export time.
  return { ...value };
}

/**
 * Strict parser for a persisted query. Returns `null` on ANY shape
 * mismatch so the rehydrate path drops invalid entries silently.
 */
export function parseSqlQuery(value: unknown): SqlQueryV1 | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (typeof value.name !== 'string') return null;
  // Query text can be empty on a blank-template query.
  if (typeof value.query !== 'string') return null;
  if (utf8ByteLength(value.query) > MAX_QUERY_BYTES) return null;
  if (typeof value.createdAt !== 'string') return null;
  if (typeof value.updatedAt !== 'string') return null;
  let timeoutMs: number | undefined;
  if (value.timeoutMs !== undefined) {
    if (typeof value.timeoutMs !== 'number') return null;
    if (!Number.isFinite(value.timeoutMs)) return null;
    if (value.timeoutMs <= 0) return null;
    timeoutMs = Math.min(value.timeoutMs, MAX_QUERY_TIMEOUT_MS);
  }
  return {
    version: 1,
    id: value.id,
    name: value.name,
    query: value.query,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

/**
 * Strict parser for a persisted response. Same null-on-mismatch
 * discipline as `parseSqlQuery`.
 */
export function parseSqlResponse(value: unknown): SqlResponseV1 | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1) return null;
  if (!isSqlQueryStatus(value.status)) return null;
  if (!Array.isArray(value.rows)) return null;
  if (value.rows.length > MAX_RESULT_ROWS) return null;
  const rows: Record<string, unknown>[] = [];
  let previewBytes = 0;
  for (const raw of value.rows) {
    const parsed = parseRow(raw);
    if (parsed === null) return null;
    let serialised: string;
    try {
      serialised = JSON.stringify(parsed);
    } catch {
      return null;
    }
    previewBytes += utf8ByteLength(serialised);
    if (previewBytes > MAX_RESULT_PREVIEW_BYTES) return null;
    rows.push(parsed);
  }
  if (!Array.isArray(value.columns)) return null;
  const columns: SqlColumnMetadata[] = [];
  for (const raw of value.columns) {
    const parsed = parseColumn(raw);
    if (parsed === null) return null;
    columns.push(parsed);
  }
  if (
    typeof value.rowCount !== 'number' ||
    !Number.isFinite(value.rowCount) ||
    value.rowCount < 0
  ) {
    return null;
  }
  if (value.rowCount < rows.length) return null;
  if (
    typeof value.durationMs !== 'number' ||
    !Number.isFinite(value.durationMs) ||
    value.durationMs < 0
  ) {
    return null;
  }
  if (typeof value.tooLarge !== 'boolean') return null;
  if (
    typeof value.statementCount !== 'number' ||
    !Number.isFinite(value.statementCount) ||
    value.statementCount < 0
  ) {
    return null;
  }
  if (typeof value.recordedAt !== 'string') return null;
  let errorMessage: string | undefined;
  if (value.errorMessage !== undefined) {
    if (typeof value.errorMessage !== 'string') return null;
    errorMessage = value.errorMessage;
  }
  return {
    version: 1,
    status: value.status,
    rows,
    columns,
    rowCount: value.rowCount,
    durationMs: value.durationMs,
    tooLarge: value.tooLarge,
    statementCount: value.statementCount,
    recordedAt: value.recordedAt,
    ...(errorMessage !== undefined ? { errorMessage } : {}),
  };
}

/**
 * Helper: build a fresh `SqlQueryV1` with sensible defaults. Used
 * by the "New query" affordance in the UI.
 */
export function createBlankSqlQuery(options: {
  id: string;
  name?: string;
  query?: string;
  now?: string;
}): SqlQueryV1 {
  const now = options.now ?? new Date().toISOString();
  return {
    version: 1,
    id: options.id,
    name: options.name ?? '',
    query: options.query ?? '',
    createdAt: now,
    updatedAt: now,
  };
}
