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
  OPFS_SQL_DB_PATH,
  utf8ByteLength,
  type SqlColumnMetadata,
  type SqlImportFormat,
  type SqlQueryStatus,
  type SqlStorageMode,
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
 *
 * RL-097 (SQL import) — `registerFile` / `dropFile` are OPTIONAL on the
 * handle so the existing in-memory test stubs (which only implement
 * `connect` + `terminate`) keep type-checking. The import helpers fall
 * back gracefully (and tests opt in by implementing them).
 */
export interface DuckDbEngineHandle {
  connect: () => Promise<DuckDbConnection>;
  terminate: () => Promise<void>;
  /**
   * Register a virtual file from a byte buffer so `read_csv_auto` /
   * `read_json_auto` / `read_parquet` can read it by `name`. Maps onto
   * `AsyncDuckDB.registerFileBuffer`. Re-registering the same name
   * overwrites it.
   */
  registerFile?: (name: string, data: Uint8Array) => Promise<void>;
  /**
   * Drop a previously-registered virtual file. Maps onto
   * `AsyncDuckDB.dropFile`. Best-effort — a missing name resolves.
   */
  dropFile?: (name: string) => Promise<void>;
}

/**
 * Factory that produces an engine handle. Production: dynamic
 * `import('@duckdb/duckdb-wasm')` + worker spawn. Tests: in-memory
 * `Map` of name → response.
 */
export type DuckDbEngineFactory = () => Promise<DuckDbEngineHandle>;

let cachedEngine: Promise<DuckDbEngineHandle> | null = null;
let activeFactory: DuckDbEngineFactory | null = null;

// ---------------------------------------------------------------------------
// RL-097 Slice 3 (SQL OPFS) — opt-in table persistence.
//
// The engine is a session singleton. The user's persistence preference
// is captured into `desiredPersistence` BEFORE the first instantiate
// (the panel calls `configureDuckDbPersistence` on mount); the factory
// reads it once and resolves the actual backing into
// `resolvedStorageMode`. Changing the toggle therefore takes effect on
// the next reload — or immediately after `flushAndReleaseDuckDbEngine`
// drops the singleton (the Settings "Reconnect now" action, fold E).
// ---------------------------------------------------------------------------

/** The user's requested persistence preference, applied on next instantiate. */
let desiredPersistence = false;
/** The backing the live (or last) engine actually resolved to. */
let resolvedStorageMode: SqlStorageMode = 'memory';
/** The storage backing requested when the live (or last) engine resolved. */
let resolvedStorageRequestedMode: SqlStorageMode = 'memory';

/**
 * `DuckDBAccessMode.READ_WRITE` — numeric value from the
 * `@duckdb/duckdb-wasm` binding enum (UNDEFINED=0, AUTOMATIC=1,
 * READ_ONLY=2, READ_WRITE=3). Inlined so the persistence helper does
 * not force the lazy `duckdb-wasm` chunk into the main bundle just to
 * read one constant.
 */
const DUCKDB_ACCESS_MODE_READ_WRITE = 3;

/**
 * OPFS file names DuckDB may create for the persistent database — the
 * database file plus its write-ahead-log sidecar. Derived from
 * `OPFS_SQL_DB_PATH` minus the `opfs://` protocol prefix. Used by the
 * clear-data action to remove every artifact.
 */
const OPFS_SQL_DB_FILE_NAMES: readonly string[] = (() => {
  const base = OPFS_SQL_DB_PATH.replace(/^opfs:\/\//, '');
  return [base, `${base}.wal`];
})();

/** Minimal `db.open` surface the persistence helper depends on. */
interface DuckDbOpenable {
  open: (config: {
    path?: string;
    accessMode?: number;
    opfs?: { fileHandling?: 'auto' | 'manual' };
  }) => Promise<void>;
}

/**
 * Set the persistence preference for the NEXT engine instantiate. A
 * no-op against an already-running engine — the caller reloads or calls
 * `flushAndReleaseDuckDbEngine` to re-resolve. Idempotent.
 */
export function configureDuckDbPersistence(persist: boolean): void {
  desiredPersistence = persist === true;
}

/** The storage backing of the live (or most recently resolved) engine. */
export function getResolvedSqlStorageMode(): SqlStorageMode {
  return resolvedStorageMode;
}

/** The storage backing requested for the live (or most recently resolved) engine. */
export function getResolvedSqlStorageRequestMode(): SqlStorageMode {
  return resolvedStorageRequestedMode;
}

/**
 * Whether this environment exposes OPFS. The presence of
 * `navigator.storage.getDirectory` on the main thread is a reliable
 * proxy for the worker-side sync-access-handle support DuckDB needs;
 * the actual `db.open` is still wrapped in a fallback in case the
 * handle acquisition fails at runtime (cross-tab lock, private mode).
 */
export function isOpfsStorageAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage !== 'undefined' &&
    typeof navigator.storage.getDirectory === 'function'
  );
}

