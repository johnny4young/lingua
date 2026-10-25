# Lingua testing guide

## Purpose

This document defines the executable end-to-end test matrix for Lingua across both supported surfaces:

- `web`: fast renderer/UI validation through local preview
- `electron`: full desktop validation including local filesystem access, native/compiled language support, and Electron-specific behavior

The goal is to keep current automation and future coverage planning in one
place:

- Playwright Web through `pnpm run test:e2e:web`
- opt-in visual snapshots through `pnpm run test:visual:web`
- component/unit coverage through `pnpm test -- --run`
- lightweight Electron Stagewright MCP desktop UI smoke through
  `pnpm run smoke:desktop:stagewright`
- real main/preload filesystem trust-boundary smoke through
  `pnpm run smoke:desktop:fs-ipc`
- managed Electron desktop smoke through `pnpm run smoke:desktop`
- packaged-app smoke through `pnpm run smoke:desktop:packaged`

This is an executable test reference, not a product roadmap. Add a flow when it
ships or when it becomes a required release gate; keep speculative planning out
of this document.

## Status Legend

- `✅ passed`
- `❌ failed`
- `⛔ blocked`
- `🕒 pending`

## Test Surfaces

### Web

Use the web flow for:

- shell UI
- toolbar
- overlays
- settings
- themes
- snippets
- command palette
- quick open
- console UI
- results dock UI
- responsive behavior
- browser-supported language execution

### Electron

Use the desktop flow for:

- Go and Rust execution
- local filesystem integration
- project explorer against real folders
- file watching
- plugin discovery
- updater state and actions
- preload/main bridge behavior
- Electron-specific startup and shutdown validation

## Standard Preconditions

### Baseline Gates

Run these before treating a broad UI/runtime change as healthy:

```bash
pnpm test -- --run
pnpm exec tsc --noEmit
pnpm run typecheck:tests
pnpm run lint
pnpm run check:i18n
pnpm run check:i18n:copy
```

Add `pnpm run check:performance`, `pnpm run check:licenses`, and
`pnpm run compliance:release` when the change touches release posture,
dependency/runtime assets, or public release evidence.

### Coverage

`pnpm run test:coverage` runs the same vitest suite instrumented with the v8
provider and writes `text-summary`, `json-summary`, and `lcov` reports to
`output/coverage/` (gitignored). The plain `pnpm test` stays uninstrumented so
the everyday gate keeps its speed. Timing benches (`*.bench.test.ts`) are
excluded per Vitest project only in the instrumented run: Vitest 5 does not
forward root CLI `--exclude` to inline projects. V8 instrumentation adds overhead
and can fail timing budgets for reasons unrelated to application behavior.
The report measures root `src/**`, including untested source, but not the
independently managed website or Workers projects. Their existing gates are
unchanged. The global thresholds in
`vitest.config.mts` are a manually maintained ratchet. Initial floors use
`Math.floor(measured percentage - 2)`: subtract two percentage points, then
round down to an integer (at least two but less than three points of headroom).

The root suite has two isolated Vitest projects. `node-operations` runs docs,
scripts, main-process, CLI, IPC, and shared-module tests in Node without
renderer-wide jsdom/i18n setup. `renderer-and-runtime` keeps jsdom and the
existing setup for all other root tests. The configuration guard requires
each root test to belong to exactly one project and keeps the independent
website outside this suite. Both projects retain per-file isolation; ordinary
tests still include timing benches, and CI runs project-template smoke separately.

| Metric | Initial measurement | Initial floor |
| --- | ---: | ---: |
| Lines | 80.69% | 78 |
| Statements | 77.92% | 75 |
| Functions | 78.99% | 76 |
| Branches | 69.82% | 67 |

A fresh full instrumented review run measured functions at 79.04%, raising
the configured function floor from 76 to 77; the other floors remain unchanged.
After the move to vitest 5, a fresh full run measured lines at 80.89%,
statements at 78.10%, functions at 79.06%, and branches at 70.01%, raising the
statement floor to 76 and the branch floor to 68.

After a fresh full instrumented run, raise a floor when that formula yields a
higher value; otherwise leave it unchanged. Never lower a floor to make a run
pass or substitute a partial-suite measurement. The command validates these
floors but does not automatically update them. CI enforces the floors in a
dedicated `coverage` job that runs beside the uninstrumented `unit` job, which
keeps the benchmarks gated.

Keep `vitest` and `@vitest/coverage-v8` pinned to the same exact version and
update them together: the provider declares an exact runner peer dependency.
The script quotes the benchmark glob so shells cannot turn matching files
into positional test filters. Benchmarks remain part of the ordinary test run.

### Web Base

```bash
pnpm run build:web
pnpm exec vite preview -- --config vite.web.config.mts --host 127.0.0.1 --port 4173
```

Pull requests run the full `pnpm run test:e2e:web` suite in a dedicated
`web-e2e` job. It runs in parallel with the Linux gate jobs (`static`, `unit`,
`coverage`, `build-web`, and `subprojects`), so a red gate in one of them
never hides the result of another. The job is a matrix of three shards on
separate runners; each shard builds its own `dist/web`, runs its slice of the
suite with `--shard=<n>/3`, and on failure uploads its traces and screenshots
as a `playwright-web-e2e-shard-<n>` artifact. Re-running failed jobs repeats
only the shard that failed. Reproduce one shard locally with
`pnpm run test:e2e:web --shard=2/3`. The job restores the Playwright browser
cache and uses CI-only timeout scaling so local feedback stays fast.

