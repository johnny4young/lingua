/**
 * RL-097 Slice 2 — DuckDB-WASM client wrapper.
 *
 * Lazy-bootstrap layer between the renderer and `@duckdb/duckdb-wasm`.
 * Three responsibilities:
 *
 *   1. **Lazy instantiate**. The 7 MiB WASM blob + worker ship in a
 *      separate Vite chunk (`duckdb-wasm`) and are fetched only when
 *      the SQL workspace tab opens for the first time. The instance
 *      is shared per-session — closing + reopening the panel reuses
 *      it.
 *
 *   2. **Execute a query** with soft-timeout + result cap. DuckDB-WASM
 *      does not expose a native abort for in-flight queries, so the
 *      timeout is a `Promise.race` — the worker keeps running until
 *      the WASM finishes the query, but the renderer surfaces a
 *      `'timeout'` result and the user can close the tab to free the
 *      worker.
 *
 *   3. **Arrow → JSON row mapping** with `MAX_RESULT_ROWS` +
 *      `MAX_RESULT_PREVIEW_BYTES` caps. BigInts come back as strings
 *      so JSON-serialisation never throws.
 *
 * Privacy posture:
 *
 *   - WASM blob is bundled with the app — no CDN fetch, no
 *     third-party origin. Matches the RL-083 Slice 1 precedent of
 *     same-origin copied runtime assets.
 *   - Result cells are user content and never leave the renderer
 *     unless the user explicitly exports a capsule.
 *   - The instance + connections are renderer-scoped. There is no
 *     IPC bridge to the main process — desktop builds run the
 *     same code path as web.
 */

import {
  MAX_RESULT_PREVIEW_BYTES,
  MAX_RESULT_ROWS,
  DEFAULT_QUERY_TIMEOUT_MS,
  MAX_QUERY_TIMEOUT_MS,
  utf8ByteLength,
  type SqlColumnMetadata,
  type SqlQueryStatus,
} from '../../shared/sqlWorkspace';

// ---------------------------------------------------------------------------
// Public types — what the panel + tests consume.
// ---------------------------------------------------------------------------

/**
 * Outcome of an `executeQuery` call. Always resolves; the panel
 * checks `status` to dispatch on success vs error.
 */
export interface DuckDbExecuteOutcome {
  status: SqlQueryStatus;
  rows: Array<Record<string, unknown>>;
  columns: SqlColumnMetadata[];
  rowCount: number;
  durationMs: number;
  tooLarge: boolean;
  statementCount: number;
  errorMessage?: string;
}

/**
 * Per-tab connection handle. The panel holds one of these for its
 * lifetime; `close()` on unmount releases the DuckDB connection back
 * to the engine.
 */
