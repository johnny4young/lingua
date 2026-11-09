# Native Local SQL engine

Status: accepted as the desktop default. Desktop builds ship DuckDB's binding
for their platform and run Local SQL natively unless Settings chooses
WebAssembly; the web build keeps WASM. A profile that already saved its tables
in OPFS before this default keeps WebAssembly until the user switches, since
the native engine keeps its own file (settings migration v5).

## Context

Local SQL runs DuckDB-WASM (EH build, DuckDB 1.4.3) in a renderer worker on
web and desktop. WASM runs one thread, stays under a 4 GB heap and cannot
spill to disk. A benchmark on 2026-11-05 (5 million rows, Node 24, a loaded
machine, indicative only) put the official N-API binding of the same DuckDB
release far ahead: start 20 ms against 3,149 ms, queries 16 to 41 times
faster, peak footprint 371 against 656 MB, total CPU 1.0 against 3.7 s.

## Decision

**Process.** The native engine runs in utilityProcesses named `Lingua local
SQL` (`src/main/sqlLocal/`, bundled to `.vite/build/sqlLocal.js`), one per
window. Main starts a window's process on that window's first request and
stops it when the window reloads, navigates or closes, and on quit; it first
asks the process to close its engines (bounded at 3 s) so the database file
is checkpointed, then kills it. A forced restart for a statement that ignored
Cancel, an out-of-memory crash or a native abort ends only that window's
engine. A restart waits (up to 5 s) for the old process to exit before the
next one starts, so a lock the dying process still holds does not push the
next open to memory. Leftover files and spill folders are removed when main
starts the service and when a window's process stops. The sandboxed renderer
cannot load native code, and the remote SQL host is the wrong home: a remote
engine that cannot cancel restarts that host, which would drop Local's
in-memory tables, and Local's own restart would drop every remote session. A
separate process also keeps a native crash away from main and from remote
sessions, and shows Local's memory on its own line. The renderer reaches it
over `sql-local:*`; main validates every argument, stamps the sending window
as owner and decides every path. An id the window's process no longer holds
is an ordinary error; only a missing engine or a stopped process answers
`engine-gone`, which makes the renderer open a new engine.

**Package.** `@duckdb/node-api`, the binding DuckDB Labs maintains, pinned to
`1.4.3-r.3`, the release duckdb-wasm 1.32.0 is built from, so both engines
share SQL semantics and the storage format. It is N-API, so Electron needs no
rebuild, and ships prebuilt per platform without install scripts. The older
`duckdb` package is deprecated; building DuckDB ourselves or binding the C
API through FFI would add a toolchain and a maintenance burden for no gain.

**Sandbox.** Each window gets one instance, configured before any SQL runs:
extension install and autoload off, persistent secrets off, spill to the
window's temp folder, then `allowed_directories` (the window's files folder;
DuckDB adds its own temp folder to the list by itself),
`enable_external_access=false` and `lock_configuration=true`.
Without the lock, SQL could point `extension_directory` at an allowed folder
and download an extension, or set `profiling_output` to write outside the
sandbox; with it, every setting stays fixed. SQL therefore cannot `SET`
DuckDB options on the native engine; the grid explains that and points to the
WASM option. The process gets a minimal environment and its own HOME, so
DuckDB's `~/.duckdb` defaults never reach the user's folder.

**Parity.** Both engines feed the same preview window
(`src/shared/sqlResultRows.ts`). The native engine reports DuckDB-WASM's
Arrow type names and converts values to what WASM's Arrow rows become, so the
grid, imports, exports, staged edits and Copy to Local read the same results.
Results cross already capped to the preview window, and a top-level text or
blob cell is cut to that window's size (256 KiB) while the chunk is read, row
by row, so one huge value never becomes a huge string; a stream batch stays
near 8 MiB.
`tests/integration/duckdbBackendParity.test.ts` runs the client over both real
engines. Where WASM's Arrow mapping loses data (INTERVAL, TIME WITH TIME
ZONE, BIT, BIGNUM, UHUGEINT, DECIMAL and HUGEINT inside nested values,
infinite timestamps, repeated column names, streamed ENUMs on WASM's Node
build), the native engine keeps DuckDB's own value; the suite pins each case.
Two behaviours differ by design: the native engine runs on all cores, so
unordered results can come back in another order, and it follows the OS time
zone, while WASM derives a fixed offset from the clock.

