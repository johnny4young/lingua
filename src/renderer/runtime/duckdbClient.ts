/**
 * DuckDB-WASM client wrapper.
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
 *     third-party origin. Matches the precedent of
 *     same-origin copied runtime assets.
 *   - Result cells are user content and never leave the renderer
 *     unless the user explicitly exports a capsule.
 *   - The instance + connections are renderer-scoped. There is no
 *     IPC bridge to the main process — desktop builds run the
 *     same code path as web.
 */

import { sha256HexToIntegrity } from './wasmIntegrity';
import { DuckDbEngineLifecycle } from './duckdbEngineLifecycle';
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
import { quoteSqlTableReference } from '../../shared/sqlQuote';
import { splitSqlStatements } from '../../shared/sqlStatements';
import {
  buildImportStatements,
  readerSql,
  type SqlImportColumnMap,
  type SqlImportCsvOptions,
  type SqlImportTarget,
} from '../../shared/sqlImportPlan';

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
  /** Reading stopped at the row window, so `rowCount` is a lower bound. */
  rowCountIsLowerBound?: boolean;
  /** Set on `cancelled` or `timeout`: DuckDB had not stopped within the settle window. */
  stillRunning?: boolean;
  /** With `keepCursor`, the open stream past the window; the caller must close it. */
  cursor?: SqlResultCursor;
  statementCount: number;
  errorMessage?: string;
}

/**
 * Per-tab connection handle. The panel holds one of these for its
 * lifetime; `close()` on unmount releases the DuckDB connection back
 * to the engine.
 */
/** A single statement's result, read one Arrow batch at a time. */
export interface DuckDbResultStream {
  fields: () => ArrowTableLike['schema']['fields'];
  /** The next batch, or null once the result is exhausted. */
  next: () => Promise<ArrowTableLike | null>;
}

export interface DuckDbConnection {
  query: (sql: string) => Promise<{
    columns: SqlColumnMetadata[];
    rows: Array<Record<string, unknown>>;
    rowCount: number;
    tooLarge: boolean;
  }>;
  /** Streams one statement so reading can stop at the row window; absent on engines that cannot. */
  stream?: (sql: string) => Promise<DuckDbResultStream>;
  /** Asks DuckDB to stop the streamed query; cooperative, so a long operator may finish first. */
  cancel?: () => Promise<boolean>;
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
 * `registerFile` / `dropFile` are OPTIONAL on the
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
  /** An empty virtual file that `COPY … TO` can write into. */
  registerEmptyFile?: (name: string) => Promise<void>;
  /** The bytes of a virtual file, after `COPY … TO` wrote it. */
  readFile?: (name: string) => Promise<Uint8Array>;
}

/**
 * Factory that produces an engine handle. Production: dynamic
 * `import('@duckdb/duckdb-wasm')` + worker spawn. Tests: in-memory
 * `Map` of name → response.
 */
export type DuckDbEngineFactory = () => Promise<DuckDbEngineHandle>;

let activeFactory: DuckDbEngineFactory | null = null;
let engineLifecycle = createEngineLifecycle();

function createEngineLifecycle(): DuckDbEngineLifecycle<DuckDbEngineHandle> {
  return new DuckDbEngineLifecycle(() => (activeFactory ?? productionEngineFactory)());
}

// ---------------------------------------------------------------------------
// opt-in table persistence.
//
// The engine is a session singleton. The user's persistence preference
// is captured into `desiredPersistence` BEFORE the first instantiate
// (the panel calls `configureDuckDbPersistence` on mount); the factory
// reads it once and resolves the actual backing into
// `resolvedStorageMode`. Changing the toggle therefore takes effect on
// the next reload — or immediately after `flushAndReleaseDuckDbEngine`
// drops the singleton (the Settings "Reconnect now" action).
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
 * Reset the reported backing as the last step of a release transition.
 * A factory already in flight may resolve OPFS after release starts; doing
 * this earlier would leave its stale mode visible after the engine is gone.
 */
function resetResolvedStorageMode(): void {
  resolvedStorageMode = 'memory';
  resolvedStorageRequestedMode = 'memory';
}

/**
 * Flush + release on app/tab teardown (or the Settings
 * "Reconnect now" action). Checkpoints first when persistent so the WAL
 * lands in the OPFS file, then terminates so the handle releases
 * cleanly and the next session/tab re-opens without a stale-lock
 * fallback. Durability does not depend on this completing: the client
 * already checkpoints after every write.
 */