/**
 * Resolve the storage backing for a freshly-instantiated database.
 * Pure decision + IO, extracted so tests can exercise every branch
 * without standing up DuckDB:
 *
 *   - persistence off OR OPFS unavailable → `'memory'` (no `open`).
 *   - persistence on + available → `db.open(opfs://…)`; `'opfs'` on
 *     success.
 *   - `open` throws (locked by another tab, quota, unsupported) →
 *     best-effort reopen of an in-memory database, resolve `'memory'`.
 *
 * `instantiate` already leaves an in-memory database ready, so the
 * `':memory:'` reopen is belt-and-suspenders against a half-open state
 * from the throwing `open` — the workspace must never be left dead.
 */
export async function applyDuckDbPersistence(
  db: DuckDbOpenable,
  persist: boolean,
  opfsAvailable: boolean
): Promise<SqlStorageMode> {
  if (!persist || !opfsAvailable) return 'memory';
  try {
    await db.open({
      path: OPFS_SQL_DB_PATH,
      accessMode: DUCKDB_ACCESS_MODE_READ_WRITE,
      opfs: { fileHandling: 'auto' },
    });
    return 'opfs';
  } catch {
    try {
      await db.open({ path: ':memory:' });
    } catch {
      /* the post-instantiate default is already in-memory */
    }
    return 'memory';
  }
}

/**
 * Terminate + drop the cached engine, resetting the resolved mode to
 * the in-memory default. The next `getDuckDbEngine` re-instantiates and
 * re-resolves persistence. Terminating also releases the OPFS sync
 * access handle so the file can be removed or re-opened by another tab.
 */
async function terminateDuckDbEngine(): Promise<void> {
  const pending = cachedEngine;
  cachedEngine = null;
  resolvedStorageMode = 'memory';
  resolvedStorageRequestedMode = 'memory';
  if (pending === null) return;
  try {
    const engine = await pending;
    await engine.terminate();
  } catch {
    /* never resolved, or already terminated — nothing to release */
  }
}

/**
 * Fold B — flush + release on app/tab teardown (or the Settings
 * "Reconnect now" action). Checkpoints first when persistent so the WAL
 * lands in the OPFS file, then terminates so the handle releases
 * cleanly and the next session/tab re-opens without a stale-lock
 * fallback. Durability does not depend on this completing — fold A
 * already checkpoints after every write.
 */
export async function flushAndReleaseDuckDbEngine(): Promise<void> {
  if (cachedEngine !== null && resolvedStorageMode === 'opfs') {
    try {
      const engine = await cachedEngine;
      const connection = await engine.connect();
      try {
        await connection.query('CHECKPOINT');
      } finally {
        await connection.close();
      }
    } catch {
      /* best-effort — page may be unloading */
    }
  }
  await terminateDuckDbEngine();
}

/**
 * Delete the persisted DuckDB database from OPFS. Releases the engine
 * first (it holds an exclusive sync-access handle that would block
 * `removeEntry`), then removes the database file + WAL sidecar. The
 * next `getDuckDbEngine` re-instantiates; re-opening the (now absent)
 * OPFS path yields a fresh empty database. Idempotent — a missing file
 * is swallowed.
 */