### Electron Base

For interactive desktop debugging, use the managed desktop launcher:

```bash
pnpm run dev:desktop
```

Or when main/preload changes require sync:

```bash
pnpm run dev:desktop:sync
```

For repeatable validation, prefer the scripted smoke commands:

```bash
pnpm run smoke:desktop:stagewright
pnpm run smoke:desktop:fs-ipc
pnpm run smoke:desktop
pnpm run smoke:desktop:offline
pnpm run smoke:desktop:packaged
```

The filesystem smoke builds no bundles itself: run
`pnpm run build:desktop-bundles` first. It creates a disposable project under
the current repository root, then verifies malformed write, delete, search,
bundle and watcher calls do not mutate files, open dialogs, or close a valid
watcher. The valid write/read/watch round-trip must still work with zero
renderer errors. If the checkout sits under a protected directory such as
`.codex`, set `LINGUA_SMOKE_FIXTURE_DIR` to a safe project directory; the
temporary fixture is removed on exit.

Desktop baseline must guarantee:

- renderer dev server is reachable
- Electron window opens without `chrome-error://chromewebdata/`
- Electron Stagewright can capture a non-empty accessibility snapshot and
  confirm zero renderer console errors
- closing Electron does not leave orphaned renderer/server processes
- compact-width shell behavior keeps the editor usable, with the sidebar switching to an overlay drawer instead of collapsing into an unusable split

Desktop bundle changes are also built on Linux, Windows, and macOS by the
`desktop-bundles` matrix. It exercises the native Vite production resolver and
its config-contract tests without signing or publishing installers; the Linux
leg also checks the built desktop renderer against its performance budget
(`docs/PERFORMANCE.md` § Review-time build budgets). A local
packaged-app smoke and release packaging/notarization remain separate evidence.
The independent-projects job tests and typechecks both Workers and runs Wrangler
`deploy --dry-run` for each; those commands build locally and do not deploy.
The update Worker also runs a workerd startup/health/404 integration test: a
successful dry-run bundle alone does not validate its exported entrypoints.

The `sql-engines` job starts throwaway Postgres 16, MySQL 8.4, SQL Server
2022 and ClickHouse 24.8 service containers and runs
`tests/integration/sqlHostEngines.test.ts` and
`tests/integration/sqlHostServerEngines.test.ts` against them: the row window
and paging, value types, server-side read-only (a rolled-back transaction on
SQL Server, `readonly = 2` on ClickHouse), the EXPLAIN estimate and SQL
Server's plan, cancel, staged edits, SSH tunnels, the `prefer` fallback and
auth failures. It also starts a libSQL server and Neon's HTTP proxy in front
of Postgres and runs `tests/integration/sqlHttpEngines.test.ts`: Turso and
Neon through the pinned transport, server-side read-only, the catalog, the
estimate, staged edits that commit and roll back, and a refused password.
`tests/integration/sqlCopyToLocal.test.ts` copies a Postgres and a MySQL
result through the host's paged runs into a real DuckDB-WASM table from
tables the suite creates, checks the Postgres copy's types, count and sum
against the server, and joins the two copies. D1
has no local server; its client is covered with a recorded transport in
`tests/shared/sqlHttp.test.ts`. Without `LINGUA_TEST_PG_URL`,
`LINGUA_TEST_MYSQL_URL`, `LINGUA_TEST_MSSQL_URL`, `LINGUA_TEST_CLICKHOUSE_URL`,
`LINGUA_TEST_LIBSQL_URL` and `LINGUA_TEST_NEON_HTTP_URL` (its path names the database, `shop` by default) the tests skip, so
locally point them at Docker containers to run them.

Windows PRs also run the narrow `windows-path-hardening` CI job. Besides the
filesystem permission regression, it executes the real
`cmd.exe /d /c npm.cmd` dependency-install boundary against a deterministic
loopback registry that returns registry-shaped JSON 404 responses. The expected
result is npm's normal non-zero exit; `ENOENT`, `EINVAL`, `binary-missing`, or a
command-not-recognized diagnostic means the platform launcher regressed before
npm started. The guard also requires npm's own error signature so a successful
`cmd.exe` process cannot hide a missing `npm.cmd`.

## Fixtures

- `PROJECT_FIXTURE`
  - nested directories
  - multiple languages
  - empty directory
  - rename/delete-safe throwaway files
- `PLUGIN_FIXTURE`
  - optional local plugin manifests for desktop validation
- `LANG_FIXTURE`
  - runnable and failing examples for JS, TS, Python, Go, Rust

## Selector Strategy

Use this order when automating:

1. `getByRole(...)`
2. `title`
3. stable visible text
4. future improvement: add `data-testid` to high-value shell and overlay elements

## Tags

- `smoke`
- `regression`
- `responsive`
- `language`
- `desktop-only`

## Matrix

