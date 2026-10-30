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

Electron Stagewright is published as `@electron-stagewright/core`, and the
default launch transport needs Playwright available beside it. Match the
upstream MCP-client docs by launching the server with `npx` and both packages:

```toml
[mcp_servers.electron-stagewright]
command = "npx"
args = [
  "--prefix",
  "/tmp",
  "-y",
  "--package",
  "@electron-stagewright/core@0.7.0",
  "--package",
  "playwright@1.64.1",
  "electron-stagewright",
  "--screenshot-dir",
  "/abs/path/to/lingua/output/stagewright/screenshots"
]
```

The `--prefix /tmp` guard keeps `npx` from treating Lingua's transitive
`@playwright/test` dependency as the Playwright peer for the temporary
Electron Stagewright install. Without it, `electron_launch` can fail with
`TRANSPORT_UNSUPPORTED` because `@electron-stagewright/core` cannot resolve
`playwright` from its own package tree.

The repo root also has:

- `.mcp.example.json` — tracked template for MCP-compatible hosts.
- `.mcp.json` — ignored local config with the same working absolute paths.

For Electron Stagewright development, you can still force a local checkout:

```bash
pnpm --dir "$HOME/Personal/github/electron-stagewright" \
  --filter @electron-stagewright/core build

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
3. Starts the `electron-stagewright` MCP server over stdio, pinned to
   `@electron-stagewright/core@0.7.0` and `playwright@1.64.1`.
4. Launches Lingua through `electron_launch` with a mock credential store
   (`--use-mock-keychain` on macOS, `--password-store=basic` on Linux).
5. Verifies `#root` is visible, takes an interactive accessibility snapshot,
   captures a screenshot, and fails on renderer console errors.
6. Writes artifacts under `output/stagewright/desktop-smoke/`.

Useful variants:

```bash
pnpm run smoke:desktop:stagewright -- --reuse-server
pnpm run smoke:desktop:stagewright -- --renderer-url http://localhost:5174/
pnpm run smoke:desktop:stagewright -- --timeout-ms 90000
```

Every Electron launch in `scripts/` takes its switches from
`scripts/lib/electronLaunchArgs.mjs`. Without them, `safeStorage` reads the
real "Electron Safe Storage" keychain item; after an Electron upgrade the new
binary is not in that item's access list, macOS shows an access prompt, and
the main process blocks until someone answers it, so `electron_launch` times
out with no error. A launch that hangs only right after an Electron bump is
that prompt.

## Agent-driven UI checks

When the MCP tools are available in a future Codex session, prefer this flow:

1. Start from `pnpm run smoke:desktop:stagewright` unless you need ad hoc
   tool calls; the script owns main/preload sync plus the renderer dev server.
   For manual MCP sessions, mirror that setup before launching.
2. Launch from the repo root so Electron reads `package.json#main` and app
   metadata. Also pass the repo's Electron binary, because the published MCP
   server runs from an `npx` temp install rather than Lingua's `node_modules`:
   `electron_launch({ main: "/abs/path/to/lingua", executablePath: "$(node -p 'require(\"electron\")')", cwd: "/abs/path/to/lingua", args: ["--use-mock-keychain"], env: { LINGUA_RENDERER_URL: "http://localhost:5174/" } })`.
   On Linux pass `--password-store=basic` instead (see the keychain note above).
3. Inspect with `electron_snapshot` or `electron_find` before interacting.
4. Prefer `electron_expect_*` tools over manual read/compare/retry loops.
5. End every pass with `electron_console_logs({ type: "error" })`.
6. Always call `electron_stop` in cleanup.

If Stagewright cannot reach the flow because it requires the renderer's existing
desktop-smoke bridge or native runtime matrix, fall back to `pnpm run
smoke:desktop`.

## Gallery capture: Project tests

The site gallery shows the Tests tab from a real desktop run, so its evidence
comes from this flow rather than a web spec.

1. Create a small Vitest project outside `/tmp` (temp roots are blocked) with
   its own `git init`, so the status bar shows its branch instead of Lingua's,
   and one failing test.
2. Write `{"version":1,"roots":["<project path>"]}` to
   `<userData>/filesystem-approvals.json` and launch with
   `LINGUA_SMOKE_USER_DATA_DIR=<userData>`. Use `http://localhost:5174/` as the
   renderer URL; the dev server listens on `::1` only.
3. Open the project and run all tests. Selecting the failing case opens its
   assertion with the failure card; for the gallery shot, close the card and
   open the source under test instead. Capture at 1440 px wide in English and
   Spanish.
4. Scale each capture to 1440 × 879, save it to
   `output/stagewright/project-tests/project-tests-{en,es}.png`, copy it over
   `website/public/screenshots/v1.0/`, and run
   `npm --prefix website run record:showcase-evidence`.