export interface DuckDbConnection {
  query: (sql: string) => Promise<{
    columns: SqlColumnMetadata[];
    rows: Array<Record<string, unknown>>;
    rowCount: number;
    tooLarge: boolean;
  }>;
  close: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Pluggable engine seam. Production loads `@duckdb/duckdb-wasm` via a
// dynamic `import()` so the bundler emits it on a separate chunk;
// tests inject a synchronous in-memory stub.
// ---------------------------------------------------------------------------

/**
 * Minimal surface the wrapper depends on. Lets `duckdbClient.test.ts`
 * inject a mock without standing up the whole DuckDB engine. The
 * production loader resolves to the real instance.
 */
export interface DuckDbEngineHandle {
  connect: () => Promise<DuckDbConnection>;
  terminate: () => Promise<void>;
}

/**
 * Factory that produces an engine handle. Production: dynamic
 * `import('@duckdb/duckdb-wasm')` + worker spawn. Tests: in-memory
 * `Map` of name → response.
 */
export type DuckDbEngineFactory = () => Promise<DuckDbEngineHandle>;

let cachedEngine: Promise<DuckDbEngineHandle> | null = null;
let activeFactory: DuckDbEngineFactory | null = null;

/**
 * Test seam: swap the engine factory + reset the cached singleton.
 * The production code never calls this; vitest cases call it from
 * `beforeEach` to inject the in-memory mock.
 */
export function __setDuckDbEngineFactoryForTests(
  factory: DuckDbEngineFactory | null
): void {
  activeFactory = factory;
  cachedEngine = null;
}

/**
 * Get-or-instantiate the engine. First call lazy-imports the
 * `@duckdb/duckdb-wasm` chunk; subsequent calls return the cached
 * Promise. Failures cache as rejected Promises and require a manual
 * `__setDuckDbEngineFactoryForTests(null)` to retry — Slice 2
 * surfaces this as `engine-load-failed` with a retry button.
 */
export async function getDuckDbEngine(): Promise<DuckDbEngineHandle> {
  if (cachedEngine !== null) return cachedEngine;
  const factory = activeFactory ?? productionEngineFactory;
  cachedEngine = factory().catch((err) => {
    // Reset the cache on failure so the user-driven retry path can
    // try again from scratch — otherwise a flaky first-load would
    // permanently freeze the panel.
    cachedEngine = null;
    throw err;
  });
  return cachedEngine;
}

/**
 * Production factory. Dynamically imports `@duckdb/duckdb-wasm` so
 * the bundler emits it on the `duckdb-wasm` chunk (see
 * `vite.web.config.mts` + `vite.renderer.config.mts`). Desktop keeps
 * the WASM blob bundled; the standalone web build points the >25 MiB
 * MVP WASM at the public R2 runtime prefix because Cloudflare Pages
 * rejects oversized single assets.
 */
async function productionEngineFactory(): Promise<DuckDbEngineHandle> {
  // Dynamic imports keep the chunk lazy. The browser fetches the
  // ~1 MiB JS shim first; the WASM only when DuckDB
  // actually instantiates.
  const duckdb = await import('@duckdb/duckdb-wasm');
  const mvpWorkerModule = await import(
    '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'
  );
  const mvpWorkerUrl: string = mvpWorkerModule.default;
  let mvpWasmUrl: string;
  if (__LINGUA_DUCKDB_MVP_WASM_URL__) {
    mvpWasmUrl = __LINGUA_DUCKDB_MVP_WASM_URL__;
  } else {
    const mvpWasmModule = await import(
      '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'
    );
    mvpWasmUrl = mvpWasmModule.default;
  }
  // Wrap the worker URL into an actual `Worker` instance. DuckDB's
  // `createWorker` would normally fetch the URL itself; we pass our
  // bundled URL directly so the same-origin guarantee holds.
  const worker = new Worker(mvpWorkerUrl);
  // Reviewer pass (HIGH-1) — if WASM instantiation fails (offline,
  // CSP rejection, OOM), the just-spawned worker must be terminated
  // so it doesn't sit idle in the browser. Without this guard each
  // retry leaks another worker + its WASM heap. Production retries
  // are user-driven via the `engine-load-failed` band, so the leak
  // is small per failure but unbounded across a long session.
  try {
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(mvpWasmUrl);
    return {
      connect: async (): Promise<DuckDbConnection> => {
        const connection = await db.connect();
        return {
          query: async (sql: string) => {
            const arrowTable = await connection.query(sql);
            return mapArrowTable(arrowTable);
          },
          close: async () => {
            await connection.close();
          },
        };
      },
      terminate: async () => {
        try {
          await db.terminate();
        } finally {
          worker.terminate();
        }
      },
    };
  } catch (err) {
    // Reclaim the worker before the rejection propagates up to the
    // `getDuckDbEngine` cache-reset path.
    try {
      worker.terminate();
    } catch {
      /* defensive — terminating a worker should never throw */
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Arrow → JSON mapping with caps. Extracted as a helper so tests can
// exercise it without the full DuckDB stack.
// ---------------------------------------------------------------------------

/**
 * Minimal Arrow Table-like shape we depend on. The real DuckDB-WASM
 * returns an `apache-arrow` `Table`; tests pass a fixture that
 * matches this surface.
 */
export interface ArrowTableLike {
  numRows: number;
  schema: { fields: Array<{ name: string; type: { toString(): string } }> };
  toArray: () => Array<Record<string, unknown>>;
}

/**
 * Convert an Arrow Table to the JSON-serialisable preview row set
 * with the row + byte caps applied. Pure function — no side effects.
 */
export function mapArrowTable(table: ArrowTableLike): {
  columns: SqlColumnMetadata[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  tooLarge: boolean;
} {
  const columns: SqlColumnMetadata[] = table.schema.fields.map((field) => ({
    name: field.name,
    type: stringifyArrowType(field.type),
  }));
  const allRows = table.toArray();
  const rowCount = allRows.length;
  const rows: Array<Record<string, unknown>> = [];
  let approxBytes = 0;
  let tooLarge = false;
  const cap = Math.min(MAX_RESULT_ROWS, allRows.length);
  for (let i = 0; i < cap; i += 1) {
    const raw = allRows[i];
    if (raw === undefined || raw === null) continue;
    const safeRow = sanitiseRowForJson(raw);
    const serialised = JSON.stringify(safeRow);
    const rowBytes = utf8ByteLength(serialised);
    if (approxBytes + rowBytes > MAX_RESULT_PREVIEW_BYTES) {
      tooLarge = true;
      break;
    }
    approxBytes += rowBytes;
    rows.push(safeRow);
  }
  if (cap < rowCount) tooLarge = true;
  return { columns, rows, rowCount, tooLarge };
}

/**
 * Coerce DuckDB / Arrow cell values into JSON-friendly shapes.
 *
 *   - `BigInt` → string (JSON cannot encode BigInts; preserving
 *     precision matters for `BIGINT` columns).
 *   - `Date` → ISO string.
 *   - `Uint8Array` / Buffer → base64 string (rare in result sets but
 *     defensive).
 *   - Nested objects + arrays are recursed.
 *   - Numbers + booleans + strings + null pass through.
 *   - Symbols + functions → `null` (defensive — DuckDB never returns
 *     these, but Arrow row objects can carry prototype chains).
 */
function sanitiseRowForJson(
  row: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    out[key] = sanitiseValueForJson(row[key]);
  }
  return out;
}

function sanitiseValueForJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') return value;
  if (valueType === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (valueType === 'bigint') return (value as bigint).toString();
  if (valueType === 'symbol' || valueType === 'function') return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) {
    // Best-effort: convert to base64. Avoids dragging in `buffer`.
    let binary = '';
    for (let i = 0; i < value.byteLength; i += 1) {
      binary += String.fromCharCode(value[i]!);
    }
    if (typeof btoa === 'function') return btoa(binary);
    return binary;
  }
  if (Array.isArray(value)) return value.map(sanitiseValueForJson);
  if (valueType === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      out[key] = sanitiseValueForJson(obj[key]);
    }
    return out;
  }
  return null;
}

function stringifyArrowType(type: { toString(): string }): string {
  try {
    return String(type);
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// executeQuery — the public entry point the panel consumes.
// ---------------------------------------------------------------------------

export interface ExecuteQueryOptions {
  /** Per-call timeout override. Capped at `MAX_QUERY_TIMEOUT_MS`. */
  timeoutMs?: number;
}

interface QueryTimeoutSentinel {
  readonly __sqlWorkspaceTimeout: true;
}
const TIMEOUT_SENTINEL: QueryTimeoutSentinel = { __sqlWorkspaceTimeout: true };
const DUCKDB_WASM_INTERNAL_ERROR = /_setThrew is not defined/i;
const DUCKDB_WASM_INTERNAL_ERROR_MESSAGE =
  'DuckDB could not return the detailed SQL error. Check the query syntax, table names, and column names.';

function isTimeoutSentinel(value: unknown): value is QueryTimeoutSentinel {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Partial<QueryTimeoutSentinel>).__sqlWorkspaceTimeout === true
  );
}

function errorMessageForUser(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : String(err ?? fallback);
  if (DUCKDB_WASM_INTERNAL_ERROR.test(raw)) {
    return DUCKDB_WASM_INTERNAL_ERROR_MESSAGE;
  }
  return raw;
}

/**
 * Count the number of statements in a multi-statement query. Naive
 * but conservative: splits on semicolons and counts non-whitespace
 * fragments. Won't be 100% accurate for SQL strings containing
 * literal semicolons (e.g. `';' AS sep`) but it's a UX badge, not a
 * security gate — false positives just over-count by one.
 */
export function countSqlStatements(query: string): number {
  let count = 0;
  let depthSingle = false;
  let depthDouble = false;
  let buffer = '';
  for (let i = 0; i < query.length; i += 1) {
    const ch = query[i];
    if (ch === "'" && !depthDouble) depthSingle = !depthSingle;
    else if (ch === '"' && !depthSingle) depthDouble = !depthDouble;
    if (ch === ';' && !depthSingle && !depthDouble) {
      if (buffer.trim().length > 0) count += 1;
      buffer = '';
    } else {
      buffer += ch;
    }
  }
  if (buffer.trim().length > 0) count += 1;
  return count;
}

/**
 * Run a SQL query against the lazy-loaded DuckDB engine. Always
 * settles to a `DuckDbExecuteOutcome` — never throws. The caller
 * checks `outcome.status` to dispatch on success vs error.
 *
 * Connection lifecycle: a fresh connection is opened per call and
 * closed on settle. DuckDB's `connect` is cheap (~ms) so we don't
 * hold one open between user-driven runs; that keeps the abort path
 * honest (closing the engine drops the connection).
 */
export async function executeQuery(
  query: string,
  options: ExecuteQueryOptions = {}
): Promise<DuckDbExecuteOutcome> {
  const start = performance.now();
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return {
      status: 'success',
      rows: [],
      columns: [],
      rowCount: 0,
      durationMs: 0,
      tooLarge: false,
      statementCount: 0,
    };
  }
  let engine: DuckDbEngineHandle;
  try {
    engine = await getDuckDbEngine();
  } catch (err) {
    return {
      status: 'engine-load-failed',
      rows: [],
      columns: [],
      rowCount: 0,
      durationMs: Math.round(performance.now() - start),
      tooLarge: false,
      statementCount: 0,
      errorMessage: errorMessageForUser(err, 'unknown'),
    };
  }
  let connection: DuckDbConnection;
  try {
    connection = await engine.connect();
  } catch (err) {
    return {
      status: 'engine-load-failed',
      rows: [],
      columns: [],
      rowCount: 0,
      durationMs: Math.round(performance.now() - start),
      tooLarge: false,
      statementCount: 0,
      errorMessage: errorMessageForUser(err, 'connect failed'),
    };
  }
  const timeoutMs = Math.min(
    options.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS,
    MAX_QUERY_TIMEOUT_MS
  );
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<QueryTimeoutSentinel>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs);
  });
  try {
    // Reviewer pass (HIGH-2) — defensive against late rejection on
    // the timeout path. If `timeoutPromise` wins the race, the
    // underlying `connection.query` is left pending; the subsequent
    // `connection.close()` in `finally` invalidates the connection
    // and the query rejects after we've already returned. While
    // `Promise.race` does itself attach handlers, an explicit
    // no-op catch on the query promise insulates us from engine /
    // polyfill variance in unhandled-rejection detection.
    const queryPromise = connection.query(trimmed);
    void queryPromise.catch(() => {
      /* swallow late rejection after timeout race resolved */
    });
    const raceResult = await Promise.race([queryPromise, timeoutPromise]);
    if (isTimeoutSentinel(raceResult)) {
      return {
        status: 'timeout',
        rows: [],
        columns: [],
        rowCount: 0,
        durationMs: Math.round(performance.now() - start),
        tooLarge: false,
        statementCount: countSqlStatements(trimmed),
        errorMessage: 'Query exceeded timeout',
      };
    }
    const { columns, rows, rowCount, tooLarge } = raceResult;
    return {
      status: tooLarge ? 'too-large' : 'success',
      rows,
      columns,
      rowCount,
      durationMs: Math.round(performance.now() - start),
      tooLarge,
      statementCount: countSqlStatements(trimmed),
    };
  } catch (err) {
    return {
      status: 'sql-error',
      rows: [],
      columns: [],
      rowCount: 0,
      durationMs: Math.round(performance.now() - start),
      tooLarge: false,
      statementCount: countSqlStatements(trimmed),
      errorMessage: errorMessageForUser(err, 'sql failed'),
    };
  } finally {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    try {
      await connection.close();
    } catch {
      /* defensive: closing twice should not propagate */
    }
  }
}