export async function clearPersistedSqlDatabase(): Promise<void> {
  await terminateDuckDbEngine();
  if (!isOpfsStorageAvailable()) return;
  try {
    const root = await navigator.storage.getDirectory();
    for (const name of OPFS_SQL_DB_FILE_NAMES) {
      try {
        await root.removeEntry(name);
      } catch {
        /* NotFoundError — never existed; idempotent */
      }
    }
  } catch {
    /* getDirectory failed — nothing to clear */
  }
}

/**
 * Fold C — approximate origin storage in use, in bytes, via
 * `navigator.storage.estimate()`. This is ORIGIN-WIDE (OPFS + caches +
 * IndexedDB + localStorage), not the database file alone, so the UI
 * labels it as approximate. Returns `null` when the API is absent.
 */
export async function estimateOriginStorageBytes(): Promise<number | null> {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.storage === 'undefined' ||
    typeof navigator.storage.estimate !== 'function'
  ) {
    return null;
  }
  try {
    const { usage } = await navigator.storage.estimate();
    return typeof usage === 'number' ? usage : null;
  } catch {
    return null;
  }
}

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
  resolvedStorageMode = 'memory';
  resolvedStorageRequestedMode = 'memory';
  desiredPersistence = false;
}

/**
 * Test seam — force the resolved storage mode so the CHECKPOINT-on-write
 * path (fold A) can be exercised without a real OPFS-backed engine.
 */