## Shell / Layout / Navigation

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| 🕒 | `TC-001` | `WEB` | `developer` | Open app | Toolbar, shell, and welcome state render without fatal error |
| ✅ | `TC-002` | `ELEC` | `developer` | Open app | Main window opens and shell renders without `chrome-error` |
| 🕒 | `TC-003` | `WEB` | `developer` | Inspect toolbar | Buttons exist: sidebar, run, new file, quick open, command palette, snippets, console, settings |
| ✅ | `TC-004` | `ELEC` | `developer` | Inspect toolbar | Same controls exist in desktop shell |
| ✅ | `TC-005` | `BOTH` | `developer` | Click `Settings` | Settings modal opens |
| ✅ | `TC-006` | `BOTH` | `developer` | Close settings by close button and backdrop | Settings modal closes both ways |
| ✅ | `TC-007` | `BOTH` | `developer` | Click `Snippets` | Snippets modal opens |
| ✅ | `TC-008` | `BOTH` | `developer` | Open command palette | Palette opens and focus lands in search input |
| ✅ | `TC-009` | `BOTH` | `developer` | Toggle sidebar | Sidebar changes visible/hidden |
| ✅ | `TC-102` | `BOTH` | `developer` | On a Utilities tab, press `Cmd/Ctrl+B` twice, then `Cmd/Ctrl+K` | The tool list opens from its icon rail and folds back without touching the explorer; `Cmd/Ctrl+K` opens it with search focused |
| ✅ | `TC-103` | `BOTH` | `developer` | In the palette, press `Tab` and `Shift+Tab`, then type a query | Selection jumps between group headers; Recent shows only on the empty query and the first filtered row is the best match |
| ✅ | `TC-010` | `BOTH` | `developer` | Show or hide the dock | Dock folds to its tab row and reopens |
| ✅ | `TC-011` | `BOTH` | `developer` | With no tabs, inspect `Run` | Run is disabled |
| ✅ | `TC-012` | `BOTH` | `developer` | Create JS file from primary new-file action | JS tab is created and becomes active |
| ✅ | `TC-013` | `BOTH` | `developer` | Open new-file menu and create Go file | Go tab is created |
| ✅ | `TC-014` | `BOTH` | `developer` | Open multiple tabs and switch active tab | Active tab changes correctly |
| ✅ | `TC-015` | `BOTH` | `developer` | Edit tab content | Dirty indicator appears |
| ✅ | `TC-016` | `BOTH` | `developer` | Close inactive tab | Tab disappears without breaking selection |
| ✅ | `TC-017` | `BOTH` | `developer` | Close active tab | Focus moves to another tab or empty state |
| ✅ | `TC-018` | `BOTH` | `developer` | Open template from welcome state | Tab opens with expected code |
| ✅ | `TC-019` | `BOTH` | `developer` | Use quick-start language button | Tab opens in selected language |
| ✅ | `TC-020` | `BOTH` | `developer` | Inspect empty-state shortcut hints | `Cmd+Shift+P`, `Cmd+B`, `Cmd+Enter` hints are visible |

## Command Palette / Quick Open

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | `TC-021` | `BOTH` | `developer` | Open command palette, search template | Matching results are shown |
| ✅ | `TC-022` | `BOTH` | `developer` | Use `ArrowDown/ArrowUp` in palette | Selection changes |
| ✅ | `TC-023` | `BOTH` | `developer` | Press `Enter` on template in palette | Template opens in tab |
| ✅ | `TC-024` | `BOTH` | `developer` | Search action `Open Settings` | Correct action runs |
| ✅ | `TC-025` | `BOTH` | `developer` | Search snippets in palette | Saved snippets appear |
| ✅ | `TC-026` | `BOTH` | `developer` | Press `Escape` in palette | Palette closes |
| ✅ | `TC-027` | `BOTH` | `developer` | Open quick open with tabs/project | Open tabs and project files are listed |
| ✅ | `TC-028` | `BOTH` | `developer` | Search by file name in quick open | Results filter by name |
| ✅ | `TC-029` | `BOTH` | `developer` | Search by path in quick open | Results filter by path |
| ✅ | `TC-030` | `BOTH` | `developer` | Press `Enter` on quick open result | Existing tab activates or file opens |

## Snippets

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | `TC-031` | `BOTH` | `developer` | Open snippets when empty | Empty state is shown |
| ✅ | `TC-032` | `BOTH` | `developer` | Click `Save Active Tab` | Snippet form is prefilled from active tab |
| ✅ | `TC-033` | `BOTH` | `developer` | Save a new snippet | Snippet appears in the list |
| ✅ | `TC-034` | `BOTH` | `developer` | Edit existing snippet | Changes persist in UI/store |
| ✅ | `TC-035` | `BOTH` | `developer` | Click `Open in New Tab` from snippet | New tab opens with snippet code |
| ✅ | `TC-036` | `BOTH` | `developer` | Click `Insert into Active Tab` | Snippet code is inserted into current tab |
| ✅ | `TC-037` | `BOTH` | `developer` | Delete snippet | Snippet disappears |
| ✅ | `TC-038` | `BOTH` | `developer` | Open snippets from command palette | Snippets modal opens |
| ✅ | `TC-039` | `BOTH` | `developer` | Close snippets by button and backdrop | Snippets modal closes |
| ✅ | `TC-040` | `BOTH` | `developer` | Reload app | Snippets persist |