export async function flushAndReleaseDuckDbEngine(): Promise<void> {
  const checkpoint = resolvedStorageMode === 'opfs';
  await engineLifecycle.release({
    beforeTerminate: checkpoint
      ? async engine => {
          const connection = await engine.connect();
          try {
            await connection.query('CHECKPOINT');
          } finally {
            await connection.close();
          }
        }
      : undefined,
    afterTerminate: async () => resetResolvedStorageMode(),
  });
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
  await engineLifecycle.release({
    afterTerminate: async () => {
      if (isOpfsStorageAvailable()) {
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
      resetResolvedStorageMode();
    },
  });
}

/**
 * Size of the persisted SQL database files in OPFS, in bytes: 0 when there are
 * none, null when the size cannot be read (no OPFS, or a live engine holds the
 * file's exclusive handle).
 */
export async function persistedSqlDatabaseBytes(): Promise<number | null> {
  if (!isOpfsStorageAvailable()) return 0;
  try {
    const root = await navigator.storage.getDirectory();
    let total = 0;
    for (const name of OPFS_SQL_DB_FILE_NAMES) {
      try {
        const handle = await root.getFileHandle(name);
        total += (await handle.getFile()).size;
      } catch (error) {
        if ((error as { name?: string })?.name !== 'NotFoundError') return null;
      }
    }
    return total;
  } catch {
    return null;
  }
}

/**
 * Approximate origin storage in use, in bytes, via
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
  engineLifecycle = createEngineLifecycle();
  resolvedStorageMode = 'memory';
  resolvedStorageRequestedMode = 'memory';
  desiredPersistence = false;
}

/**
 * Test seam — force the resolved storage mode so the CHECKPOINT-on-write
 * path can be exercised without a real OPFS-backed engine.
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
 * Promise. Failed generations are dropped so the user-driven retry path
 * can start a new engine without replacing a newer live generation.
 */
export async function getDuckDbEngine(): Promise<DuckDbEngineHandle> {
  return engineLifecycle.get();
}

/**
 * The runtime WASM is mirrored on R2 (it exceeds Cloudflare Pages' 25 MiB
 * per-file cap, so it can't ship as a Pages static asset). A large,
 * edge-uncached object can return a transient `5xx` under load, which
 * previously failed the whole SQL engine on the very first `fetch` with no
 * second chance. Retry transient failures — a `5xx` response or a thrown
 * network error (offline, DNS, reset) — with exponential backoff. A `4xx`
 * is deterministic (a Bot-Fight-Mode `403`, a `404` for a missing object)
 * and must NOT be retried: retrying only delays the inevitable failure and
 * hammers the origin. SRI requests make one attempt: integrity failures
 * can hide HTTP error statuses and cannot be classified as transient.
 * Exported for tests; `sleep` is injectable so specs
 * don't wait real time.
 */
const DUCKDB_WASM_FETCH_MAX_RETRIES = 3;
const DUCKDB_WASM_FETCH_BASE_DELAY_MS = 500;

export async function fetchRuntimeAssetWithRetry(
  url: string,
  maxRetries: number = DUCKDB_WASM_FETCH_MAX_RETRIES,
  baseDelayMs: number = DUCKDB_WASM_FETCH_BASE_DELAY_MS,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
  init?: RequestInit
): Promise<Response> {
  // Fetch validates SRI before exposing the Response, including error
  // bodies. Do not retry an opaque rejection that could be a 403/404 or
  // tampered payload. Recovery remains an explicit user retry.
  if (init?.integrity) return fetch(url, init);

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, init);
      // Only a transient server error is worth another attempt; any other
      // status (2xx success, or a deterministic 4xx) is returned as-is for
      // the caller's `response.ok` check to handle.
      if (response.status < 500 || attempt === maxRetries) {
        return response;
      }
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (networkError) {
      // Without SRI, retry rejected requests within the bounded budget.
      lastError = networkError instanceof Error ? networkError : new Error(String(networkError));
      if (attempt === maxRetries) throw lastError;
    }
    await sleep(baseDelayMs * 2 ** attempt);
  }
  // Unreachable — the loop returns or throws — but keeps the type total.
  throw lastError ?? new Error('Failed to fetch DuckDB runtime');
}