export function __setResolvedSqlStorageModeForTests(
  mode: SqlStorageMode,
  requestedMode: SqlStorageMode = mode
): void {
  resolvedStorageMode = mode;
  resolvedStorageRequestedMode = requestedMode;
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
/**
 * Fetch the R2-mirrored DuckDB WASM, verify it against the build-time
 * expected sha256 (computed from the pnpm-lock-verified node_modules
 * payload in vite.web.config.mts), and hand back a blob URL DuckDB can
 * instantiate from. A tampered bucket object fails loudly here — the
 * existing `engine-load-failed` band surfaces it — instead of being
 * executed unchecked. The caller owns revoking the blob URL.
 */
async function fetchVerifiedWasmUrl(
  url: string,
  expectedSha256: string
): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch DuckDB runtime (${response.status} ${response.statusText})`
    );
  }
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const actual = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  if (actual !== expectedSha256) {
    throw new Error(
      `DuckDB runtime integrity check failed: expected sha256 ${expectedSha256}, got ${actual}. ` +
        'The mirrored runtime asset does not match this build.'
    );
  }
  return URL.createObjectURL(
    new Blob([bytes], { type: 'application/wasm' })
  );
}

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
  let revokeWasmUrl: (() => void) | null = null;
  if (__LINGUA_DUCKDB_MVP_WASM_URL__) {
    const expectedSha256 = __LINGUA_DUCKDB_MVP_WASM_SHA256__;
    if (expectedSha256) {
      mvpWasmUrl = await fetchVerifiedWasmUrl(
        __LINGUA_DUCKDB_MVP_WASM_URL__,
        expectedSha256
      );
      const blobUrl = mvpWasmUrl;
      revokeWasmUrl = () => URL.revokeObjectURL(blobUrl);
    } else {
      mvpWasmUrl = __LINGUA_DUCKDB_MVP_WASM_URL__;
    }
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
    // The verified blob URL has served its purpose once instantiation
    // completes; revoking frees the duplicated WASM bytes.
    revokeWasmUrl?.();
    revokeWasmUrl = null;
    // RL-097 Slice 3 (SQL OPFS) — resolve the storage backing. When the
    // user opted into persistence and OPFS is available this opens the
    // `opfs://` database so tables survive a reload; otherwise it stays
    // in-memory. Failures fall back to in-memory inside the helper, so
    // this never blocks the engine from coming up.
    const requestedStorageMode: SqlStorageMode = desiredPersistence
      ? 'opfs'
      : 'memory';
    resolvedStorageMode = await applyDuckDbPersistence(
      db,
      desiredPersistence,
      isOpfsStorageAvailable()
    );
    resolvedStorageRequestedMode = requestedStorageMode;
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
      // RL-097 (SQL import) — virtual-file registration surface. DuckDB's
      // `read_*` table functions read by registered `name`; the import
      // helpers register the file bytes here, run the reader, then drop
      // the file. `registerFileBuffer` accepts both text (CSV/JSON) and
      // binary (Parquet) payloads.
      registerFile: async (name: string, data: Uint8Array) => {
        await db.registerFileBuffer(name, data);
      },
      dropFile: async (name: string) => {
        await db.dropFile(name);
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
    // Reclaim the worker (and any verified blob URL) before the
    // rejection propagates up to the `getDuckDbEngine` cache-reset path.
    revokeWasmUrl?.();
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
/**
 * Private race marker for the soft-timeout path. Keep it object-shaped instead
 * of a string so a query result can never collide with it accidentally.
 */
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
 * Count the number of statements in a multi-statement query. This is a UX badge,
 * not a SQL parser: it tracks simple single- and double-quoted strings so
 * `';' AS sep` stays one statement, but intentionally ignores comments,
 * PostgreSQL dollar-quoted strings, and dialect-specific escaping.
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
    // Fold A — flush the WAL to the OPFS database file so a hard reload
    // or crash does not lose the writes from this statement. Best-effort
    // on the same connection before it closes: a failed CHECKPOINT must
    // never turn a successful query into an error, and it is a cheap
    // no-op on a read-only (SELECT) session.
    if (resolvedStorageMode === 'opfs') {
      try {
        await connection.query('CHECKPOINT');
      } catch {
        /* durability is best-effort; the query already succeeded */
      }
    }
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

// ---------------------------------------------------------------------------
// RL-097 (SQL import) — file → DuckDB table.
//
// `previewImportFile` registers the file bytes and reads a 10-row sample
// + a total count WITHOUT creating a table, so the preview modal can show
// the user exactly what they're about to import. `importFileAsTable`
// registers the bytes (idempotent if the preview already did) and runs
// `CREATE TABLE … AS SELECT * FROM read_*(…)`. Both DROP the registered
// virtual file on settle (success OR failure) so a cancelled / errored
// import never leaves a phantom file pinned in the engine.
// ---------------------------------------------------------------------------

/** Number of rows shown in the import preview modal's sample table. */
export const IMPORT_PREVIEW_SAMPLE_ROWS = 10;

/**
 * Map an import format to its DuckDB reader call against a registered
 * virtual file `name`. The name is single-quote-escaped because it is
 * spliced into a SQL string literal (the file name, NOT an identifier).
 */
function readerExpression(format: SqlImportFormat, name: string): string {
  const escaped = name.replace(/'/g, "''");
  switch (format) {
    case 'csv':
      return `read_csv_auto('${escaped}')`;
    case 'json':
      return `read_json_auto('${escaped}')`;
    case 'parquet':
      return `read_parquet('${escaped}')`;
  }
}

/**
 * Register a defensive COPY of the bytes. `AsyncDuckDB.registerFileBuffer`
 * postMessages the buffer to the worker with the underlying ArrayBuffer as
 * a transferable, which DETACHES the original `Uint8Array` on the main
 * thread. The import flow registers the same file twice (preview then
 * import), so handing the worker a fresh copy each time keeps the caller's
 * buffer alive for the second registration. A 25 MiB cap (fold E) bounds
 * the copy cost.
 */
async function registerFileCopy(
  engine: DuckDbEngineHandle,
  name: string,
  bytes: Uint8Array
): Promise<void> {
  // `slice()` returns a new Uint8Array backed by a fresh ArrayBuffer, so
  // the worker transfer detaches the copy, never the caller's buffer.
  await engine.registerFile!(name, bytes.slice());
}

/**
 * A stable, collision-resistant virtual file name for the engine's file
 * registry. The user-supplied file name is never used directly (it could
 * collide or carry odd characters); the registered name only needs to be
 * unique per registration and match the reader call.
 */
function virtualFileName(format: SqlImportFormat): string {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `lingua_import_${id}.${format}`;
}

/** Outcome of {@link previewImportFile}. */
export interface ImportPreview {
  /** Column names in result order. */
  columns: string[];
  /** Up to {@link IMPORT_PREVIEW_SAMPLE_ROWS} sample rows, column-ordered. */
  sampleRows: unknown[][];
  /** Total row count in the source file (NOT just the sample). */
  rowCount: number;
}

/** Outcome of {@link importFileAsTable}. */
export interface ImportResult {
  /** The table name actually created (the de-collided, validated name). */
  table: string;
  /** Total rows inserted into the new table. */
  rowCount: number;
}

/**
 * Register `bytes` as a virtual file and read a sample + total count for
 * the import preview modal — WITHOUT creating a table. The registered
 * file is dropped before this resolves, so a preview leaves no engine
 * state behind. Throws on a parse / read failure (the caller maps it to
 * the `errorParse` notice); the file is still dropped via `finally`.
 */
export async function previewImportFile(args: {
  fileName: string;
  format: SqlImportFormat;
  bytes: Uint8Array;
}): Promise<ImportPreview> {
  const engine = await getDuckDbEngine();
  if (typeof engine.registerFile !== 'function') {
    throw new Error('This SQL engine cannot register files for import.');
  }
  const name = virtualFileName(args.format);
  await registerFileCopy(engine, name, args.bytes);
  const connection = await engine.connect();
  try {
    const reader = readerExpression(args.format, name);
    const sample = await connection.query(
      `SELECT * FROM ${reader} LIMIT ${IMPORT_PREVIEW_SAMPLE_ROWS}`
    );
    const countResult = await connection.query(
      `SELECT count(*) AS n FROM ${reader}`
    );
    const columns = sample.columns.map((column) => column.name);
    const sampleRows: unknown[][] = sample.rows.map((row) =>
      columns.map((column) => row[column] ?? null)
    );
    const rowCount = readCountValue(countResult.rows[0]?.['n']);
    return { columns, sampleRows, rowCount };
  } finally {
    try {
      await connection.close();
    } catch {
      /* defensive */
    }
    try {
      await engine.dropFile?.(name);
    } catch {
      /* best-effort — a leaked virtual file is harmless and small */
    }
  }
}

/**
 * Register `bytes` as a virtual file and create a table from it via
 * `CREATE TABLE <ident> AS SELECT * FROM read_*(…)`. `tableName` MUST be
 * a pre-validated, collision-free identifier (see `isValidTableName` /
 * `dedupeTableName` in shared) — it is double-quote-escaped and spliced
 * as the table identifier. Returns the created table + its row count.
 * Throws on a parse / DDL failure (so no table is created and the caller
 * surfaces `errorParse`); the virtual file is dropped via `finally`
 * either way.
 *
 * When persistent (OPFS), a best-effort CHECKPOINT flushes the new table
 * to disk so it survives a reload — mirroring `executeQuery`'s fold-A
 * durability pass.
 */
export async function importFileAsTable(args: {
  fileName: string;
  tableName: string;
  format: SqlImportFormat;
  bytes: Uint8Array;
}): Promise<ImportResult> {
  const engine = await getDuckDbEngine();
  if (typeof engine.registerFile !== 'function') {
    throw new Error('This SQL engine cannot register files for import.');
  }
  const name = virtualFileName(args.format);
  await registerFileCopy(engine, name, args.bytes);
  const connection = await engine.connect();
  // Double-quote-escape the validated identifier so a reserved word or
  // mixed-case name still produces valid DDL.
  const ident = `"${args.tableName.replace(/"/g, '""')}"`;
  try {
    const reader = readerExpression(args.format, name);
    await connection.query(`CREATE TABLE ${ident} AS SELECT * FROM ${reader}`);
    const countResult = await connection.query(
      `SELECT count(*) AS n FROM ${ident}`
    );
    const rowCount = readCountValue(countResult.rows[0]?.['n']);
    if (resolvedStorageMode === 'opfs') {
      try {
        await connection.query('CHECKPOINT');
      } catch {
        /* durability is best-effort; the table already exists */
      }
    }
    return { table: args.tableName, rowCount };
  } finally {
    try {
      await connection.close();
    } catch {
      /* defensive */
    }
    try {
      await engine.dropFile?.(name);
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Coerce a DuckDB `count(*)` cell into a finite number. DuckDB returns
 * `BIGINT` counts, which `mapArrowTable` stringifies; this parses the
 * string (or number) back to a safe integer, falling back to `0`.
 */
function readCountValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
  }
  return 0;
}