## Settings / Updates / Plugins

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | `TC-041` | `BOTH` | `developer` | Open settings > appearance | Dark, Light and System shell options are visible |
| ✅ | `TC-042` | `BOTH` | `developer` | Switch to light mode | Shell changes to light theme and persists |
| ✅ | `TC-043` | `BOTH` | `developer` | Switch to dark mode | Shell changes to dark theme and persists |
| ✅ | `TC-101` | `BOTH` | `developer` | Pick System, flip the OS color scheme | Shell and Lingua editor theme follow the OS live and on reload |
| ✅ | `TC-044` | `BOTH` | `developer` | Change editor theme | Monaco theme changes |
| ✅ | `TC-045` | `BOTH` | `developer` | Change font family | Monaco uses selected font |
| ✅ | `TC-046` | `BOTH` | `developer` | Change font size | Monaco font size changes |
| ✅ | `TC-047` | `BOTH` | `developer` | Toggle line numbers | Monaco gutter updates |
| ✅ | `TC-048` | `BOTH` | `developer` | Toggle word wrap | Monaco wrapping updates |
| ✅ | `TC-049` | `BOTH` | `developer` | Toggle minimap | Monaco minimap updates |
| ✅ | `TC-050` | `BOTH` | `developer` | Change layout horizontal/vertical/editor-only | Shell panels rearrange correctly |
| ✅ | `TC-104` | `BOTH` | `developer` | In Settings press `Cmd/Ctrl+1`–`9` and `0`, then click a section chip on the Editor tab | Tabs open in rail order (Plugins and Labs have no number); the chip scrolls to its section and stays pressed while that section is in view |
| ✅ | `TC-105` | `BOTH` | `developer` | Settings → Privacy → Local data → `Clear everything…` | One confirmation lists the stores (SQL queries and History included), the SQL database and the capsules; confirming clears them and keeps HTTP requests, notebooks and the session |
| ✅ | `TC-106` | `BOTH` | `developer` | Settings › Labs: turn on the network policy, set Block, run a JS `fetch` | The request fails with a message naming the host, and Recent activity shows it |
| ✅ | `TC-107` | `BOTH` | `developer` | Network policy Ask, run a JS `fetch` to a new host, choose Allow in this tab, run again | One dialog names the host while the run waits; the request goes through and the second run does not ask |
| ✅ | `TC-108` | `BOTH` | `developer` | SQL tab: Try a sample table, Run, click the table in the Explorer, then `Cmd/Ctrl+B` twice | Six rows with revenue right-aligned under a *ran from the editor* strip; the table opens under a generated SELECT with Edit in editor; the Explorer folds to its rail and back |
| ✅ | `TC-109` | `BOTH` | `developer` | SQL result: select a row and press `Cmd/Ctrl+C`; open Export full result…, pick TSV, Export… | The row lands on the clipboard as JSON; the dialog states the row count and downloads a `.tsv` |
| ✅ | `TC-110` | `BOTH` | `developer` | SQL: type three statements, `Cmd/Ctrl+Enter` on the second, then `Cmd/Ctrl+Shift+Enter` | The header reads *3 statements · cursor in 2*; the first run shows one result, Run all shows Result 1–3 and Messages |
| ✅ | `TC-111` | `BOTH` | `developer` | SQL: run `SELECT * FROM range(100000000)`, then Cancel during a long cross join, then run `SELECT 42` | The first result reads *≥ N rows* without a count query; Cancel shows *Query cancelled*; `SELECT 42` returns on the same engine |
| ✅ | `TC-112` | `BOTH` | `developer` | SQL on Free with one code tab: open query tabs until the budget is reached | The third tab opens, the fourth shows the upgrade notice; the tab row reads *Free: 3 open tabs, SQL included* |
| ✅ | `TC-113` | `BOTH` | `developer` | SQL: Explain a GROUP BY over the sample table; `Cmd/Ctrl+S` a scratch into a new folder; open a History entry | The Plan tab shows operators with times and the slowest highlighted; the query lands in its folder; the entry opens in a new scratch without running |
| ✅ | `TC-114` | `BOTH` | `developer` | SQL: run a 30,000-row SELECT, Load more, right-click a cell → Filter by this value, Apply to query | The grid grows past the window without a re-run; a condition chip and the generated SQL appear; the editor gets the query wrapped as a subquery |
| ✅ | `TC-115` | `BOTH` | `developer` | SQL: open a table with a foreign key from the Explorer, follow a link, open a value, go back | The referenced row opens with *back to*; JSON shows pretty-printed, a PNG BLOB shows its type; *Referenced by* counts the pointing rows |
| ✅ | `TC-116` | `BOTH` | `developer` | SQL: sort a windowed result, Export full result… as CSV and as XLSX, then cancel a Markdown export | Every row downloads in the grid order; the XLSX is a workbook; Cancel shows *Export cancelled* and keeps the dialog |
| ✅ | `TC-117` | `BOTH` | `developer` | SQL (ES): import a semicolon CSV into an existing table with a mapping, then a file with a bad row | *Se agregaron 2 filas*; the bad file adds nothing and the preview stays open |
| ✅ | `TC-118` | `WEB` | `developer` | SQL: 100,000 rows by 100 columns in the grid (`SqlResultGridScale.test.tsx`) and in a browser | A screenful of rows is mounted; the rail summarizes the first 10,000 rows and says so; Load more stops at 40,000 rows for 100 columns |
| ✅ | `TC-119` | `ELEC` | `developer` | Labs › Database connections on: paste a Postgres URL into New connection, Test connection, Save, run a 25,000-row SELECT, Load more, then Cancel a `pg_sleep` | The URL field loses the password; every step reads ok with its time; the grid loads past the window from the host and Cancel stops the server backend |
| ✅ | `TC-120` | `ELEC` | `developer` | Move that connection to prod, run an UPDATE, type the name; add a MySQL connection with Ask each session and a SQLite file, then a fourth | Read-only turns on and a red band shows; the confirm shows the EXPLAIN estimate and the write answers with a Count row; after a restart MySQL asks for its password and again after a wrong one; the fourth offers Open without saving |
| ✅ | `TC-121` | `WEB` | `developer` | Labs › Database connections on, open the connection picker | Local, New connection, Open from URL without saving and a DESKTOP ONLY row naming Postgres, MySQL, SQL Server, ClickHouse, SQLite and D1 with the browser and Cloudflare reason; no saved count and no Manage connections… |
| ✅ | `TC-122` | `ELEC` | `developer` | On a Postgres connection, open the Explorer, a second schema, then `orders`; switch its chips to Keys, DDL and Data; press Refresh | The first schema opens on its tables with row estimates, the second reads only when opened; the detail shows PK, FK and indexed columns, the DDL and Copy DDL; Data runs `SELECT * FROM "public"."orders" LIMIT 100;` on the connection; Refresh reads the levels again |
| ✅ | `TC-123` | `ELEC` | `developer` | On the SQL tab press `Cmd/Ctrl+P`, type `ord ite`, then try `Enter`, `Cmd/Ctrl+Enter` and `Alt+Enter` | Tables, views and functions of the connection come before files with their connection name; on a table Enter opens the data, Cmd/Ctrl+Enter the structure, Alt+Enter puts the quoted name at the cursor; a function opens its DDL |
| ✅ | `TC-125` | `WEB` | `developer` | On the SQL tab with a Local table and a saved query, press `Cmd/Ctrl+P` | The table and the saved query come before files with Local and saved as their source; Enter opens the table's rows or the query |
| ✅ | `TC-126` | `ELEC` | `developer` | New connection to Postgres through an SSH bastion with a password; Test connection, Trust this key, Test again, Save, run a 25,000-row SELECT and Load more | The first test stops at SSH with the bastion's SHA256 fingerprint (the same as `ssh-keygen -l`); after trusting it every step passes, including TCP to the bastion and SSH; the Explorer, the run and Load more go through the tunnel |
| ✅ | `TC-127` | `ELEC` | `developer` | Edit that connection: switch to Private key, pick a key under `~/.ssh`, add a jump host, toggle Confirm every write and run a DELETE | The key file is accepted from `~/.ssh` or an unprotected folder and refused from another credentials folder such as `~/.aws`; the SSH secret is no longer shown as kept once the sign-in changes; the chain lists the jump; the DELETE asks for the typed name outside production |
| ✅ | `TC-128` | `ELEC` | `developer` | Open Manage connections…, search, move a connection to a new group, rename the group, duplicate one and delete the copy, then Export JSON | Rows group and filter as typed; the move and rename save without asking for passwords again; the copy asks for its own password; the exported file lists the connections without passwords and is readable only by the user |
| ✅ | `TC-129` | `ELEC` | `developer` | Import a DBeaver `data-sources.json` and the `.env` of an open project; keep the defaults and Import; run a query on one | Connections already saved are marked and unchecked; Free stops at its limit; nothing shows a password; the first run asks for the password, and after it signs in a Keychain connection no longer asks |
| ✅ | `TC-130` | `ELEC` | `developer` | With Edit table rows on, open a Postgres table with a primary key from the Explorer; edit a cell, delete a row, add one, Review SQL and Commit; then stage an edit on a row, delete that row outside the app, and Commit | The review lists one transaction: UPDATE and DELETE by the key, then the INSERT; Commit reports the count and reads the table again; the second Commit saves nothing, names the change that touched 0 rows and keeps the changes staged |
| ✅ | `TC-131` | `ELEC` | `developer` | Open a Local table without a primary key, a view, and a table on a read-only connection; then turn on Confirm every write and Commit an edit | The Local table edits by rowid; the view and the read-only table say why they are read-only and offer no editing; Commit asks for the typed name before writing |
| ✅ | `TC-132` | `ELEC` | `developer` | With Edit table rows on, save a SQL Server connection, open a table from the Explorer, edit a cell, Review SQL and Commit, then Explain a SELECT | The tree lists Tables, Views, Functions and Sequences under dbo; Data reads `SELECT TOP (100)`; the review binds the change in one transaction and Commit reads the table again; Explain shows the estimated plan without running the statement |
| ✅ | `TC-133` | `ELEC` | `developer` | With Edit table rows on, save a ClickHouse connection on port 8123 with SSL off, open a table, then run an INSERT on it while it is read-only | Databases show as schemas with tables, views and materialized views; the grid shows wide integers as text and says the table is not edited row by row; the INSERT is refused by the server and allowed once confirmed |
| ✅ | `TC-134` | `ELEC` | `developer` | Save a Turso connection to a local libSQL server with TLS off and no token, test it and run a query; then fill a D1 connection with an account, database id and a wrong token and test it | The test lists resolve, policy, TCP, TLS skipped, auth and the libSQL version; the grid shows integers past 2^53 as text and blobs as base64; the D1 test resolves `api.cloudflare.com` and fails at auth |
| ✅ | `TC-135` | `WEB` | `developer` | With Database connections on in the browser, open the picker, then New connection: paste a `libsql://…?authToken=…` URL, test it with a wrong token and the right one, open it for this tab and run a query; paste a Neon `postgresql://` string, open it and commit a staged edit | The picker lists the socket engines and D1 as DESKTOP ONLY; the sheet offers Turso and Neon only and says the token stays in the tab; the URL field drops the token; the wrong token fails at auth; queries and the edit run from the browser; reloading forgets the connections |
| ✅ | `TC-136` | `WEB` `ELEC` | `developer` | Run a read query on a connection (a Turso tab connection on the web, Postgres on desktop), open Export full result…, Copy to Local as table and Create; open a Postgres table from the Explorer and copy it too; run an UPDATE on the connection and open the dialog again | The row reads Copy to Local as table with its hint on its own line; progress counts the rows and the notice says how many were copied; the Local Explorer lists the table with its row count (the whole table, not the 100-row preview) and the connection's name, the copy and the date in the tooltip; integers stay exact past 2^53 and bytes stay bytes; after the UPDATE the row keeps the Copy to Local title and says a single read query is needed |
| ✅ | `TC-137` | `WEB` | `developer` | Open the HTTP workspace, create a request, type `{{base}}/users` with no environment, then a full URL to a JSON API; Send it, fold a node, search a value inside a folded node, hover a value and click Capture, then turn on Wrap | Send stays off with the hint naming what is missing and the token red; the response opens as a tree with sizes, the search count matches and unfolds the hidden node, Capture adds the rule, opens the Capture tab and marks the value `captured → name`; long values scroll until Wrap is on |
| ✅ | `TC-138` | `ELEC` | `developer` | In the desktop HTTP workspace, send a GET to an HTTPS host and to an HTTP host that redirects once, open Timing, then send the same request again; move through the JSON tree with the keyboard | Timing lists DNS, Connect, TLS, Waiting and Download (TLS is 0 on HTTP) with the total and 1 redirect for the redirecting host; the header shows the change from the previous response; one Tab enters the tree, arrows move and fold, C captures |
| ✅ | `TC-140` | `WEB` | `developer` | Turn on Settings › Labs › HTTP variable scopes; add a collection variable, a request Vars row and two environments (one named prod), then use all three in a URL with one variable only the other environment defines | Each token takes its scope's colour and the missing one is red; chips name the scope and what it overrides, secrets masked; prod tints the selector, tabs and Send red; Add to prod copies the missing value and Send turns on; with the flag off only the environment resolves |
| ✅ | `TC-139` | `WEB` | `developer` | In the HTTP workspace, go offline (DevTools or the system), Send a GET and a POST to an internet host and one GET to `localhost`, then come back online | The localhost request sends; the others read Send when online, then Queued, and the last response stays; back online the GET sends by itself and the POST reads Send now until clicked |
| ✅ | `TC-124` | `ELEC` | `developer` | Run a query on a connection, open History, switch the query to Local, then save a query on each | History names the connection and lists only its runs; Local lists only its own; saved queries show their connection, RO for a read-only one; Format and completion follow the engine |
| 🕒 | `TC-051` | `WEB` | `developer` | Open settings > updates | Unsupported web update message is shown and controls are disabled |
| ✅ | `TC-052` | `ELEC` | `developer` | Open settings > updates | Desktop update state renders correctly |
| ✅ | `TC-053` | `ELEC` | `developer` | Click `Check now` | Update flow starts without crash |
| 🕒 | `TC-054` | `WEB` | `developer` | Open settings > plugins | Web shows unavailable/not-supported plugin state |
| ✅ | `TC-055` | `ELEC` | `developer` | Click `Refresh` in plugins | Refresh runs without crash |
| ✅ | `TC-056` | `ELEC` | `developer` | Inspect plugin list | Installed plugins show name, status, and message |