/**
 * Fetch the R2-mirrored DuckDB WASM verified against the build-time expected
 * sha256 (computed from the pnpm-lock-verified node_modules payload in
 * vite.web.config.mts) and hand back a blob URL DuckDB can instantiate from.
 * Verification is delegated to the browser through Subresource Integrity:
 * `fetch(url, { integrity })` checks the bytes off the main thread and
 * rejects on mismatch, so the previous arrayBuffer -> subtle.digest -> Blob
 * choreography (three copies of a 39 MB payload on the main thread) is gone
 * and `response.blob()` is the only materialization. A tampered bucket
 * object still fails loudly here — the existing `engine-load-failed` band
 * surfaces it — instead of being executed unchecked. SRI needs the mirror to
 * answer CORS for this origin, which the R2 bucket does for the production
 * app origin. The caller owns revoking the blob URL.
 */
async function fetchVerifiedWasmUrl(
  url: string,
  expectedSha256: string
): Promise<string> {
  const integrity = sha256HexToIntegrity(expectedSha256);
  let response: Response;
  try {
    response = await fetchRuntimeAssetWithRetry(
      url,
      undefined,
      undefined,
      undefined,
      { integrity }
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to fetch DuckDB runtime (${reason}). Either the network dropped or the ` +
        `mirror returned an HTTP error or failed its integrity check against sha256 ${expectedSha256}. ` +
        'The browser does not expose the status for integrity failures; no automatic retry was attempted.',
      { cause: error }
    );
  }
  if (!response.ok) {
    throw new Error(
      `Failed to fetch DuckDB runtime (${response.status} ${response.statusText})`
    );
  }
  return URL.createObjectURL(await response.blob());
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
    // Resolve the storage backing. When the
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
          stream: async (sql: string) => {
            const reader = await connection.send(sql, true);
            await reader.open();
            return {
              fields: () => reader.schema?.fields ?? [],
              next: async () => {
                const step = await reader.next();
                return step.done ? null : (step.value as unknown as ArrowTableLike);
              },
            };
          },
          cancel: () => connection.cancelSent(),
          close: async () => {
            await connection.close();
          },
        };
      },
      // virtual-file registration surface. DuckDB's
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
      registerEmptyFile: async (name: string) => {
        await db.registerEmptyFileBuffer(name);
      },
      readFile: (name: string) => db.copyFileToBuffer(name),
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
 * Collects preview rows under the row and byte caps. `add` returns false once
 * the window is full, so a streaming reader knows when to stop.
 */
function createRowAccumulator(
  fields: ArrowTableLike['schema']['fields'],
  caps: { maxRows: number; maxBytes: number } = { maxRows: MAX_RESULT_ROWS, maxBytes: MAX_RESULT_PREVIEW_BYTES }
) {
  const columns: SqlColumnMetadata[] = fields.map((field) => ({
    name: field.name,
    type: stringifyArrowType(field.type),
  }));
  const temporal = columns.flatMap(column => {
    const format = temporalFormatter(column.type);
    return format ? [[column.name, format] as const] : [];
  });
  const decimals = columns.flatMap(column => {
    const scale = decimalScale(column.type);
    return scale === null ? [] : [[column.name, scale] as const];
  });
  const rows: Array<Record<string, unknown>> = [];
  let approxBytes = 0;
  let full = false;
  return {
    columns,
    rows,
    /** Adds rows until the window fills; returns how many it took. */
    add(batch: Array<Record<string, unknown>>): number {
      let taken = 0;
      for (const raw of batch) {
        if (full) break;
        if (rows.length >= caps.maxRows) {
          full = true;
          break;
        }
        taken += 1;
        if (raw === undefined || raw === null) continue;
        const safeRow = sanitiseRowForJson(raw);
        for (const [name, scale] of decimals) {
          const text = formatArrowDecimal(raw[name], scale);
          if (text !== null) safeRow[name] = text;
        }
        for (const [name, format] of temporal) {
          const cell = safeRow[name];
          if (typeof cell === 'number') safeRow[name] = format(cell);
        }
        const rowBytes = utf8ByteLength(JSON.stringify(safeRow));
        if (approxBytes + rowBytes > caps.maxBytes) {
          full = true;
          taken -= 1;
          break;
        }
        approxBytes += rowBytes;
        rows.push(safeRow);
      }
      if (rows.length >= caps.maxRows) full = true;
      return taken;
    },
    isFull: () => full,
    /** Rows taken so far, measured as UTF-8 JSON. */
    bytes: () => approxBytes,
  };
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
  const accumulator = createRowAccumulator(table.schema.fields);
  const allRows = table.toArray();
  accumulator.add(allRows);
  const rowCount = allRows.length;
  return {
    columns: accumulator.columns,
    rows: accumulator.rows,
    rowCount,
    tooLarge: accumulator.isFull() && accumulator.rows.length < rowCount,
  };
}

/** Rows past the window of a result whose stream stays open, read on demand ("Load more"). */
export interface SqlResultCursor {
  /**
   * Reads up to `limit` more rows within `maxBytes` of JSON; `done` once DuckDB
   * has no more. Fewer rows with `done` false means the byte budget filled.
   */
  next(limit: number, maxBytes?: number): Promise<{ rows: Array<Record<string, unknown>>; done: boolean; bytes: number }>;
  /** Stops the statement and releases its connection. Safe to call twice. */
  close(): Promise<void>;
}

function createResultCursor(
  fields: ArrowTableLike['schema']['fields'],
  pending: Array<Record<string, unknown>>,
  stream: DuckDbResultStream,
  release: () => Promise<void>
): SqlResultCursor {
  let buffered = pending;
  let done = false;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    done = true;
    buffered = [];
    await release().catch(() => {});
  };
  return {
    async next(limit, maxBytes = Number.POSITIVE_INFINITY) {
      const accumulator = createRowAccumulator(fields, { maxRows: limit, maxBytes });
      while (!accumulator.isFull() && !closed) {
        if (buffered.length === 0) {
          if (done) break;
          // A failed read throws to the caller: treating it as the end would pass a partial result off as whole.
          const batch = await stream.next();
          if (batch === null) {
            done = true;
            break;
          }
          buffered = batch.toArray();
          continue;
        }
        const taken = accumulator.add(buffered);
        buffered = buffered.slice(taken);
      }
      const exhausted = done && buffered.length === 0;
      if (exhausted) await close();
      return { rows: accumulator.rows, done: exhausted || closed, bytes: accumulator.bytes() };
    },
    close,
  };
}

/**
 * Reads a streamed result until it ends or the window fills. On a full
 * window it cancels the rest and the row count becomes a lower bound;
 * with `keepOpen` it hands back a cursor over the rest instead.
 */
export async function readResultStream(
  stream: DuckDbResultStream,
  cancel?: () => Promise<boolean>,
  options: { keepOpen?: () => Promise<void> } = {}
): Promise<{
  columns: SqlColumnMetadata[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  tooLarge: boolean;
  rowCountIsLowerBound: boolean;
  cursor?: SqlResultCursor;
}> {
  let accumulator: ReturnType<typeof createRowAccumulator> | null = null;
  let seen = 0;
  let stoppedEarly = false;
  // Raw rows read past the window: the rest of the last batch, then the peeked one.
  let pending: Array<Record<string, unknown>> = [];
  for (let batch = await stream.next(); batch !== null; batch = await stream.next()) {
    accumulator ??= createRowAccumulator(batch.schema.fields);
    const rows = batch.toArray();
    seen += rows.length;
    const taken = accumulator.add(rows);
    if (accumulator.isFull()) {
      pending = rows.slice(taken);
      // Rows left in this batch, or any later batch, mean the total is unknown.
      const peek = taken < rows.length ? null : await stream.next().catch(() => true as const);
      if (peek !== null && peek !== true) pending = peek.toArray();
      stoppedEarly = taken < rows.length || peek !== null;
      break;
    }
  }
  accumulator ??= createRowAccumulator(stream.fields());
  const keepOpen = options.keepOpen;
  const cursor =
    stoppedEarly && keepOpen
      ? createResultCursor(stream.fields(), pending, stream, async () => {
          await cancel?.().catch(() => false);
          await keepOpen();
        })
      : undefined;
  if (stoppedEarly && !cursor) {
    try {
      await cancel?.();
    } catch {
      /* the window is already read; a failed cancel only wastes engine time */
    }
  }
  const rowCount = stoppedEarly ? Math.max(seen, accumulator.rows.length) : seen;
  return {
    columns: accumulator.columns,
    rows: accumulator.rows,
    rowCount,
    tooLarge: stoppedEarly || accumulator.rows.length < rowCount,
    rowCountIsLowerBound: stoppedEarly,
    ...(cursor ? { cursor } : {}),
  };
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
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>, sanitiseValueForJson);
  if (valueType === 'object') {
    const obj = value as Record<string, unknown>;
    // Arrow LIST and STRUCT cells are Vector / row objects; their toJSON is the plain value.
    if (typeof obj.toJSON === 'function') return sanitiseValueForJson((obj.toJSON as () => unknown)());
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      out[key] = sanitiseValueForJson(obj[key]);
    }
    return out;
  }
  return null;
}

/** Scale of an Arrow `Decimal[precision e±scale]` type, or null for other types. */
function decimalScale(type: string): number | null {
  const match = /^Decimal\[\d+e\+?(-?\d+)\]/u.exec(type);
  return match ? Number(match[1]) : null;
}

/**
 * Arrow Decimal cells (DuckDB SUM over integers, HUGEINT, DECIMAL) arrive as
 * little-endian 32-bit words of a two's-complement integer; render them as
 * exact decimal text instead of a word array.
 */
function formatArrowDecimal(value: unknown, scale: number): string | null {
  if (value === null || value === undefined || typeof value !== 'object') return null;
  const words = Array.from(value as ArrayLike<number>);
  if (words.length === 0 || words.some(word => typeof word !== 'number')) return null;
  let unscaled = 0n;
  for (let index = words.length - 1; index >= 0; index -= 1) {
    unscaled = (unscaled << 32n) | BigInt(words[index]! >>> 0);
  }
  const bits = BigInt(words.length * 32);
  if (unscaled >> (bits - 1n)) unscaled -= 1n << bits;
  const negative = unscaled < 0n;
  let digits = (negative ? -unscaled : unscaled).toString();
  if (scale > 0) {
    digits = digits.padStart(scale + 1, '0');
    digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  }
  return negative ? `-${digits}` : digits;
}

/**
 * Arrow hands DATE and TIMESTAMP cells back as epoch milliseconds; render
 * them as ISO text so the grid and import preview show calendar values.
 */
function temporalFormatter(type: string): ((epochMs: number) => string | number) | null {
  const iso = (epochMs: number) => {
    const date = new Date(epochMs);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  };
  if (/^Date(32)?<DAY>/u.test(type)) return epochMs => iso(epochMs)?.slice(0, 10) ?? epochMs;
  if (/^Date(64)?</u.test(type)) return epochMs => iso(epochMs) ?? epochMs;
  if (/^Timestamp</u.test(type)) {
    // Without a zone the value is a wall-clock time, so drop the UTC marker.
    const zoned = type.includes(',');
    return epochMs => {
      const text = iso(epochMs);
      if (!text) return epochMs;
      return zoned ? text : text.replace('Z', '');
    };
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
  /** Aborting asks DuckDB to stop and resolves `cancelled`. */
  signal?: AbortSignal;
  /** Keep a windowed result's stream open as `outcome.cursor` instead of cancelling it. */
  keepCursor?: boolean;
}

/** How long a cancelled or timed-out query gets to actually stop before the outcome reports it still running. */
export const CANCEL_SETTLE_MS = 5_000;

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

/** DuckDB's own reason for a failure, or undefined when the wasm build lost it. */
export function duckDbErrorDetail(err: unknown): string | undefined {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  return raw.trim() === '' || DUCKDB_WASM_INTERNAL_ERROR.test(raw) ? undefined : raw;
}

/** Statement count for the UX badge and the stream decision, from the shared splitter. */
export function countSqlStatements(query: string): number {
  return splitSqlStatements(query).length;
}

function emptyOutcome(
  status: DuckDbExecuteOutcome['status'],
  start: number,
  statementCount: number,
  errorMessage?: string
): DuckDbExecuteOutcome {
  return {
    status,
    rows: [],
    columns: [],
    rowCount: 0,
    durationMs: Math.round(performance.now() - start),
    tooLarge: false,
    statementCount,
    ...(errorMessage !== undefined ? { errorMessage } : {}),
  };
}

async function openConnection(
  start: number
): Promise<{ connection: DuckDbConnection } | { failure: DuckDbExecuteOutcome }> {
  let engine: DuckDbEngineHandle;
  try {
    engine = await getDuckDbEngine();
  } catch (err) {
    return { failure: emptyOutcome('engine-load-failed', start, 0, errorMessageForUser(err, 'unknown')) };
  }
  try {
    return { connection: await engine.connect() };
  } catch (err) {
    return {
      failure: emptyOutcome('engine-load-failed', start, 0, errorMessageForUser(err, 'connect failed')),
    };
  }
}

/** A query DuckDB may still be running blocks the worker, so its close is not awaited. */
const mayStillRun = (outcome: DuckDbExecuteOutcome | undefined) => outcome?.stillRunning === true;

async function closeQuietly(connection: DuckDbConnection, wait: boolean): Promise<void> {
  const closing = connection.close().catch(() => {
    /* defensive: closing twice should not propagate */
  });
  if (wait) await closing;
}

/**
 * Flush the WAL to the OPFS database file so a hard reload or crash does
 * not lose the writes. Best-effort: a failed CHECKPOINT never turns a
 * successful query into an error, and it is a cheap no-op on a read.
 */
async function checkpointIfPersistent(connection: DuckDbConnection): Promise<void> {
  if (resolvedStorageMode !== 'opfs') return;
  try {
    await connection.query('CHECKPOINT');
  } catch {
    /* durability is best-effort; the query already succeeded */
  }
}

const isResultStatus = (status: DuckDbExecuteOutcome['status']) =>
  status === 'success' || status === 'too-large';

/** Closing a cursor checkpoints what the run wrote, then frees the connection it kept. */
const releaseCursor = (connection: DuckDbConnection) => async () => {
  await checkpointIfPersistent(connection);
  await closeQuietly(connection, true);
};

/** Runs one piece of SQL on an open connection, racing the timeout and the abort signal. */
async function runOnConnection(
  connection: DuckDbConnection,
  trimmed: string,
  options: ExecuteQueryOptions
): Promise<DuckDbExecuteOutcome> {
  const start = performance.now();
  const statementCount = countSqlStatements(trimmed);
  const timeoutMs = Math.min(options.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS, MAX_QUERY_TIMEOUT_MS);
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let settleHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<QueryTimeoutSentinel>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs);
  });
  let removeAbortListener = () => {};
  const abortPromise = new Promise<'aborted'>((resolve) => {
    if (options.signal?.aborted) {
      resolve('aborted');
      return;
    }
    const onAbort = () => resolve('aborted');
    options.signal?.addEventListener('abort', onAbort, { once: true });
    removeAbortListener = () => options.signal?.removeEventListener('abort', onAbort);
  });
  const stopped = (status: 'timeout' | 'cancelled', stillRunning: boolean): DuckDbExecuteOutcome => ({
    ...emptyOutcome(
      status,
      start,
      statementCount,
      status === 'timeout' ? 'Query exceeded timeout' : 'Query cancelled'
    ),
    ...(stillRunning ? { stillRunning } : {}),
  });
  try {
    // One statement streams, so it can stop at the row window and be cancelled.
    const stream = statementCount === 1 ? connection.stream : undefined;
    const queryPromise: Promise<{
      columns: SqlColumnMetadata[];
      rows: Array<Record<string, unknown>>;
      rowCount: number;
      tooLarge: boolean;
      rowCountIsLowerBound?: boolean;
      cursor?: SqlResultCursor;
    }> = stream
      ? stream(trimmed).then((result) =>
          readResultStream(result, connection.cancel, options.keepCursor ? { keepOpen: releaseCursor(connection) } : {})
        )
      : connection.query(trimmed);
    // The connection closes after the caller is done, so a query that loses the race rejects late.
    void queryPromise.catch(() => {});
    const raceResult = await Promise.race([queryPromise, timeoutPromise, abortPromise]);
    if (isTimeoutSentinel(raceResult) || raceResult === 'aborted') {
      const status = raceResult === 'aborted' ? 'cancelled' : 'timeout';
      // A window that arrives after the stop has nobody to read it.
      void queryPromise.then((late) => late.cursor?.close(), () => {});
      // A timeout stops the statement like Cancel does, then waits to learn whether DuckDB stopped.
      await connection.cancel?.().catch(() => false);
      const settled = await Promise.race([
        queryPromise.then(
          () => true,
          () => true
        ),
        new Promise<false>((resolve) => {
          settleHandle = setTimeout(() => resolve(false), CANCEL_SETTLE_MS);
        }),
      ]);
      return stopped(status, !settled);
    }
    const { columns, rows, rowCount, tooLarge } = raceResult;
    return {
      status: tooLarge ? 'too-large' : 'success',
      rows,
      columns,
      rowCount,
      durationMs: Math.round(performance.now() - start),
      tooLarge,
      ...(raceResult.rowCountIsLowerBound ? { rowCountIsLowerBound: true } : {}),
      ...(raceResult.cursor ? { cursor: raceResult.cursor } : {}),
      statementCount,
    };
  } catch (err) {
    return emptyOutcome('sql-error', start, statementCount, errorMessageForUser(err, 'sql failed'));
  } finally {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    if (settleHandle !== null) clearTimeout(settleHandle);
    removeAbortListener();
  }
}

/**
 * Run a SQL query against the lazy-loaded DuckDB engine. Always
 * settles to a `DuckDbExecuteOutcome` — never throws. The caller
 * checks `outcome.status` to dispatch on success vs error.
 *
 * Connection lifecycle: a fresh connection is opened per call and
 * closed on settle. DuckDB's `connect` is cheap (~ms) so we don't
 * hold one open between user-driven runs.
 */
export async function executeQuery(
  query: string,
  options: ExecuteQueryOptions = {}
): Promise<DuckDbExecuteOutcome> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return { ...emptyOutcome('success', performance.now(), 0), durationMs: 0 };
  const opened = await openConnection(performance.now());
  if ('failure' in opened) return opened.failure;
  let outcome: DuckDbExecuteOutcome | undefined;
  try {
    outcome = await runOnConnection(opened.connection, trimmed, options);
    // An open cursor still reads on this connection; it checkpoints and closes it later.
    if (outcome.cursor) return outcome;
    if (isResultStatus(outcome.status)) await checkpointIfPersistent(opened.connection);
    return outcome;
  } finally {
    if (!outcome?.cursor) await closeQuietly(opened.connection, !mayStillRun(outcome));
  }
}

/**
 * Runs statements one by one on a single connection, so temp tables,
 * settings and transactions carry from one to the next. Stops at the
 * first statement that does not return a result; the outcomes cover
 * only the statements that ran.
 */
export async function executeSqlScript(
  statements: ReadonlyArray<string>,
  options: ExecuteQueryOptions & {
    onStatement?: (index: number, outcome: DuckDbExecuteOutcome) => void;
  } = {}
): Promise<DuckDbExecuteOutcome[]> {
  const pieces = statements.map((statement) => statement.trim()).filter((s) => s.length > 0);
  if (pieces.length === 0) return [];
  const opened = await openConnection(performance.now());
  if ('failure' in opened) return [opened.failure];
  const outcomes: DuckDbExecuteOutcome[] = [];
  try {
    for (const [index, piece] of pieces.entries()) {
      // Only the last statement may keep its stream: the next one would invalidate it.
      const keepCursor = options.keepCursor === true && index === pieces.length - 1;
      // A kept stream defers the closing checkpoint, so flush what the earlier statements wrote first.
      if (keepCursor && index > 0) await checkpointIfPersistent(opened.connection);
      const outcome = await runOnConnection(opened.connection, piece, { ...options, keepCursor });
      outcomes.push(outcome);
      options.onStatement?.(index, outcome);
      if (!isResultStatus(outcome.status)) break;
    }
    const last = outcomes[outcomes.length - 1];
    if (last?.cursor) return outcomes;
    if (!mayStillRun(last) && outcomes.some((outcome) => isResultStatus(outcome.status))) {
      await checkpointIfPersistent(opened.connection);
    }
    return outcomes;
  } finally {
    if (!outcomes[outcomes.length - 1]?.cursor) {
      await closeQuietly(opened.connection, !mayStillRun(outcomes[outcomes.length - 1]));
    }
  }
}

/**
 * Staged edits on one connection inside one transaction: each statement must
 * touch exactly one row, or everything is rolled back and nothing changes.
 */
export async function runEditTransaction(statements: ReadonlyArray<string>): Promise<{ applied: number } | { errorMessage: string }> {
  const opened = await openConnection(performance.now());
  if ('failure' in opened) return { errorMessage: opened.failure.errorMessage ?? 'The SQL engine could not start.' };
  const { connection } = opened;
  try {
    await connection.query('BEGIN TRANSACTION');
    for (const [index, statement] of statements.entries()) {
      const touched = readCountValue((await connection.query(statement)).rows[0]?.['Count']);
      if (touched !== 1) throw new Error(`Change ${index + 1} would touch ${touched} rows instead of one: the table changed since it was read, so nothing was saved.`);
    }
    await connection.query('COMMIT');
    await checkpointIfPersistent(connection);
    return { applied: statements.length };
  } catch (err) {
    await connection.query('ROLLBACK').catch(() => undefined);
    return { errorMessage: errorMessageForUser(err, 'unknown') };
  } finally {
    await closeQuietly(connection, true);
  }
}

/**
 * Drops the engine without a checkpoint, for a query that ignored Cancel.
 * In-memory tables are lost; the next run starts a fresh engine.
 */
export async function restartDuckDbEngine(): Promise<void> {
  await engineLifecycle.release({ afterTerminate: async () => resetResolvedStorageMode() });
}

// ---------------------------------------------------------------------------
// File → DuckDB table.
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
const IMPORT_PREVIEW_SAMPLE_ROWS = 10;

/**
 * Map an import format to its DuckDB reader call against a registered
 * virtual file `name`. The name is single-quote-escaped because it is
 * spliced into a SQL string literal (the file name, NOT an identifier).
 */
/**
 * Register a defensive COPY of the bytes. `AsyncDuckDB.registerFileBuffer`
 * postMessages the buffer to the worker with the underlying ArrayBuffer as
 * a transferable, which DETACHES the original `Uint8Array` on the main
 * thread. The import flow registers the same file twice (preview then
 * import), so handing the worker a fresh copy each time keeps the caller's
 * buffer alive for the second registration. A 25 MiB cap bounds
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
  /** Arrow type of each column, as DuckDB read it. */
  types: string[];
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
  csv?: SqlImportCsvOptions;
}): Promise<ImportPreview> {
  const engine = await getDuckDbEngine();
  if (typeof engine.registerFile !== 'function') {
    throw new Error('This SQL engine cannot register files for import.');
  }
  const name = virtualFileName(args.format);
  await registerFileCopy(engine, name, args.bytes);
  const connection = await engine.connect();
  try {
    const reader = readerSql(args.format, name, args.csv);
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
    return { columns, types: sample.columns.map((column) => column.type), sampleRows, rowCount };
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
 * to disk so it survives a reload — mirroring `executeQuery`'s
 * durability pass.
 */
export async function importFileAsTable(args: {
  fileName: string;
  /** A new table's name; ignored when `target` names an existing table. */
  tableName: string;
  format: SqlImportFormat;
  bytes: Uint8Array;
  csv?: SqlImportCsvOptions;
  /** Defaults to a new table named `tableName` with every column as read. */
  target?: SqlImportTarget;
  mapping?: ReadonlyArray<SqlImportColumnMap>;
}): Promise<ImportResult> {
  const engine = await getDuckDbEngine();
  if (typeof engine.registerFile !== 'function') {
    throw new Error('This SQL engine cannot register files for import.');
  }
  const name = virtualFileName(args.format);
  await registerFileCopy(engine, name, args.bytes);
  const connection = await engine.connect();
  const target: SqlImportTarget = args.target ?? { mode: 'new', table: args.tableName };
  let inTransaction = false;
  try {
    let mapping = args.mapping;
    if (!mapping) {
      const probe = await connection.query(`SELECT * FROM ${readerSql(args.format, name, args.csv)} LIMIT 0`);
      mapping = probe.columns.map((column) => ({ source: column.name, target: column.name }));
    }
    let inserted: number | null = null;
    for (const statement of buildImportStatements({ format: args.format, file: name, csv: args.csv, target, mapping })) {
      if (statement === 'BEGIN TRANSACTION') inTransaction = true;
      const result = await connection.query(statement);
      if (statement.startsWith('INSERT INTO')) inserted = readCountValue(result.rows[0]?.['Count']);
      if (statement === 'COMMIT') inTransaction = false;
    }
    const ident = quoteSqlTableReference(target.table, target.mode === 'existing' ? target.schema : undefined);
    const rowCount =
      inserted ?? readCountValue((await connection.query(`SELECT count(*) AS n FROM ${ident}`)).rows[0]?.['n']);
    if (resolvedStorageMode === 'opfs') {
      try {
        await connection.query('CHECKPOINT');
      } catch {
        /* durability is best-effort; the table already exists */
      }
    }
    return { table: target.table, rowCount };
  } catch (err) {
    // A failed row leaves an existing table as it was.
    if (inTransaction) await connection.query('ROLLBACK').catch(() => undefined);
    throw err;
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
