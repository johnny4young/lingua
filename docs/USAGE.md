# Usage reference

End-user reference for running Lingua: keyboard shortcuts, deep links, plugin format, browser-vs-desktop differences, update behavior. Contributor-facing setup lives in [`DEVELOPMENT.md`](./DEVELOPMENT.md); the marketing site at [linguacode.dev](https://linguacode.dev) hosts walkthroughs and screenshots.

## Keyboard shortcuts

The Keyboard Shortcuts overlay (Command Palette → `Open Keyboard Shortcuts`) supports search, inline rebinding, preset switching, and JSON export/import for override bundles. Import sanitizes unknown ids, malformed combos, and conflicting bindings before writing to settings.

| Action                  | macOS         | Windows / Linux |
| ----------------------- | ------------- | --------------- |
| Run or stop active file | `Cmd+Enter`   | `Ctrl+Enter`    |
| Save active tab         | `Cmd+S`       | `Ctrl+S`        |
| Close active tab        | `Cmd+W`       | `Ctrl+W`        |
| Toggle sidebar          | `Cmd+B`       | `Ctrl+B`        |
| Toggle console          | `Cmd+\`       | `Ctrl+\`        |
| Quick open              | `Cmd+P`       | `Ctrl+P`        |
| Command palette         | `Cmd+Shift+P` | `Ctrl+Shift+P`  |
| Search in files         | `Cmd+Shift+F` | `Ctrl+Shift+F`  |
| Go to symbol in file    | `Cmd+Shift+O` | `Ctrl+Shift+O`  |
| Settings                | `Cmd+,`       | `Ctrl+,`        |
| Close open overlay      | `Escape`      | `Escape`        |

## Desktop deep links

Packaged desktop builds register the `lingua://` protocol and handle these entry points:

- `lingua://open?file=/absolute/path/to/file.ts`
- `lingua://new?lang=python`
- `lingua://snippet?id=snippet-123`

Notes:

- `open` reuses an already-open tab when the target file is open, otherwise it opens the file from disk.
- `new` creates a fresh tab using the same starter content as the toolbar language actions.
- `snippet` opens the Snippet Library and focuses the matching saved snippet when that id exists locally.
- Web builds expose the same bridge shape internally for consistency, but the OS-level protocol registration is desktop-only.

## Update behavior

- Automatic updates are only active in packaged desktop builds on macOS and Windows.
- Linux desktop builds report updates as unavailable.
- Web builds poll `updates.linguacode.dev/web/version` and show a reload banner when the deployed web tag is strictly newer than the running bundle.
- The renderer exposes update state in Settings and a manual "Check for Updates" command in the command palette, which opens Settings so the current state and message are visible immediately.
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

- JavaScript, TypeScript, and Python ship with Lingua. Go, Rust, desktop Node mode, and system Ruby use binaries installed on the host.
- When a requested desktop toolchain is missing, Lingua shows an installation-guide action and a **Retry detection** action instead of requiring an app restart.
- Retry updates the active runner as soon as the binary becomes available on the desktop app's `PATH`.
- Ruby's `auto` preference quietly keeps using the bundled WASM runtime when system Ruby is absent. The guidance appears when `system` Ruby was explicitly selected.
- Installation walkthroughs live in [Getting started](https://linguacode.dev/docs/getting-started) and its [Spanish version](https://linguacode.dev/es/docs/getting-started).

## Browser-only limitations

- Go compilation stays unavailable in the browser build and returns an explicit desktop-only message.
- Rust compilation stays unavailable in the browser build and returns an explicit desktop-only message.
- Desktop-style automatic updates stay unavailable in the browser build; web update detection uses the hosted version endpoint and reload banner.
- Local plugin discovery stays unavailable in the browser build.
- External file watching stays unavailable in the browser build.

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

  The `lingua_ledger.runs`, `lingua_ledger.capsules`, and `lingua_ledger.daily_activity` tables appear in the schema browser under their qualified names. They are your data: querying, editing, or dropping them is fine — the ledger recreates its schema on the next recorded run.
- Durability follows the SQL workspace's OPFS persistence opt-in (Settings → Editor → SQL workspace). Without it, the ledger lives for the current session only; with it, history survives reloads.
- Retention: the Free tier keeps 7 days of runs (pruned lazily); paid tiers keep everything. `daily_activity` keeps only per-day counters and is never pruned.
- The same Settings card also offers Export JSON (downloads every table) and Clear history (drops the whole schema). Both actions, plus the toggle itself, are logged to the Privacy trust feed.