## Explorer / Project Files

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | `TC-057` | `ELEC` | `developer` | Open fixture project | Explorer shows expected tree |
| ✅ | `TC-058` | `ELEC` | `developer` | Expand/collapse directories | Directory state changes correctly |
| ✅ | `TC-059` | `ELEC` | `developer` | Open file from explorer | Tab opens with correct content |
| ✅ | `TC-060` | `ELEC` | `developer` | Create root file | File appears in tree |
| ✅ | `TC-061` | `ELEC` | `developer` | Create root folder | Folder appears in tree |
| ✅ | `TC-062` | `ELEC` | `developer` | Create file inside folder | File appears in correct directory |
| ✅ | `TC-063` | `ELEC` | `developer` | Rename file/folder | Tree updates with new name |
| ✅ | `TC-064` | `ELEC` | `developer` | Delete file/folder | Entry disappears |
| ✅ | `TC-065` | `ELEC` | `developer` | Click refresh tree | Tree reloads and expansion remains coherent |
| ✅ | `TC-066` | `ELEC` | `developer` | Modify filesystem outside app | Watch sync updates tree automatically |

## Console / Results

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | `TC-067` | `BOTH` | `developer` | Run code and inspect console | Console shows logs |
| ✅ | `TC-068` | `BOTH` | `developer` | Toggle log/info/warn/error filters | Visible entries change correctly |
| ✅ | `TC-069` | `BOTH` | `developer` | Toggle timestamps | Timestamps show/hide |
| ✅ | `TC-070` | `BOTH` | `developer` | Click clear console | Console becomes empty |
| ✅ | `TC-071` | `BOTH` | `developer` | Inspect inline results | Values align with editor lines |
| ✅ | `TC-072` | `BOTH` | `developer` | Run a Go or JSON tab | Output or the validation report shows in the dock Console tab |
| ✅ | `TC-073` | `BOTH` | `developer` | Toggle `undef` | Undefined results hide/show |
| ✅ | `TC-074` | `BOTH` | `developer` | Run failing code | Error is visible with line info if available |
| ✅ | `TC-075` | `BOTH` | `developer` | Run code | Execution time appears |