**WASM stays.** The web build always runs WASM. On desktop, the option
`sqlWorkspaceLocalEngine` chooses; `native` falls back to WASM when the
build has no binding or the engine does not start, and Settings says so.

**Extensions.** The native library compiles in JSON, ICU and Parquet, the
three extensions Lingua vendors for WASM, so neither engine ever reaches
extensions.duckdb.org. Any other extension fails by name on both.

**Persistence.** With table persistence on, the native engine saves to
`userData/sql-local/lingua-sql.duckdb`; WASM keeps its OPFS file. One engine
holds the file at a time, as one WASM tab holds OPFS: main grants the file to
the first window that asks and opens the others in memory. Clearing stored
data removes both; while another window's engine holds the file, its process
refuses and Settings reports the failure. Existing OPFS tables are not copied to the native file.

## Measurements

Packaged arm64 app on an Apple Silicon Mac, `pnpm run smoke:desktop:packaged`
with `LINGUA_DESKTOP_SMOKE_SQL_LOCAL`, five million rows. The machine was
loaded (load average 8 to 14), so treat every figure as indicative. Each
query ran three times; the table shows the median wall time in the renderer,
IPC included.

| Query | WASM | Native |
|---|---|---|
| First query, engine start included | 667 ms | 82 ms |
| Small query (`range(1000)`) | 2 ms | 1 ms |
| Create the 5M-row table | 389 ms | 213 ms |
| Preview window of `SELECT *` | 32 ms | 16 ms |
| `GROUP BY` on 1,000 groups | 30 ms | 4 ms |
| Join plus aggregate | 128 ms | 9 ms |
| `ORDER BY` plus `LIMIT` | 71 ms | 4 ms |
| `GROUP BY` on text | 106 ms | 10 ms |
| Window function | 1,486 ms | 185 ms |

Footprint after the window query, from `footprint` per process: WASM keeps it
all in the renderer, 849 MB; native leaves the renderer at 225 MB and the
`Lingua local SQL` process at 296 MB, 520 MB together.

Package, arm64 `--dir` build: the app grows from 442.9 to 485.8 MB and its zip
from 171.7 to 186.4 MB once the thinned, stripped library ships (44 MB on
disk, about 15 MB compressed).

## Distribution and signing (for the change that ships it)

| Platform package | Size | Notes |
|---|---|---|
| darwin-arm64 | 111 MB | Universal library; thinned to arm64 53 MB, 45 MB with `strip -x` |
| darwin-x64 | 111 MB | Universal library; thinned the same way |
| linux-x64 | 65 MB | |
| win32-x64 | 35 MB | |

The change that ships it moves the package to `dependencies`, keeps only the
target's binding package, unpacks it from app.asar (`duckdb.node` loads
`libduckdb` from its own folder), thins and strips the macOS library in an
afterPack hook, and lets electron-builder sign it with the app identity and
hardened runtime; notarization covers it like any other Mach-O. The existing
entitlements suffice. Windows signs `duckdb.dll` through the existing hook.
There is no win32-arm64 package, so that platform reports the engine as
unavailable and keeps WASM.

## Residual risks

- DuckDB's file parsers and WAL replay now run as native code with the user's
  privileges instead of inside the sandboxed renderer. SQL can write a file in
  its folder and ATTACH it, or overwrite the database's WAL, which DuckDB
  always lets its own database reach; a crash before the next checkpoint
  replays it. Treat DuckDB patch releases as security updates.
- A statement can crash the engine process, for example `enable_logging`
  aimed at a refused folder makes a connection's destructor abort. The app
  keeps running, the next run starts a new engine, and in-memory tables are
  lost.

## Alternatives to shipping it in every package

- Download on demand: fetch the binding from Lingua's mirror, sha256-pinned and
  signed with Lingua's identity, the first time someone opts in.
- Desktop only, as now: the web build never carries it.
- An optional backend: a separate download that adds the engine.
