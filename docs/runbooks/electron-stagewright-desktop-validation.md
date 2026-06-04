# Electron Stagewright desktop validation

Use this runbook when a Lingua change must be checked in the real Electron
shell but does not need the full native-language smoke matrix.

## What this covers

Electron Stagewright is an MCP server for driving real Electron apps with
agent-native tools: launch, accessibility snapshots, semantic find/click/type,
expect-style assertions, screenshots, native dialogs, and renderer console logs.
Lingua uses it as the first desktop UI check because it gives agents structured
state without falling back to pixel clicking.

Keep `pnpm run smoke:desktop` for the heavier full-runtime gate: JS, TS, Python,
Go, Rust, timeout/env-isolation cases, offline checks, and packaged-release
coverage.

## Local setup

The Electron Stagewright package is not published yet, so this repo points at
Johnny's local checkout:

```bash
pnpm --dir "$HOME/Personal/github/electron-stagewright" \
  --filter @electron-stagewright/core build
```

Codex user MCP config is set in `~/.codex/config.toml`:

```toml
[mcp_servers.electron-stagewright]
command = "node"
args = [
  "/abs/path/to/electron-stagewright/packages/core/dist/cli.js",
  "--screenshot-dir",
  "/abs/path/to/lingua/output/stagewright/screenshots"
]
```

The repo root also has:

- `.mcp.example.json` — tracked template for MCP-compatible hosts.
- `.mcp.json` — ignored local config with the same working absolute paths.

If the checkout moves, update `~/.codex/config.toml` and the local `.mcp.json`,
or run the smoke with:

```bash
ELECTRON_STAGEWRIGHT_CLI=/abs/path/to/electron-stagewright/packages/core/dist/cli.js \
  pnpm run smoke:desktop:stagewright
```

## Scripted MCP smoke

```bash
pnpm run smoke:desktop:stagewright
```

The script:

1. Rebuilds Lingua's Electron main/preload bundles for `http://localhost:5174/`.
2. Starts the renderer Vite server unless `--reuse-server` is passed.
3. Starts the `electron-stagewright` MCP server over stdio.
4. Launches Lingua through `electron_launch`.
5. Verifies `#root` is visible, takes an interactive accessibility snapshot,
   captures a screenshot, and fails on renderer console errors.
6. Writes artifacts under `output/stagewright/desktop-smoke/`.

Useful variants:

```bash
pnpm run smoke:desktop:stagewright -- --reuse-server
pnpm run smoke:desktop:stagewright -- --renderer-url http://localhost:5174/
pnpm run smoke:desktop:stagewright -- --timeout-ms 90000
```

## Agent-driven UI checks

When the MCP tools are available in a future Codex session, prefer this flow:

1. Start from `pnpm run smoke:desktop:stagewright` unless you need ad hoc
   tool calls; the script owns main/preload sync plus the renderer dev server.
   For manual MCP sessions, mirror that setup before launching.
2. Launch from the repo root so Electron reads `package.json#main` and app
   metadata:
   `electron_launch({ main: "/abs/path/to/lingua", cwd: "/abs/path/to/lingua", env: { LINGUA_RENDERER_URL: "http://localhost:5174/" } })`.
3. Inspect with `electron_snapshot` or `electron_find` before interacting.
4. Prefer `electron_expect_*` tools over manual read/compare/retry loops.
5. End every pass with `electron_console_logs({ type: "error" })`.
6. Always call `electron_stop` in cleanup.

If Stagewright cannot reach the flow because it requires the renderer's existing
desktop-smoke bridge or native runtime matrix, fall back to `pnpm run
smoke:desktop`.