## Languages

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| 🕒 | `TC-076` | `WEB` | `developer` | Run JS hello world | Output is correct |
| 🕒 | `TC-077` | `WEB` | `developer` | Run JS with multiple logs | Console shows all logs in order |
| 🕒 | `TC-078` | `WEB` | `developer` | Run JS runtime error | Error renders without crashing shell, the editor highlights the reported source line, and the failing location is revealed automatically |
| 🕒 | `TC-079` | `WEB` | `developer` | Run JS infinite loop candidate | Loop protection stops execution as expected |
| 🕒 | `TC-080` | `WEB` | `developer` | Run TS hello world | Output is correct |
| 🕒 | `TC-081` | `WEB` | `developer` | Run TS type error case | Type/compile error is shown and does not get overwritten by runtime execution markers |
| 🕒 | `TC-082` | `WEB` | `developer` | Run Python print | Output is correct |
| 🕒 | `TC-083` | `WEB` | `developer` | Run Python syntax/runtime error | Error renders correctly, the editor highlights the reported source line when available, and the failing location is revealed automatically |
| 🕒 | `TC-084` | `WEB` | `developer` | Open Go/Rust in web | Explicit limitation or supported behavior is shown correctly |
| ✅ | `TC-085` | `ELEC` | `developer` | Run JS hello world | Output is correct |
| ✅ | `TC-086` | `ELEC` | `developer` | Run TS hello world | Output is correct |
| ✅ | `TC-087` | `ELEC` | `developer` | Run Python hello world | Output is correct |
| ✅ | `TC-088` | `ELEC` | `developer` | Run Go hello world | Compile and execution succeed |
| ✅ | `TC-089` | `ELEC` | `developer` | Run Go compile error case | Compile error is visible, the editor can highlight the reported source location, and the failing line is revealed automatically |
| ✅ | `TC-090` | `ELEC` | `developer` | Run Rust hello world | Compile and execution succeed |
| ✅ | `TC-091` | `ELEC` | `developer` | Run Rust compile error case | Compile error is visible, the editor can highlight the reported source location, and the failing line is revealed automatically |

