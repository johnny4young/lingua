# Usage reference

End-user reference for running Lingua: keyboard shortcuts, deep links, plugin format, browser-vs-desktop differences, update behavior. Contributor-facing setup lives in [`DEVELOPMENT.md`](./DEVELOPMENT.md); the marketing site at [linguacode.dev](https://linguacode.dev) hosts walkthroughs and screenshots.

## Keyboard shortcuts

The Keyboard Shortcuts overlay (Command Palette → `Open keyboard shortcuts`) supports search, inline rebinding, preset switching, and JSON export/import for override bundles. Import sanitizes unknown ids, malformed combos, and conflicting bindings before writing to settings.

| Action                  | macOS         | Windows / Linux |
| ----------------------- | ------------- | --------------- |
| Run or stop active file | `Cmd+Enter`   | `Ctrl+Enter`    |
| Save active tab         | `Cmd+S`       | `Ctrl+S`        |
| Save as                 | `Cmd+Shift+S` | `Ctrl+Shift+S`  |
| Open file               | `Cmd+O`       | `Ctrl+O`        |
| Close active tab        | `Cmd+W`       | `Ctrl+W`        |
| Explorer / tool list / SQL Explorer | `Cmd+B` | `Ctrl+B` |
| Show or hide the dock   | `Cmd+\`       | `Ctrl+\`        |
| Quick open (go to file) | `Cmd+P`       | `Ctrl+P`        |
| Command palette         | `Cmd+Shift+P` | `Ctrl+Shift+P`  |
| Recent commands         | `Cmd+;`       | `Ctrl+;`        |
| Developer Utilities     | `Cmd+K`       | `Ctrl+K`        |
| Search in files         | `Cmd+Shift+F` | `Ctrl+Shift+F`  |
| Replace in files        | `Cmd+Shift+H` | `Ctrl+Shift+H`  |
| Go to symbol in file    | `Cmd+Shift+O` | `Ctrl+Shift+O`  |
| HTTP workspace          | `Cmd+Shift+K` | `Ctrl+Shift+K`  |
| SQL workspace           | `Cmd+Option+S` | `Ctrl+Alt+S`   |
| New notebook            | `Cmd+Option+N` | `Ctrl+Alt+N`   |
| Presenter mode          | `Cmd+Option+P` | `Ctrl+Alt+P`   |
| Settings                | `Cmd+,`       | `Ctrl+,`        |
| Close open overlay      | `Escape`      | `Escape`        |
| Debugger: continue      | `F5`          | `F5`            |
| Debugger: step over     | `F10`         | `F10`           |
| Debugger: step into     | `F11`         | `F11`           |
| Debugger: step out      | `Shift+F11`   | `Shift+F11`     |

The overlay lists every other global default binding (run history, capsules, utilities, and more); the SQL tab's own run, cancel and save keys are listed under SQL workspace below.

`Cmd/Ctrl+P` lists files; on the SQL tab it lists database objects and saved queries first (see Database connections below). `Cmd/Ctrl+B` toggles the project explorer; on a Utilities tab it opens and closes the tool list, which otherwise folds to a 56 px icon rail so the open tool gets the width, and on the SQL tab it folds the SQL Explorer to its 44 px rail. `Cmd/Ctrl+K` opens the tool list with its search focused. In the command palette every result shows its shortcut on the right, `Tab` and `Shift+Tab` jump between groups, and Recent leads the list while the search is empty; while filtering, groups follow their best match.

The run controls sit in the 48 px command bar. **Undock** in its More actions menu turns them into a draggable pill, and **Dock** in the pill's menu puts them back. Hiding the results dock folds it to its tab row; any tab, or `Cmd/Ctrl+\`, opens it again.

On workspace tabs the command bar keeps only the workspace chip, because the run action lives in the tab: `Cmd/Ctrl+Enter` and the tab's own Send or Run button act on that workspace instead of a language runner. The HTTP workspace sends the active request, the SQL workspace runs the statement under the cursor of the active query, and Developer Utilities applies the selected utility to its input. Inside Settings, `Cmd/Ctrl+,` focuses the settings filter instead of closing the dialog, and `Cmd/Ctrl+1`–`9` then `0` open the tabs in rail order: General 1, Appearance 2, Editor 3, Languages 4, Environment 5, Privacy 6, Account 7, Integrations 8, Shortcuts 9 and Recovery 0 (Plugins and Labs have no number). A tab with several sections shows chips under the search bar that jump to a section and follow the scroll.

Go to Symbol reads the active JavaScript or TypeScript file's declaration tree and lists functions, classes, methods, and other named declarations in source order. Other languages currently show the unsupported state instead of a partial outline.

## Sharing a selected code reference

Select code in the editor, then choose **Copy reference** or **Copy with
context** from the editor menu or Command Palette. The same actions are
available on the modified side of a Git diff. They are Free and have no new
default shortcut. With no explicit selection they are disabled.

Copy reference uses a relative file reference (or the tab name for an unsaved
tab) and selected line range. Copy with context adds only the selected code in
a fenced block. Neither action includes an absolute path, other file content,
or a hidden selection. If clipboard permission is denied, Lingua reports the
failure instead of claiming the copy succeeded.

For a reproducible run rather than a source excerpt, use the separate
[Run Capsule → CLI walkthrough](https://linguacode.dev/docs/reproducible-run).
Exporting or validating a Capsule does not execute its source; replay is an
explicit trusted-code action.

## Importing utility pipelines

Developer Utilities → Pipelines imports the complete JSON recipe. If any step
has an unknown utility id or is missing a required field (`id`, `utilityId`,
or an object-valued `options`), import rejects the recipe and names the first
malformed step. It keeps the pasted
JSON available to correct and leaves the saved library and selection unchanged.
A valid empty recipe is allowed. Import does not execute any utility.

Recovery of an already-saved local library remains lenient: malformed or unknown
steps can be dropped while restoring the remaining recipe. Adapter-specific
option defaults and execution-time validation are unchanged.

## Desktop deep links

Released desktop builds register the `lingua://` protocol and handle these entry points:

- `lingua://open?file=/absolute/path/to/file.ts`
- `lingua://new?lang=python`
- `lingua://snippet?id=snippet-123`
- `lingua://license?token=<license token>`

Notes:

- `open` reuses an already-open tab when the target file is open, otherwise it opens the file from disk.
- `new` creates a fresh tab using the same starter content as the toolbar language actions.
- `snippet` opens the Snippet Library and focuses the matching saved snippet when that id exists locally.
- `license` is the button in trial, education, and recovery emails. It opens Settings → Account with the token already in the paste field; nothing is applied until you click **Apply**. Links whose token is not a two-part base64url value are ignored.
- Web builds expose the same bridge shape internally for consistency, but the OS-level protocol registration is desktop-only.

## Update behavior

- Automatic updates are only active in packaged desktop builds: macOS (zip), Windows (NSIS installer), and Linux (AppImage).
- Development builds report updates as unavailable.
- Web builds poll `updates.linguacode.dev/web/version` and show a reload banner when the deployed web tag is strictly newer than the running bundle.
- The renderer exposes update state in Settings and a manual "Check for updates" command in the command palette, which opens Settings so the current state and message are visible immediately.
- Restart-to-apply is only enabled after the main process reports that an update has been downloaded.
- When a desktop update is ready, Lingua also shows a success notice and an update-ready chip in the app chrome; either path points back to Settings → Updates for the restart action.
- The updater currently targets the stable GitHub Release channel only.

## Local plugins

Lingua supports a conservative local plugin model for language integrations:

- Plugin manifests are discovered from the app-local plugin directory at runtime.
- A manifest only enables runtimes that are already bundled with the current build.
- Arbitrary third-party code loading is intentionally out of scope today.
- Invalid, disabled, incompatible, or unsupported plugins are surfaced in Settings with explicit diagnostics.

Current plugin scope:

- Local language plugins are a supported product goal.
- The bundled Lua runtime is executable through Fengari once a local `lua` plugin manifest is installed.

Current install directory:

- Desktop builds discover plugins from `<app userData>/plugins`.
- Web builds keep the plugin surface read-only and do not load local manifests.

Minimal manifest:

```json
{
  "pluginId": "lua",
  "apiVersion": 1,
  "enabled": true,
  "minAppVersion": "0.1.0"
}
```

Manifest rules:

- `pluginId` must be a string and must match a bundled plugin runtime known to this build.
- `pluginId` must follow the safe-identifier pattern: lowercase alphanumeric and hyphens only, starting with an alphanumeric character, max 64 characters. Path-like ids (`..`, `lua/foo`, `.hidden`), uppercase, whitespace, and special characters are rejected.
- `apiVersion` is currently `1`.
- `enabled: false` keeps the plugin installed but inactive.
- `minAppVersion` and `maxAppVersion` gate compatibility against the running app version and must be numeric version strings such as `1`, `1.2`, or `1.2.3`.
- Manifests with extra unknown top-level fields are rejected as `invalid`. The schema is strict by design — only the fields documented above are accepted.

Diagnostic statuses surfaced in Settings → Plugins:

- `loaded` — manifest is valid, runtime is bundled, and the plugin is enabled.
- `disabled` — manifest is valid but `enabled: false`.
- `invalid` — manifest fails the schema (malformed JSON, missing or unsafe `pluginId`, unknown top-level fields).
- `incompatible` — manifest references an unsupported `apiVersion` or an app-version range outside the running build.
- `unknown` — manifest is well-formed, but its `pluginId` is not part of the bundled runtime allowlist for this build.
- `unavailable` — defensive fallback: the manifest claims `loaded` but the build cannot find a matching loader. Should not occur with a healthy build.

The plugin model is intentionally manifest-only. There is no facility to load arbitrary plugin executable code from a manifest; the bundled-runtime allowlist enforces that policy at validation time.

## Native toolchains

- JavaScript, TypeScript, Python, and the WASM Ruby runtime ship with Lingua. Go, Rust, desktop Node, Deno, and Bun modes, and system Ruby use binaries installed on the host.
- When a requested desktop toolchain is missing, Lingua shows an installation-guide action and a **Retry detection** action instead of requiring an app restart.
- Retry updates the active runner as soon as the binary becomes available on the desktop app's `PATH`.
- Ruby's `auto` preference quietly keeps using the bundled WASM runtime when system Ruby is absent. The guidance appears when `system` Ruby was explicitly selected.
- Installation walkthroughs live in [Getting started](https://linguacode.dev/docs/getting-started) and its [Spanish version](https://linguacode.dev/es/docs/getting-started).

## Project test runner

- Open a local project in the desktop app, then choose the flask action in the
  Explorer header or run **Run project tests** from the Command Palette.
- Lingua detects every matching root-level runner in deterministic order:
  Vitest, Jest, Pytest, Go, then Cargo. It shows the exact fixed command and the
  manifest or configuration evidence that triggered each match.
- A configured runner can remain unavailable until its project-local package
  or host toolchain is installed. Use **Detect again** after installing it; no
  app restart is required.
- Select a runner and choose **Run tests**. The first native run asks you to
  acknowledge that the suite and its dependencies execute as ordinary local
  processes. Continue only for projects you trust.
- Output appears while the suite is running. **Stop** terminates the owned
  process tree; Lingua also stops it after five minutes and caps each output
  stream so a noisy suite cannot grow renderer memory without bound.
- Lingua never invokes a shell or accepts a command from the renderer, but this
  is not a sandbox: test code still runs with your user account's filesystem
  permissions. The web build cannot start host processes and says so explicitly.

## Project terminal

- Open a local project in the desktop app, then choose the terminal action in
  the Explorer header, search for **Open project terminal** in the Command
  Palette, or select **Terminal** in the results dock.
- The panel first explains the trust boundary. Choose **Start terminal** to
  launch your default system shell in the approved project root. Opening a
  folder or revealing the panel does not start a shell automatically.
- The session continues while the results dock is hidden. **Clear** removes the
  renderer's current transcript; **Stop** terminates the owned PTY; after exit,
  **New session** starts a fresh shell.
- Lingua chooses an absolute system shell, filters inherited environment
  variables, bounds input and retained output, and stops the session when the
  project closes, the window is destroyed, or the app quits.
- The project root is only the starting directory, not a sandbox. Commands can
  `cd` outside it and access files available to your user account. Run only
  commands and projects you trust. The web build does not expose a local shell.

## Offline status

- The desktop status bar is enabled by default. The web status bar remains opt-in under **Settings → Editor → Show status bar**.
- When the operating system reports that the app is offline, the status bar shows **Offline — everything keeps working**. The segment disappears automatically when connectivity returns and does not raise a toast.
- Hover the segment for the honest boundary: local and cached runtimes keep working, while updates, remote AI, and runtime downloads that are not already cached remain unavailable.
- Lingua's desktop offline smoke validates the bundled JavaScript, TypeScript, and Python paths with non-loopback network access blocked.

## SQL workspace

- `Cmd/Ctrl+Alt+S` opens the SQL tab. The connection bar shows **Local · DuckDB**, the engine that runs in this window, or the query's saved connection (see Database connections below); its picker lists Local under This device. **Import data** at the right of the bar reads a CSV, Parquet or JSON file into a new table, or adds its rows to an existing one.
- The **Explorer** on the left lists Local (in-memory for this session, or persistent when Settings › Editor › SQL workspace keeps tables), its schemas with Tables, Views and Macros, each table's row count and the format it was imported from, and each column's DuckDB type. `information_schema` sits collapsed at the bottom. **Filter objects** narrows the tree and the query lists under it; **Collapse all** folds the tree. Dragging a CSV, Parquet or JSON file over the Explorer shows the drop target, and dropping it opens the same import preview. With no tables, **Try a sample table** creates `cities` (city, orders, revenue) and opens a ready-to-run SELECT.
- `Cmd/Ctrl+B` on the SQL tab folds the Explorer to a 44 px rail (new query, import, history) and back.
- The import preview shows the file's columns, the type DuckDB read for each one and a sample of rows. **New table** takes a name; **Existing table** picks a table and maps each file column onto one of its columns or skips it, matching names first. A CSV also chooses whether its first row is a header and its delimiter (comma, semicolon, tab or pipe), which reads the preview again. Rows added to an existing table are cast to each column's type in one transaction: if one row does not fit, nothing is added, the preview stays open and the notice gives DuckDB's reason.
- Queries open as tabs above the editor. **New query** opens a *scratch* (Scratch 1, Scratch 2…), shown in italics with a dot while it holds text; closing it asks whether to **Save…** or **Discard** it. **Saved queries** sit under the Scratches list in the Explorer, grouped by folder, and save as you type. On Free, each query tab counts toward the 3 open tabs (the SQL tab itself and the saved queries do not), and the tab row says so.
- `Cmd/Ctrl+S` on a scratch opens **Save query** (Name, Folder or a new folder, and the connection it runs on); on a saved query it only confirms that it is saved. `Cmd/Ctrl+Shift+S` (**Save as**) saves a copy that takes the current tab.
- The editor header counts the statements and names the one holding the cursor (*3 statements · cursor in 2*). **Run** and `Cmd/Ctrl+Enter` run the statement under the cursor; its menu adds **Run selection** (`Cmd/Ctrl+Alt+Enter`, only with text selected), **Run all** (`Cmd/Ctrl+Shift+Enter`) and **Explain**. A Run triangle in the gutter runs that line's statement. Statements run one at a time on one connection, so temp tables, settings and transactions carry over, and the run stops at the first one that fails.
- Running several statements gives one result tab each (*Result 2 · 40 rows*) plus **Messages**, which lists every statement with its status, row count and time, and the ones that did not run. These tabs last for the session; the query keeps the last statement's result.
- **Cancel** (`Cmd/Ctrl+.`) asks DuckDB to stop the running statement and shows *Query cancelled*; a statement that runs past the query time limit is stopped the same way. If DuckDB is still busy 5 seconds later, a band offers **Restart the SQL engine**, which stops it but loses in-memory tables, including notebook SQL tables and a session-only Run Ledger.
- A result streams in batches until it reaches the 10,000-row window. When DuckDB had more, the count reads *≥ N rows*, N being the rows DuckDB had already sent, with no second query to count them. **Load N more** shows the next page of rows and, past the window, keeps reading the same stream without running the query again. These rows stay in memory for the session only, up to 100,000 rows, four million cells or 256 MB, whichever comes first; running another statement lets the stream go.
- **Explain** opens the **Plan** tab for the statement under the cursor without changing the query: the operator tree with each operator's time bar and row count, the slowest one highlighted, the total time, the peak memory when DuckDB reports it, and **Copy plan as text**. A statement DuckDB reads as exactly one SELECT is planned with `EXPLAIN ANALYZE`, which runs it; anything else, including a statement that writes, gets the estimated plan only.
- **History** under the saved queries keeps your last 200 runs on this device, across all connections: status, time, duration and up to 4 KB of SQL, never the rows. String literals in `CREATE SECRET`, `ATTACH`, `SET`, `RESET` and `PRAGMA` statements, and literals carrying URL credentials, tokens or account keys, are masked as `'•••'` before a run is kept. **Search SQL** filters it, **Clear history** empties the runs it shows (Settings → Privacy → Local data → Clear everything… empties all of them), and clicking a run opens its SQL in a new scratch without running it.
- Results sit under the editor. A strip names the SQL that produced them: *ran from the editor*, or *generated · opened from* a table you clicked in the Explorer, with **Edit in editor** to take that SELECT into the query. Table, JSON and Profile are tabs; Profile runs a DuckDB column summary of the newest result when you open it. The table mounts only the rows on screen, so a long result scrolls smoothly. Numbers align right, `null` reads in italics, and each header shows the DuckDB type (the Arrow type is in its tooltip). Click a cell or move with the arrow keys, then `Cmd/Ctrl+C` copies that row as JSON and `Enter` opens the value.
- Above the table, **Filter rows…** filters the loaded rows by any cell, **+ condition** adds a column condition (=, ≠, >, ≥, <, ≤, contains, is null, is not null), the sort shows as a chip, and **columns** hides and reorders columns. These work on the rows already loaded; with a source query, the strip below shows the same view as SQL (the query as a subquery with WHERE, ORDER BY and the shown columns), and **Apply to query** takes it into the editor.
- On the SQL tab, `Cmd/Ctrl+P` lists Local's tables and views and your saved queries before files, on the web and the desktop app: `Enter` opens a table's rows or a saved query, and `Alt+Enter` puts a table's quoted name at the cursor.
- Right-clicking a cell (or `Shift+F10` or the Menu key) opens **Filter by this value**, **Exclude this value**, **Copy value**, **Copy row as JSON**, **Copy as INSERT** and **Open in value viewer**. Double-click or `Enter` opens the value viewer (on a cell you can edit with **Edit table rows** on, they edit the cell instead, and the viewer stays in the menu): JSON pretty-printed and read-only, a BLOB with its size, an image preview when it is PNG, JPEG, GIF or WebP, a hex view and **Save as…**.
- A table opened from the Explorer links its foreign-key cells (single-column keys DuckDB declares): clicking one opens the referenced row in that table, with **back to** the table you came from. The value viewer of a row lists **Referenced by** with how many rows of each table point at it, and a click opens them.
- The column rail on the right of the table summarizes each column from the loaded rows, never a second query: null share, distinct count (10,000+ past that), range, and a histogram for numbers and dates or the most frequent values for text. A very wide result is summarized from its first rows, and the header says how many. Clicking a value or a bar (Shift-click extends a bar range) inserts `col = value` or `col BETWEEN low AND high` at the editor cursor, after WHERE or AND. The rail button in the toolbar hides it for the session.
- **Export full result…** writes CSV, TSV, JSON, NDJSON, Markdown, SQL INSERT, XLSX or Parquet, with header row, delimiter and NULL-as-empty options where they apply. When the result came from one read statement and DuckDB had more rows than the grid loaded, **Full result** runs the query again with the grid's conditions, sort and columns (not Filter rows…) and writes every row: DuckDB writes CSV, TSV, JSON, NDJSON and Parquet itself, and Markdown, SQL INSERT and XLSX are read through the result stream, up to one million rows, five million cells or 512 MB (an XLSX sheet holds 1,048,575); a capped export says how many rows it holds. The dialog shows the rows read so far and **Cancel** stops the query. **Loaded rows** writes what the grid holds. Parquet always comes from the query, so it needs one read statement or a table opened from the Explorer. **Copy to clipboard** takes the text formats of the loaded rows, up to 10,000. Its Local hand-offs: **Save as table** re-runs a single read query as `CREATE TABLE … AS`, **Send to Python tab** opens a Python tab with up to 1,000 rows as dicts (an ordinary tab: it counts toward the Free tab limit and is kept with your session), and **Save as run capsule** copies the run's capsule, like `Cmd/Ctrl+Shift+X`.

## Database connections (Labs)

- Turn on **Settings › Labs › Database connections** to run SQL tab queries on Postgres, MySQL, SQL Server, ClickHouse, SQLite, Turso (libSQL), Neon and Cloudflare D1 from the desktop app, and on Turso and Neon in the browser. The connection pill then lists Local under This device, your saved connections with how many Free allows (*Saved · 2 of 3 on Free*), the ones open for this session only, **New connection…**, **Open from URL without saving** and **Manage connections…**. Picking one points the active query at it; the query keeps that connection when you save it.
- On the web build the picker lists Local, the Turso and Neon connections open in this tab under **This tab only**, and a **DESKTOP ONLY** row for the other engines: a browser cannot open a connection to a database server, and Cloudflare's API refuses requests from a browser. **New connection** there offers Turso and Neon and **Open for this tab**: nothing is saved, the token or password stays in the tab's memory, and closing or reloading the tab forgets the connection. Only servers that answer cross-origin requests over HTTPS are reachable, which Turso and Neon do. The picker has no saved count or **Manage connections…** there, and **Test connection** shows TLS, auth and the server.
- **New connection** takes a pasted URL (`postgres://`, `mysql://`, `sqlserver://` or `mssql://` (also the `sqlserver://host:1433;database=…;encrypt=…` form), `clickhouse://`, `libsql://` or `sqlite:/path`) or the fields one by one: engine, name, group, host, port, database, user and password, SSL mode (`disable`, `prefer`, `require`, `verify-ca`, `verify-full`, the default) with optional CA, client certificate and key files, or a SQLite file chosen with **Choose file**. The URL field drops the password once it is in the masked Password field.
- **Save password** keeps it in the system keychain, encrypted, or asks for it once per app session (**Ask each session**); a password typed that way stays in memory until you quit, and a password the server refuses is asked for again. Linux without a keyring only offers Ask each session. A Keychain connection that has no stored password yet, such as an imported one, asks for it when it connects and keeps it in the keychain once it signs in, the SSH password or passphrase of a Keychain tunnel too; a password it refuses is asked for again, and if the keychain cannot store it, it stays for the session. Passwords never reach the connection file, the logs or a capsule.
- **ENV** marks a connection dev, staging or prod; the pill takes its colour. Prod opens read-only unless you change **Read-only** yourself, shows a red band under the bar, and before any statement that writes it asks you to type the connection name, listing every statement of the run that writes, with an EXPLAIN row estimate for the first; on a read-only connection that also lifts read-only for that run only. Read-only is enforced by the server, so a write the app does not recognise is still refused (SQL Server and Cloudflare D1 work differently, see below).
- **Test connection** checks each step and its time: resolve, policy (private and local hosts are allowed unless the connection turns **Allow private host** off; through a tunnel it checks the first SSH hop), TCP, SSH when the connection uses a tunnel, TLS, auth and the server version, or the file for SQLite, with a fix for the step that failed. **Copy diagnostics** copies the report with the hosts, addresses, users, database, files and certificate name replaced, the tunnel's included.
- **Connect through an SSH tunnel** reaches a Postgres, MySQL, SQL Server or ClickHouse server behind a bastion. Sign in with a password, a private key and its passphrase, or the SSH agent; up to three **Jump hosts** come before the bastion and sign in with the key or the agent. The database host is the name the bastion resolves, and the chain from this machine to the database shows under the fields. The sheet says how many keys the agent holds and, when `~/.ssh/config` names the bastion, offers **Use its settings** (host name, user, port, identity file and ProxyJump). The SSH password or passphrase is kept apart from the database password, in the keychain or for the session, and a tunnel that changes asks for both again. The agent is the one `SSH_AUTH_SOCK` names on macOS and Linux, and the Windows OpenSSH agent on Windows (Pageant is not supported).
- Lingua reads `~/.ssh/known_hosts` and `~/.ssh/config` without writing them, and opens a private key from `~/.ssh` only when you pick it, your ssh config names it, or you save a tunnel exactly as the client file you just imported lists it, or from a folder that is not protected. A host key no one knows shows its SHA256 fingerprint in the test report with **Trust this key**; Lingua keeps the keys you trust in its own file and refuses a host whose key changed, including a host that presents a key of another type than the one you know. `@cert-authority` lines are not used, so a host trusted only through an SSH certificate authority shows as unknown, and `Include` and `Match` in the ssh config are not followed. Each database connection gets its own channel through the tunnel; no local port is opened.
- **SQL Server** connects with the user and password of a SQL login. SQL Server runs a whole batch without semicolons and has no read-only transaction, so Lingua counts a batch as a read only when it is one `SELECT` or `WITH` query with no other statement in it; anything else asks for the typed name on a production, read-only or Confirm every write connection. A read-only connection runs proven reads inside a transaction that is always rolled back. This guards against mistakes, not against a determined statement: a login that can only read stays the real guarantee. **Explain** shows the estimated plan (`SET SHOWPLAN_ALL`) without running the statement, and the production confirm estimates rows from it. Opened tables read `SELECT TOP (100)`. Under `verify-ca` SQL Server checks the host name too. A batch that returns several result sets shows the first. Decimal and money values beyond 15 significant digits come back rounded, times keep milliseconds, and `datetimeoffset` values show in UTC.
- **ClickHouse** connects over its HTTP interface: port 8443 with TLS and 8123 without, and the port follows the SSL switch while it is still the default. Databases appear as schemas. Read-only runs with ClickHouse's `readonly = 2`, which the server enforces; statements that return rows stream into the grid and the rest report the rows they wrote. Closing or cancelling a result stops the query on the server. Wide integers and decimals arrive as text. Each run is its own HTTP request, so `USE` and `SET` do not carry to the next run (write the database into the name, or put settings in a `SETTINGS` clause), and a trailing `FORMAT` clause is dropped since the grid reads its own format.
- **Turso (libSQL)** connects over HTTPS to a Turso database or any libSQL server: paste the `libsql://…?authToken=…` URL Turso prints, and the token moves to the masked **Auth token** field. A local server (`sqld`) without auth takes no token; **TLS** Off reaches it over plain HTTP on port 8080, and only at a private or local address, so a token never crosses the internet in clear. A read-only connection asks the server whether SQLite counts the statement as read-only and runs it inside a transaction that is always rolled back.
- **Neon** connects over HTTPS (port 443), through Neon's API host next to your database, so it works where port 5432 is blocked. Pick **Neon** and paste the connection string from the Neon console (a Neon `postgresql://` URL pasted with Postgres picked stays a regular Postgres connection). Only hosts under `neon.tech` are accepted. A read-only connection runs each statement in a read-only transaction the server enforces.
- **Cloudflare D1** (desktop) connects through Cloudflare's API with the **Account ID**, the **Database ID** and an **API token** that can read and edit D1. The API has no read-only mode and runs every statement in the text, so a read-only D1 connection runs one `SELECT`, `WITH` or `VALUES` statement at a time and asks for the typed name for anything else.
- On Turso, Neon and D1 each statement is its own HTTP request: a transaction or setting does not carry from one run to the next, and a result larger than 64 MB is refused, so add a `LIMIT`. They do not go through SSH tunnels.
- **Safety** holds three switches per connection (a SQLite file has no Allow private host): **Read-only**, **Confirm every write** (any statement that writes asks for the typed name, outside production too) and **Allow private host** (off refuses a private or local first address; the HTTP setting is separate).
- **Manage connections…** opens **Connections**: saved connections by group, searchable by name, host, database, group, environment or engine. A row opens the connection to edit; its `⋯` menu has **Edit…**, **Duplicate** (every setting, the tunnel and switches included, named *… copy*, without the passwords, and counting toward Free's limit), **Move to group…** and **Delete** (a second click confirms). **Rename** beside a group renames it for every connection in it. In a group field Enter saves, Escape or leaving the field puts the old name back, an empty name removes the group, and an existing name merges the two.
- **Import** reads connections from **TablePlus** (`Connections.plist`, with its groups), **DBeaver** (`data-sources.json`), **DataGrip** (`dataSources.xml`, with the user and SSL settings in `dataSources.local.xml` beside it), the **.env** files at the open project's root (`.env`, `.env.local`, `.env.development`, `.env.development.local`, `.env.staging`, `.env.production` and `.env.test`; keys such as `DATABASE_URL`, `DIRECT_URL`, `POSTGRES_URL` or `ANALYTICS_DB_URL`; `.env.production` imports as prod and read-only, `.env.staging` as staging, development and local files as dev) or a **Lingua export**. The .env card needs an open project. You pick the file (inside `~/Library/Application Support` or `%APPDATA%`, only the client's own connection files open); Lingua reads hosts, ports, databases, users, groups, environments, SSL and SSH settings, never a password, and never opens DBeaver's credentials file or another app's keychain entries. The preview shows each tunnel's user, bastion and key file, marks connections already saved, keeps to Free's limit, and asks whether passwords go to the **Keychain** or are asked **each session**; each imported connection that signs in with a password asks for it the first time it connects. Engines Lingua does not connect to yet, entries without a host, an absolute file path or a usable SSH user and key, DBeaver values that use variables, DataGrip connections that use a tunnel (its settings live in the IDE's own files), and anything past 500 connections are left out and counted.
- **Export JSON** writes every saved connection to a file you name, without passwords, key passphrases or ids, readable only by your user on macOS and Linux (an overwritten file too); a link is not followed.
- Free keeps 3 saved connections (Local does not count). At the limit the sheet offers **Open without saving** for this session, **Replace a saved one** (deleting one takes a second click, since it also deletes its stored password) and **See Pro**.
- Queries on a connection run statement by statement on that server and show the same grid, Load more, Cancel and History as Local; a write answers with a *Count* row. Profile, **Save as table** and the full-result export run on Local only, so a saved connection's result exports its loaded rows. **Explain** shows the server's own EXPLAIN output as a result instead of the Plan tab. Explain error names the connection's engine. SQLite files in protected folders cannot be opened, even through a link, and a SQLite query cannot attach another file.
- Changing a saved connection's host, port, database, user, file, SSL mode, SSH tunnel or D1 account or database ID without typing the password again forgets the stored password, so it is never sent to a target it was not typed for.
- On a saved connection the Explorer shows that connection's tree instead of Local: its schemas with their object counts, then Tables, Views, Mat. views, Functions, Sequences and Extensions on Postgres, Tables, Views and Routines on MySQL, Tables, Views, Functions and Sequences on SQL Server, Tables, Views and Mat. views on ClickHouse, and Tables and Views on SQLite, Turso and D1 (D1's own `_cf_` tables are left out), with row estimates; Neon shows Postgres's groups. Each level is read when you open it (*loading…* while it reads) and kept for the session; **Refresh** reads it again, as does running DDL on that connection. **Filter objects** searches the schemas already read. A connection that asks for its password each session shows **Enter password** in the tree.
- Selecting an object shows it in the results area: its kind, estimated rows and size, and **Columns** (type, null, default, PK, FK and indexed columns), **Keys**, **Indexes**, **DDL** and **Data** chips, with **Copy DDL**, **Open data** and **SELECT * LIMIT 100** (**SELECT TOP 100 *** on SQL Server), which puts that query in the editor. Data runs the SELECT on the connection and shows it in the same grid, without the foreign-key links Local tables get; it never runs on Local. Functions, procedures, sequences and extensions show their DDL only. Dropping a file on the Explorer imports into Local, so it is off while a connection's tree is shown.
- Format, autocomplete, Ask AI and the grid's view as SQL follow the query's engine: Format uses the engine's formatter, completion quotes names the engine's way (backticks on MySQL and ClickHouse, brackets on SQL Server) and offers its keywords and the connection's tables, columns and functions, and Ask AI names the engine and sends the connection's schema, shown in the consent preview.
- `Cmd/Ctrl+P` on the SQL tab also lists up to 50 tables, views, materialized views, functions and procedures of every connection read so far; every word you type must match. On a table or view, `Enter` opens its data, `Cmd/Ctrl+Enter` its structure and `Alt+Enter` puts its quoted name at the cursor; a function or procedure opens its DDL and inserts its bare name. An object of another connection opens in a new query on that connection.
- History shows the runs of the query's connection (runs from before connections count as Local), names it in its header, clears only those runs, and opens a run as a scratch on the connection it ran on. Saved queries show their connection, *RO* when it is read-only.
- With **Database connections** off in Labs, every query runs on Local, including queries saved against a connection.

## Edit table rows (Labs)

- Turn on **Settings › Labs › Edit table rows** to edit the rows of a table opened from the SQL Explorer, on Local (web and desktop) and on a connection. It is off by default and free. Only a table the Explorer opened is editable, never the result of a query you wrote.
- A bar above the grid names the table and how its rows are found: **PK** and the primary key columns, or **rows by rowid** for a Local table without a primary key. Double-click a cell, or press `Enter` on the selected one, to edit it (Enter or leaving the cell keeps the change, Escape cancels); the cell menu adds **Edit value**, **Set to NULL**, **Duplicate row**, **Delete row** and, on a row marked for delete, **Restore row**; **Duplicate row** copies every column but the primary key, and deleting a new row removes it. **Add row** adds an empty row whose columns show *default* until you type in them, since the table fills them. Changed cells turn amber, deleted rows are struck through and new rows are tinted; the column rail keeps describing the rows as read.
- Nothing is written until **Commit**. **Review SQL** shows the transaction that will run, and **Discard** drops every change. Commit runs every change in one transaction: updates, then deletes, then inserts; updates and deletes find their row by the whole primary key (or rowid). If a statement touches any number of rows but one, because the row changed or was deleted since you read it, nothing is saved, the changes stay staged and the message says which change failed. After a Commit the table is read again.
- Staged edits work on Turso and Neon too: Turso commits them on one stream, and Neon sends them as one transaction that saves nothing when a change misses its row.
- A view, a connection's table without a primary key, every ClickHouse table (its sorting key does not make rows unique, and it has no row-by-row transactions), every D1 table (its API gives no transaction to check each change in), and every table on a read-only or production connection stay read-only, with the reason above the grid. A connection with **Confirm every write** asks you to type its name, listing the statements, before Commit.

## Network from running code (Labs)

- Turn on **Settings › Labs › Network policy for running code** to add **Network from running code** to Settings › Privacy. It is off by default and, until you change it, the policy is **Allow**: nothing changes.
- **Block** refuses network requests from code in the JavaScript/TypeScript worker, Pyodide and Ruby WASM, including work the code leaves running after it finishes: `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `WebTransport`, `WebSocketStream` and `Cache.add` fail with a message that names the host. Block ignores hosts the tab allowed earlier under Ask, and a URL the guard cannot read is refused.
- Under **Ask** or **Block**, code cannot create nested workers (`Worker`, `SharedWorker`), since they would start without the guard.
- **Ask** shows a dialog the first time code in a tab requests a host with `fetch` (JavaScript, or Python `pyodide.http.pyfetch`). The run waits with its timeout paused, and the full timeout starts again once every open question is answered; **Allow in this tab** or **Block** holds for that host in the tab until you reload. Synchronous requests (Python `requests` or `open_url`, any Ruby request) cannot wait, so under Ask they only reach hosts the tab already allowed.
- Every blocked request, and each host you allow from the Ask dialog, appears in Settings › Privacy › Recent activity with the runtime and host only.
- It is a best-effort guard, not a sandbox: an API it does not wrap, such as a dynamic `import()` of a URL or a `FontFace` source, is not stopped, and on the web a rich-output image with a remote `src` still loads in the app window. Pyodide is shared across tabs, so a task code left running applies the next run's policy, and package installs Lingua starts may reach PyPI (`pypi.org`, `files.pythonhosted.org`) while they run. Node, Deno, Bun, Go, Rust and system Ruby on desktop run natively and fall under the native execution acknowledgement (Deno already runs without network access). Ruby is covered only when it runs on Ruby WASM (Settings › Languages › Ruby runtime).

## Browser-only limitations

- Go compilation stays unavailable in the browser build and returns an explicit desktop-only message.
- Rust compilation stays unavailable in the browser build and returns an explicit desktop-only message.
- Desktop-style automatic updates stay unavailable in the browser build; web update detection uses the hosted version endpoint and reload banner.
- Local plugin discovery stays unavailable in the browser build.
- External file watching stays unavailable in the browser build.
- The browser build has no encrypted secret vault: the AI API key and HTTP environment values marked secret stay in the browser's local storage, unencrypted. Desktop encrypts them with the system keychain.

## Browser preview live refresh

- JavaScript and TypeScript tabs using **Browser preview** mode refresh their sandboxed iframe after you pause typing. The default delay is 300 ms.
- Choose **Off**, **300 ms**, or **1 second** in Settings → Editor → Auto-refresh Browser preview. Off keeps the preview manual-only; use Run whenever you want to refresh it.
- Override one tab without changing Settings by placing exactly one of these directives on its first line: `// @preview-refresh off`, `// @preview-refresh 300`, or `// @preview-refresh 1000`.
- A live refresh fully re-evaluates the iframe document. If the new code errors or times out, Lingua keeps the last successful preview visible and reports the failure through the existing result/console surfaces.
- Live refreshes are intentionally silent workflow updates: they do not create execution-history, capsule, or Run Ledger entries.

## Browser file access

- The web build can open local folders through the File System Access API in supported browsers.
- Browser file access supports open, read, write, rename, create, and delete flows.
- File pickers stay scoped to code/text-oriented files so binary formats such as PDFs are not accidentally opened into the editor surface.
- Browser file watching is not available, so external edits are not reflected automatically.

## File watching

- Lingua watches the active project directory for rename, create, and delete events and refreshes the file tree automatically.
- macOS and Windows desktop builds use native recursive watching (FSEvents and ReadDirectoryChangesW). Linux desktop builds use inotify, which has per-user file-descriptor limits — projects with very large `node_modules` trees or many open watchers may exhaust the budget.
- When the watcher fails to start (permission denied, system limit, missing path), Lingua surfaces a status notice in the explorer instead of silently desynchronizing the tree. The notice persists until you dismiss it; the file tree may not refresh automatically until the underlying issue is resolved (commonly: raising `ulimit -n`, fixing folder permissions, or restarting the app).
- A degraded warning appears when the watcher reports a sustained burst of dropped event names (Linux inotify under load). Refresh the file tree manually if it looks stale.
- Web builds do not watch the local filesystem at all; external edits are not reflected.

## Run Ledger (local run history)

- The Run Ledger is an OPT-IN local history of your manual runs, stored in the same DuckDB database the SQL workspace uses, under the `lingua_ledger` schema. Enable it in Settings → Privacy; the Privacy tab shows its activity in the trust feed.
- What gets recorded per manual run (toolbar Run, palette run, SQL, HTTP, utility pipelines — auto-runs are never recorded): language/surface, ok/error status, duration, and a SHA-256 hash of the source (never the source itself). When a run has a capsule, `lingua_ledger.capsules` receives only a metadata summary (capsule id/version/timestamps, language, status, duration, source hash, and its redaction audit); code, stdin, stdout/stderr, errors, diagnostics, rich output, tab names, and Git metadata are never written to the ledger.
- Because it lives in the SQL workspace's database, your history IS a queryable table. Open the SQL workspace and try:

  `SELECT language, count(*) AS runs, avg(duration_ms) AS avg_ms FROM lingua_ledger.runs GROUP BY 1 ORDER BY 2 DESC;`

  The `lingua_ledger.runs`, `lingua_ledger.capsules`, and `lingua_ledger.daily_activity` tables autocomplete in the SQL editor under their qualified names; the Explorer does not list the `lingua_ledger` schema. They are your data: querying, editing, or dropping them is fine — the ledger recreates its schema on the next recorded run.
- Durability follows the SQL workspace's OPFS persistence opt-in (Settings → Editor → SQL workspace). Without it, the ledger lives for the current session only; with it, history survives reloads.
- Retention: the Free tier keeps 7 days of runs (pruned lazily); paid tiers keep everything. `daily_activity` keeps only per-day counters and is never pruned.
- The Run Ledger section in Settings → Privacy also offers Export JSON (downloads every table) and Clear history (drops the whole schema). Settings → Privacy → Local data → Clear everything… also deletes the persisted SQL database, `lingua_ledger` included, along with the SQL queries, open query tabs and run History. Both actions, plus the toggle itself, are logged to the Privacy trust feed.