## Responsive / Persistence / Shutdown

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| 🕒 | `TC-092` | `WEB` | `developer` | Run on mobile viewport | Toolbar, overlays, and compact sidebar drawer remain usable, no critical overflow, the drawer closes via backdrop, close button, `Escape`, or explorer navigation, focus returns cleanly after dismissal, keyboard focus stays trapped inside while open, and the background shell stays inert with scrolling locked until close |
| 🕒 | `TC-093` | `WEB` | `developer` | Run on tablet viewport | Settings, snippets, and compact shell transitions adapt layout correctly, the explorer transitions from drawer to persistent sidebar without losing usability, and temporary modal locks are cleared after widening |
| 🕒 | `TC-094` | `WEB` | `developer` | Run on wide desktop viewport | Shell, persisted sidebar width, and welcome state render without clipping |
| ✅ | `TC-095` | `ELEC` | `developer` | Open then close app | No orphaned processes remain |
| ✅ | `TC-096` | `ELEC` | `developer` | Reopen app after close | App starts cleanly again |
| ✅ | `TC-097` | `ELEC` | `developer` | Trigger shortcuts `Cmd+B`, `Cmd+\\`, `Cmd+P`, `Cmd+Shift+P`, `Cmd+,`, `Cmd+Enter` | Correct shell actions run |
| ✅ | `TC-098` | `BOTH` | `developer` | Reload app | Theme, layout, snippets, and editor settings persist, and the saved shell theme reapplies immediately on reload |
| ✅ | `TC-099` | `BOTH` | `developer` | No project and no tabs | Empty state and CTAs are correct |
| ✅ | `TC-100` | `BOTH` | `developer` | End of suite cleanup | No blocking console errors and no zombie process left |

## Suite Grouping

### `suite-smoke`

- `TC-001` to `TC-010`

### `suite-shell`

- `TC-011` to `TC-030`

### `suite-snippets-settings`

- `TC-031` to `TC-056`

### `suite-explorer-desktop`

- `TC-057` to `TC-066`

### `suite-console-results`

- `TC-067` to `TC-075`

### `suite-languages-web`

- `TC-076` to `TC-084`

### `suite-languages-electron`

- `TC-085` to `TC-091`

### `suite-responsive`

- `TC-092` to `TC-094`

### `suite-persistence-shutdown`

- `TC-095` to `TC-100`

## Standard Test Metadata Template

Each automated test should record:

- `id`
- `title`
- `target`
- `tags`
- `preconditions`
- `steps`
- `assertions`
- `artifacts`

## Exit Criteria For Stable Coverage

Do not treat the app as E2E-stable unless the following minimum suites pass:

- `suite-smoke`
- `suite-shell`
- `suite-snippets-settings`
- `suite-console-results`
- `suite-languages-web`
- `suite-languages-electron`
- `suite-persistence-shutdown`

---

## Known Issues and Testing Notes

### TC-026 — Escape key from command palette input

The code path is correct (`handleCloseOnEscape` in `CommandPalette` + global `useGlobalShortcuts` Escape handler), but when testing via `mcp__computer-use` the `key "escape"` action does not reliably reach the Electron renderer's focused input — it appears to be consumed at the macOS system level. Manual verification with a real keyboard is needed to confirm this case. Backdrop click (TC-026 fallback) closes the palette correctly.

**Reproduce**: `Cmd+Shift+P` → type text → press `Esc`. Expect palette closes.

### TC-100 — No blocking console errors (Electron)

Output for every language lands in the results dock's Console tab (INF/LOG/WRN/ERR); JS/TS/Python per-line values stay inline in the editor, and validation reports render at the top of Console. (The 2026-04-12 session below predates the dock and used a right-side results column.)

### Fixes applied during 2026-04-12 testing session

| Area | Fix |
|---|---|
| Monaco crash | Split `configureMonaco()` from `applyTypeScriptDefaults()` — TS config now in `beforeMount` callback |
| Electron modal drag blocking | Added `-webkit-app-region: no-drag` to `.overlay-backdrop` in `index.css` |
| Dev launcher update URL | Added `__LINGUA_UPDATE_URL__` define to esbuild command in `run-electron-desktop.mjs` |
| Unit test alignment | Updated `monaco.test.ts` to match refactored two-function API |

### Service-test isolation

Fetch service suites install their own `vi.stubGlobal` mock in every relevant
case and restore it with `vi.unstubAllGlobals` during teardown. They assert
the original fetch identity before each case and after cleanup, without
calling the original implementation. The suites also pass in random order
(`pnpm exec vitest run tests/services --sequence.shuffle`); CI runs them in
the default order.
`tests/services/**` participates in the scoped strict test typecheck.
Device-fingerprint tests retain their DOM environment.

### Automatic execution evidence

Recent Runs and Compare E2E cases replace the editor with a unique output
marker and wait for that output plus the automatic runner's settled signal
and absence of terminal failure notices. Auto-run does not own the manual
tab execution-state badge.
A prior result or idle-before-debounce cannot satisfy the wait. Recent Runs
covers both locales, delayed execution, manual recording and second-tab
isolation. Negative-observation waits for lazy resources remain separate.


## First-use guidance and download choice

`tests/e2e/firstUseGuidance.spec.ts` exercises the English and Spanish tour
through its Settings launcher. Scratchpad execution remains automatic: the tour
explains existing output and its Run sample action starts another execution.
The console step uses the measured translated card height and a transparent
input shield inside the spotlight. Its screenshot and geometry assertions
check that the explanation stays above the output. Back and Escape remain
covered alongside error-to-success recovery. A delayed first runtime chunk
checks that opening Settings again wins focus, the late load cannot close or
cover it, and explicit retry still works in both languages. Component regressions
separately control the editor-readiness wait and shared chunk-load promise.

Inline result overlays keep right alignment on short lines. When the source
would intersect the result, or the source wraps, a Monaco view zone reserves a
row below the source. Model line numbers stay unchanged. Until the next run
replaces them, results and rows follow their source through edits, and results
on deleted lines are dropped. A run that clears results keeps the rows reserved
while it is in flight, then releases the rows its results did not reuse. Tests
cover resizing, horizontal scrolling, offscreen retention, edits, run start and
finish, and cleanup; the browser spec checks
a long error line and recovery. The existing `sourceCoordinates.spec.ts` owns
user-first errors and collapsed runtime stacks, including keyboard disclosure.
It also checks every bundled worker URL frame stays inside that disclosure;
unnamed V8 `at async URL` frames must not be mistaken for external sources.
The shared parser removes that syntactic prefix only before a URI or absolute
path, preserves displayed stack text and ambiguous relative filenames, and
leaves unknown external frames visible. A real worker-source-mapper unit test
compares named and unnamed async forms of its trusted probe location.

The three existing E2E shards retain their full inventory and failure traces.
A narrow first-use screenshot upload also runs on successful jobs; inspect
those screenshots before calling a visual change verified. Passing component
geometry tests alone does not establish visual correctness or native first use.

The website release tests distinguish desktop and terminal products independently
of architecture. They cover the committed public release snapshot, explicit
Windows/Linux ZIP targets and CLI ZIP retention beside a desktop DMG. Run the
standalone website check and production build with its own npm lockfile; use
`LINGUA_SOURCE=local` only for the build, not the fetch-contract tests. Verify
both `/releases/` and `/es/releases/` in a supported running preview. Installer
execution, unsigned-Windows prompts and absent/offline toolchains are separate
native checks; these tests do not download or execute release assets.

Inline-result geometry measurements run in one coalesced animation frame after
Monaco model/layout events. `getOffsetForColumn` forces a render and must not
run during a synchronous selection update. The layout component suite covers
that transaction boundary, stale frame/event/ResizeObserver callbacks after
replacement or disposal, and view-zone-generated layout events. Hosted
source-coordinate, captured-error and console-batching journeys retain the
zero-console-error check as the real-renderer regression gate.
