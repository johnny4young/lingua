# Development workflow

This file collects the contributor-facing workflow for Lingua: clone, run, test, smoke, build, and ship from a local checkout. The repo's product overview, requirements, and licensing summary live in [`README.md`](../README.md). End-user product reference (keyboard shortcuts, deep links, plugin format) lives in [`USAGE.md`](./USAGE.md).

## Quickstart

```bash
git clone https://github.com/johnny4young/lingua.git
cd lingua
pnpm install
pnpm run dev:desktop
```

For browser-only iteration, use:

```bash
pnpm run dev:web
```

Package manager policy: the app, license server, and update server are pnpm-only
(`package.json`, `license-server/package.json`, and
`update-server/package.json`). Use `corepack enable` if your shell does not
already resolve the pinned `pnpm@11.3.0`; do not commit npm or Yarn lockfiles
for those packages. `website/` remains a standalone npm package with its own
`package-lock.json`; use the commands documented in `website/CONTRIBUTING.md`
there.

Renderer architecture notes:

- The editor shell is split so Monaco theme registration, editor option construction, and the empty-state surface live in focused modules instead of one oversized `CodeEditor` file.
- The explorer shell is split so recursive tree rendering, inline creation input, and the no-project surface live in focused `FileTree` modules instead of one monolithic component file.
- The command palette delegates command construction/filtering and result-list rendering to focused modules, keeping the modal container centered on interaction state instead of catalog assembly.
- The project store delegates pure file-tree shaping and mutation helpers to a dedicated module, leaving the Zustand store focused on project lifecycle, file-system IPC, and watch-state transitions.

## Configuration env vars

Renderer + main-process build-time variables Lingua reads. Renderer keys are
substituted into the bundle by Vite at build time; main-process keys are read
by `vite.main.config.mts` through `loadEnv()` at config-load time so packaged
Forge builds see repo-root `.env` / `.env.production` values. See
`vite.web.config.mts`, `vite.renderer.config.mts`, and `vite.main.config.mts`
for the wiring.

| Name                                 | Scope                 | Purpose                                                                                                                                                           |
| ------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_BASE_PATH`                     | web build             | Public base path for the standalone web bundle. Defaults to `/`; Cloudflare Pages deploys `app.linguacode.dev` from `/`.                                          |
| `VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK` | renderer + main build | Ordered Ed25519 verification keyring (one JWK or a JSON array during overlap). Missing or malformed values keep every build on Free / local-verify failure paths. |
| `LINGUA_LICENSE_PUBLIC_KEY_JWK`      | main build            | Main-process alias for the same ordered keyring. `vite.main.config.mts` accepts either this or the `VITE_` form.                                                  |
| `VITE_LINGUA_LICENSE_SERVER_URL`     | renderer + main build | License-server base URL for activation, status, recovery, education, and trial endpoints. Unset keeps web/desktop server sync disabled.                           |
| `LINGUA_LICENSE_SERVER_URL`          | main build + runtime  | Desktop main-process override for the license-server base URL. Dev launchers can set it without rebuilding main.                                                  |
| `VITE_LINGUA_UPDATE_SERVER_URL`      | web renderer build    | Update-server base URL for the web update banner. Defaults to `https://updates.linguacode.dev`.                                                                   |
| `LINGUA_UPDATE_URL`                  | main build            | Desktop update-server base URL baked into the main bundle. Defaults to `https://updates.linguacode.dev`.                                                          |
| `VITE_LINGUA_APP_VERSION`            | renderer build        | App version exposed to telemetry and web update checks. Seeded automatically from `package.json#version`; override only for release tests.                        |
| `LINGUA_WEBSITE_URL`                 | shared build metadata | Optional website URL override for app metadata. Falls back to `package.json#homepage` when present.                                                               |
| `VITE_LINGUA_WEB_RUNTIME_BASE`       | web production build  | Public runtime prefix for oversized DuckDB/Ruby WASM. Defaults to `https://downloads.linguacode.dev/web-runtime`; deploys set it from `R2_PUBLIC_BASE`.           |
| `VITE_LINGUA_TELEMETRY_URL`          | renderer build        | HTTPS endpoint that receives redacted telemetry events when the user has opted in. Unset disables telemetry.                                                      |
| `VITE_LINGUA_TELEMETRY_DISABLED`     | renderer build        | Set to `1` to disable telemetry regardless of user choice.                                                                                                        |
| `LINGUA_CRASH_REPORTER_URL`          | main runtime          | Minidump submission endpoint. Unset disables crash reporting.                                                                                                     |
| `LINGUA_CRASH_REPORTER_DISABLED`     | main runtime          | Set to `1` to disable crash reporting regardless of user choice.                                                                                                  |

Use [`.env.example`](../.env.example) as the safe template for local overrides. Never commit private keys, API tokens, signing certificates, webhook secrets, or real customer license tokens.

## Quality checks

```bash
pnpm run lint
pnpm run check:telemetry-call-sites
pnpm run check:i18n
pnpm run check:i18n:copy
pnpm run check:deadcode
pnpm test
pnpm exec tsc --noEmit
pnpm run check:prod-audit
pnpm run check:bundled-audit
pnpm run build:web
pnpm run smoke:desktop:stagewright
pnpm run smoke:desktop
```

These are the main local verification commands. `check:prod-audit` is the same blocking production-graph advisory gate CI runs on every PR — run it locally to catch a prod `high`/`critical` dependency before pushing. `check:bundled-audit` covers what that gate structurally cannot: `pnpm audit --prod` reads package.json `dependencies` only, while Vite inlines the main and preload graphs, so a devDependency imported by `src/main/**` (today `undici` and `ws`) ships inside the packaged bundle unseen. CI and release also audit the independently locked `license-server`, `update-server`, and `website` production graphs; the root dev-inclusive `pnpm audit` remains advisory. Release runs add exact release-tag changelog validation plus SBOM/license artifact generation.

## Package script reference

`package.json#scripts` is intentionally small and grouped by workflow. Keep
this table in sync when adding or renaming scripts; it is the contributor
reference for what each command owns.

| Script                       | Owns                                                                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dev:web`                    | Browser-only Vite dev server on port 5174.                                                                                                                                                                                           |
| `dev:web:pro`                | Browser dev server plus throwaway signed license token for local Pro UI testing.                                                                                                                                                     |
| `dev:desktop`                | Managed Electron desktop launcher with renderer dev server ownership.                                                                                                                                                                |
| `dev:desktop:sync`           | Desktop launcher after rebuilding/resyncing main and preload artifacts.                                                                                                                                                              |
| `dev:desktop:pro`            | Desktop launcher plus throwaway signed license token for local Pro UI testing.                                                                                                                                                       |
| `dev:desktop:prod`           | Production-mode desktop dev launcher for packaged-env parity checks.                                                                                                                                                                 |
| `build:web`                  | Production web bundle under `dist/web`.                                                                                                                                                                                              |
| `build:cli`                  | Rebuilds the distributable `lingua` CLI bundle.                                                                                                                                                                                      |
| `package:cli`                | Builds and validates the public npm tarball; on Linux/Windows x64 it also emits a native Node single-executable archive, with optional post-injection Authenticode signing on Windows.                                                                                       |
| `check:cli-publication`      | Verifies that a stable release's npm tarball matches its checksum, version, public manifest, repository identity, and exact four-file allowlist without authenticating or publishing.                                                                                       |
| `check:cli-publish-prereqs`  | Uses the authenticated GitHub CLI plus the public npm registry to inspect release immutability, the protected environment and reviewer count, bootstrap-secret presence, and package state without reading secret values or changing external configuration.               |
| `check:windows-signing-prereqs` | Uses the authenticated GitHub CLI to inspect only the names of the two repository secrets required by the Authenticode path, while keeping certificate trust and draft-release verification explicit manual gates.                                          |
| `distribution:status`       | Reads public GitHub/npm state and compares it with the generated Homebrew/winget manifests; emits Markdown, JSON, or bilingual standalone HTML without publishing or changing a registry.                                                                                  |
| `preview:web`                | Serves the latest built web bundle locally.                                                                                                                                                                                          |
| `smoke:project-templates`    | Materializes, installs, and executes every curated multi-file project template, then writes a diagnostic JSON artifact.                                                                                                              |
| `smoke:desktop:stagewright`  | Lightweight Electron Stagewright MCP desktop UI launch/snapshot/console-error smoke.                                                                                                                                                 |
| `smoke:desktop`              | Full desktop smoke flow against the dev server.                                                                                                                                                                                      |
| `smoke:desktop:offline`      | Desktop smoke with non-loopback network requests blocked.                                                                                                                                                                            |
| `smoke:desktop:packaged`     | Release-blocking packaged-app smoke against the host-native app under `out-builder`.                                                                                                                                                 |
| `build:runtime-assets`       | Writes the runtime-asset manifest and lock evidence.                                                                                                                                                                                 |
| `check:runtime-assets`       | Verifies the runtime-asset manifest without writing.                                                                                                                                                                                 |
| `sbom:release`               | Generates release compliance artifacts, including SBOM evidence.                                                                                                                                                                     |
| `check:licenses`             | Enforces the third-party license allowlist.                                                                                                                                                                                          |
| `license:report`             | Regenerates `docs/THIRD_PARTY_LICENSE_REPORT.md`.                                                                                                                                                                                    |
| `compliance:release`         | Regenerates the complete release compliance artifact set.                                                                                                                                                                            |
| `check:release-infra`        | Probes the public R2 web-runtime assets (`R2_PUBLIC_BASE`) for public access + CORS before a release. Desktop release binaries are not stored there.                                                                                 |
| `release:preflight`          | Runs the release-blocking gates locally, CI-faithfully (license rotation with an absent `.env`, R2 readiness, changelog/version, prod audit, licenses, compliance, a fresh production web build before performance, and optional desktop smoke), before dispatching the Release workflow. |
| `check:license-rotation`     | Asserts the embedded verification keyring is registered, ordered, non-drifted, public-only, and that its active key is inside the rotation SLA (`docs/security/license-key-registry.json`).                                          |
| `check:prod-audit`           | Fails closed on a `high`/`critical` advisory in the production dependency graph (`pnpm audit --prod`); runs in PR CI and release.                                                                                                    |
| `check:bundled-audit`        | Fails closed on a `high`/`critical` advisory in a dependency Vite inlines into the packaged main/preload bundle, which `pnpm audit --prod` cannot see; runs in PR CI and release.                              |
| `performance:report`         | Collects bundle/runtime performance measurements.                                                                                                                                                                                    |
| `performance:activation`     | Repeats cold web and desktop activation/first-Run samples and writes median/IQR diagnostics plus current eager runner import evidence.                                                                                               |
| `performance:baseline`       | Rewrites the committed performance baseline from current measurements.                                                                                                                                                               |
| `check:performance`          | Compares current measurements against the committed baseline.                                                                                                                                                                        |
| `changelog:draft`            | Drafts changelog entries from conventional commits.                                                                                                                                                                                  |
| `changelog:check`            | Blocks version/changelog drift before release.                                                                                                                                                                                       |
| `test`                       | Runs the Vitest suite once.                                                                                                                                                                                                          |
| `check:deadcode`             | Complete Knip gate (config in `knip.jsonc`): unreferenced files, unused/unlisted dependencies, unresolved imports, dead exports/types, duplicates, and unexpected binaries. Known host commands used by platform scripts, completion tests, and benchmarks are allowlisted explicitly. |
| `typecheck:tests`            | Scoped `tsc -p tsconfig.test.json` pass that type-checks the branded-id swap-attack compile guard under `tests/` (root `tsc --noEmit` covers `src/**` only).                                                                         |
| `test:e2e:web`               | Runs the Playwright web validation wrapper.                                                                                                                                                                                          |
| `test:smoke:web:license`     | Runs the web license smoke test.                                                                                                                                                                                                     |
| `test:watch`                 | Starts Vitest watch mode.                                                                                                                                                                                                            |
| `lint`                       | Runs ESLint over the repo, then the telemetry call-site audit.                                                                                                                                                                       |
| `check:telemetry-call-sites` | Enforces the typed React telemetry entry point and ratchets the grandfathered lower-level direct-call baseline downward.                                                                                                             |
| `check:i18n`                 | Validates locale shape and key parity.                                                                                                                                                                                               |
| `check:i18n:copy`            | Flags obvious hardcoded renderer copy in touched files.                                                                                                                                                                              |
| `format`                     | Runs Prettier over source, JSON, Markdown, and CSS files.                                                                                                                                                                            |
| `prepare:node-pty`           | Restores executable permissions on node-pty's Unix `spawn-helper`; desktop builds run it automatically before packaging.                                                                                                           |
| `build:desktop-bundles`      | Builds the main/preload/renderer Vite output into `.vite/` for electron-builder to package.                                                                                                                                          |
| `package:desktop`            | Builds an unpacked desktop app (`electron-builder --dir`, ad-hoc signed).                                                                                                                                                            |
| `make:desktop`               | Builds installers for the host platform with electron-builder.                                                                                                                                                                       |
| `make:desktop:mac`           | Builds macOS installers/artifacts (dmg + zip).                                                                                                                                                                                       |
| `make:desktop:linux`         | Builds Linux installers/artifacts (AppImage).                                                                                                                                                                                        |
| `make:desktop:win`           | Builds Windows installers/artifacts (NSIS).                                                                                                                                                                                          |
| `publish:desktop`            | Builds and publishes installers + the auto-update feed to GitHub Releases.                                                                                                                                                           |
| `prepare`                    | Verifies node-pty's Unix helper permissions and rebuilds the CLI bundle after install/pull.                                                                                                                                         |

## i18n contributor workflow

- Locale files live in `src/renderer/i18n/locales/<language>/`. The current source locale is `src/renderer/i18n/locales/en/common.json`.
- Add new user-facing copy with stable semantic keys such as `settings.title`; do not use raw English sentences as keys.
- Resolve translated text at render/use sites with `t(...)` or shared i18n helpers instead of storing translated labels in config/state objects.
- Keep these values non-localized in the current MVP: code samples, generated file names, language ids, plugin ids, and similar internal identifiers.
- Command palette discoverability stays language-aware: localize labels/descriptions, but keep English aliases in keyword lists when they help search.
- Spanish copy uses **neutral Latin American Spanish — tuteo** (`Pega`, `Copia`, `necesitas`, `puedes`), never rioplatense voseo (`Pegá`, `Copiá`, `necesitás`, `podés`). See [`AGENTS.md`](../AGENTS.md) for the full register guide.

Verification commands:

```bash
pnpm run check:i18n
pnpm run check:i18n:copy
```

What they enforce:

- `check:i18n` fails on invalid locale JSON, missing translation keys, and orphaned keys relative to the English source locale.
- `check:i18n:copy` inspects touched `src/renderer/**/*.ts(x)` files and flags obvious hardcoded JSX copy or literal UI attributes such as `title`, `aria-label`, and `placeholder`.

## UI smoke test (web)

The most reliable interactive validation path today is the web build:

```bash
pnpm run build:web
pnpm exec vite preview -- --config vite.web.config.mts --host 127.0.0.1 --port 4173
```

Then drive the preview with the Playwright CLI wrapper:

```bash
export PWCLI="$HOME/.codex/skills/playwright/scripts/playwright_cli.sh"
"$PWCLI" --session lingua open http://127.0.0.1:4173/
"$PWCLI" --session lingua snapshot
"$PWCLI" --session lingua screenshot --full-page --filename output/playwright/lingua-web-validation.png
```

Desktop-only paths such as native Go/Rust execution, packaged auto-updates, and local plugin discovery still need targeted desktop validation — see the smoke section below.

### Refreshing the launch-story gallery

The six screenshot pairs on the marketing home page are not hand-captured. Each
one is a deterministic Playwright artifact: `website/src/data/v1-showcase.json`
names the spec that produces it (`spec`), where that spec writes it (`sources`,
under the gitignored `output/playwright/`), and the renamed copy the site ships
(`images`, under `website/public/screenshots/v1.0/`).

```bash
pnpm run test:e2e:web                           # regenerate every capture
pnpm --dir website run sync:showcase-evidence   # copy into the gallery, record digests
```

Then review the PNG diff and commit the images together with
`website/src/data/v1-showcase.integrity.json`.

`website/tests/v1LaunchStory.test.mts` then asserts the shipped PNGs against
those recorded digests. It needs no evidence, so it runs everywhere, including
the PR gate in `ci.yml` § Website gates.

`pnpm --dir website run check:showcase-evidence` compares the shipped PNGs
against your local evidence. It is machine-local by construction — the evidence
is gitignored, so it is a clean no-op on a fresh clone and in CI.

That verifier was once removed because the captures were not byte-reproducible,
for two distinct reasons, both since fixed:

- **Animations.** The modal's entry fade meant a capture could land at ~99%
  opacity, which shifts high-contrast text pixels by exactly one unit per
  channel — the same page yielded two stable digests. Every evidence spec now
  screenshots with `animations: 'disabled'`, which fast-forwards finite
  animations and freezes infinite ones (there is a `glow-pulse` loop that a
  plain screenshot catches at arbitrary phase).
- **Measured durations.** The notebook cell badge and HTTP response meta render
  real wall-clock numbers that differ every run. Specs pin them through
  `src/renderer/testing/e2eDurations.ts` (an init-script flag the production
  build compiles away) instead of masking pixels or faking the page clock.

Two more sources fell in the same pass: the seeded welcome tab mounts
asynchronously and raced the capture (pinned by
`waitForSeededWorkspaceSettled`), and Playwright parks the pointer on the last
click, leaving hover styling half-applied on a toolbar button (pinned by moving
the mouse to a corner and blurring focus before every capture).

Determinism was then measured, not assumed: 15 consecutive identical digests on
four of the six specs. The Monaco-bearing pair (notebook, HTTP) still flips a
handful of antialiased edge pixels by one unit — Chromium-level rounding that
survived pointer parking, focus blur, and frame settling — so `--check`
compares those within a strict tolerance (at most 24 differing pixels, each off
by at most 2 per channel). A stale gallery differs by thousands of pixels at
full contrast; noise cannot hide drift, and drift cannot pass as noise. If you
add an animation, a timestamp, or any measured value to a captured surface,
re-prove determinism before trusting `--check`.

One trap remains when refreshing: `output/` holds whatever that machine last
generated, which can easily be *older* than what shipped — compare timestamps
before overwriting. To adopt an already-correct gallery without copying
anything, run `pnpm --dir website run record:showcase-evidence`.

Never hand-edit a digest to make the test pass; that turns the lock into a
rubber stamp.

## Curated project template runtime smoke

The structural template tests prove schema, path, license, and catalog
invariants. Use the runtime smoke when changing a curated multi-file scaffold:

```bash
pnpm run smoke:project-templates
```

The runner creates an isolated directory for every catalog entry, writes the
exact files users receive, installs the dependencies declared by the generated
project, and exercises its meaningful path:

- Express and FastAPI start on an ephemeral loopback port and their `/hello`
  responses are checked.
- The Node CLI parses a real `--name` argument.
- The React starter type-checks, builds, and serves through Vite; the compiled
  asset must contain the curated Counter component.
- The Python data starter runs against pandas and checks its computed summary.

Each Python project gets its own virtual environment, and each Node project
gets its own `node_modules`; there is no dependency on Lingua's transitive
packages. The command therefore needs package-registry access and a working
`python3` with `venv`. Override the interpreter with
`pnpm run smoke:project-templates -- --python /path/to/python`.

The machine-readable result is written to
`output/project-template-smoke/project-template-smoke-summary.json`. CI runs
the same command and uploads that artifact even when a template fails, so a red
check includes the install, command, response, duration, stdout, and stderr
needed to reproduce it.

## Desktop dev and validation

Use the desktop launcher when you need the real Electron app without going through a full `electron-forge start` cycle:

```bash
pnpm run dev:desktop
```

What it does:

- starts the renderer dev server on the URL expected by the current desktop bundle
- launches the Electron app from the repository root
- shuts the local renderer server down automatically when Electron exits

If `src/main` or `src/preload` changed and the existing `.vite/build` bundle may be stale, resync those artifacts once before launch:

```bash
pnpm run dev:desktop:sync
```

Useful flags:

```bash
# Reuse an already-running matching renderer server instead of owning it
pnpm run dev:desktop -- --reuse-server

# Auto-close Electron after a few seconds (useful for smoke automation)
pnpm run dev:desktop -- --exit-after-ms 4000
```

The launcher avoids rebuilds during normal renderer-focused desktop testing. A resync is only needed when `main` or `preload` code changes, or when `.vite/build` is missing. The Vite configs use `.mts` so the standard dev/build flow stays on Vite's supported ESM config path and avoids the deprecated CJS Node API warning.

Advanced launcher toggles:

| Name                             | Used by                                           | Purpose                                                                                          |
| -------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `LINGUA_RENDERER_URL`            | `scripts/run-electron-desktop.mjs`                | Default renderer URL when `--renderer-url` is not passed.                                        |
| `LINGUA_ELECTRON_LAUNCHER`       | `scripts/run-electron-desktop.mjs`, desktop smoke | Force Electron launch mode: `direct` or macOS `open` via LaunchServices.                         |
| `LINGUA_DEV_SESSION_SKIP_LAUNCH` | `dev:web:pro`, `dev:desktop:pro`                  | Print the throwaway license material without starting the target app. Useful for scripted tests. |

## Testing Pro locally

Fast paths:

```bash
pnpm run dev:web:pro
pnpm run dev:desktop:pro
```

Both commands mint a throwaway dev public key + signed token, print the token to the terminal, and start the target surface with `VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK` already wired in. Copy the token into **Settings → License → Paste a license token** to unlock Pro locally.

`dev:web:pro` binds Vite to port 5174 with `--strictPort`. If that port is already in use, stop the old web server and run the command again; otherwise the printed token would belong to a fresh keypair while the browser might still be pointed at an older server.

The desktop wrapper also forwards the managed-launcher flags you already use on `dev:desktop`:

```bash
pnpm run dev:desktop:pro --sync-main --exit-after-ms 4000
```

If you need the keypair + token as data for CI or a custom local workflow:

```bash
node scripts/mint-dev-license.mjs --tier pro --days 30 > dev-license.json
export VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK="$(jq -r .publicKeyJwk dev-license.json)"
pnpm run dev:desktop
```

Notes:

- The keypair is session-scoped. Once the dev server stops, the private key is gone — mint again for the next session.
- `--days 0` leaves no remaining support window. For `pro_lifetime`, it
  immediately exercises the non-blocking included-updates-lapsed notice;
  use a time-bound tier such as `pro` to smoke grace/expiry handling.
- Do not commit `dev-license.json`, and never paste the private key (`privateKeyJwkDoNotShip`) into the app.

## Desktop smoke validation

Use the repeatable Electron smoke workflow when you need a contributor-friendly UI pass instead of ad hoc manual clicks:

```bash
pnpm run smoke:desktop:stagewright
pnpm run smoke:desktop
```

`smoke:desktop:stagewright` is the lightweight MCP check for desktop UI
surfaces: it syncs main/preload, launches Lingua through Electron
Stagewright, captures an accessibility snapshot + screenshot, and fails on
renderer console errors. See
[`docs/runbooks/electron-stagewright-desktop-validation.md`](./runbooks/electron-stagewright-desktop-validation.md)
for setup and agent-driven MCP usage.

Use `smoke:desktop` when you need the full native-runtime matrix.

What it does:

- resyncs `main` and `preload`
- launches the real Electron app against the renderer dev server
- runs a built-in smoke flow across JavaScript, TypeScript, Python, Go, and Rust
- captures per-language screenshots and a JSON summary under `output/playwright/desktop-smoke`

The production renderer keeps only a lightweight bridge check for this flow.
The smoke cases and artifact orchestration load after Electron injects the
desktop-smoke bridge. If that runner chunk cannot load or start, the renderer
reports `finish(false)` immediately so CI fails without waiting for the outer
watchdog.

Failure artifacts:

- `output/playwright/desktop-smoke/desktop-smoke-summary.json`
- one screenshot per exercised language

If Go or Rust toolchains are missing locally, the smoke run fails with captured artifacts instead of silently skipping those languages.

Variants:

```bash
# Offline-mode regression (no network)
pnpm run smoke:desktop:offline

# Packaged-app smoke against out/make/ (release-blocking gate)
pnpm run smoke:desktop:packaged
```

The packaged variant runs against the actual `Lingua.app` produced by `pnpm run make:desktop` and is the gate the release workflow runs before publishing artifacts.

Smoke-only environment knobs:

| Name                                   | Purpose                                                                                                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LINGUA_SMOKE_TIMEOUT_MS`              | Overrides the smoke watchdog timeout. Release CI uses this for slow first boot of signed/notarized macOS apps.                                                                      |
| `LINGUA_SMOKE_ARTIFACT_DIR`            | Artifact directory passed from the smoke runner into the Electron app. Defaults under `output/playwright/desktop-smoke`.                                                            |
| `LINGUA_SMOKE_USER_DATA_DIR`           | Artifact-local userData directory set by the desktop and Stagewright smoke harnesses so they do not contend with an already-open installed Lingua.app for the single-instance lock. |
| `LINGUA_DESKTOP_SMOKE_OFFLINE`         | Equivalent to the `--offline` flag; blocks non-loopback network requests in the desktop smoke run.                                                                                  |
| `LINGUA_DESKTOP_SMOKE_PACKAGED_SUBSET` | Internal packaged-smoke subset flag set by `scripts/run-desktop-smoke.mjs`; do not set manually unless debugging that harness.                                                      |

## Shell layout behavior

- The desktop shell persists the resized widths for the sidebar, editor/results split, and editor/console split.
- The explorer sidebar keeps a practical desktop width and uses a larger drag target so the separator remains easy to grab.
- Below the compact shell breakpoint, the sidebar stops compressing the editor and opens as an overlay drawer instead.
- `Cmd+B` / `Ctrl+B` toggles the same sidebar state; in compact mode that means open or close the drawer.
- The compact drawer can also be dismissed by clicking the backdrop, pressing `Escape`, or using the close button.
- Opening a file or switching to an existing tab from the compact explorer closes the drawer so the editor regains the viewport immediately.
- When the compact drawer opens, focus moves to the close button and returns to the previous control after dismissal.
- While the compact drawer is open, keyboard focus stays trapped inside the drawer and the rest of the shell becomes inert; page scrolling stays locked until the drawer closes.
- If the shell widens while the compact drawer is open, the explorer hands focus back into the persistent sidebar and clears the temporary modal state automatically.

## Build commands

### Desktop packages

```bash
pnpm run make:desktop:mac
pnpm run make:desktop:linux
pnpm run make:desktop:win
```

Artifacts are written to `out/make/`.

### Web build

```bash
pnpm run build:web
pnpm run preview:web
```

The local web build defaults to `/` as its base path. The Cloudflare Pages deployment workflow builds `dist/web` for the subdomain root at `app.linguacode.dev`; `linguacode.dev` remains reserved for the dedicated marketing/download site.

Production web builds keep Pyodide same-origin in `dist/web/pyodide/`, but
route oversized DuckDB and Ruby WASM files through
`VITE_LINGUA_WEB_RUNTIME_BASE` because Cloudflare Pages rejects individual
assets above 25 MiB. Local dev leaves that variable unset and Vite serves the
runtime files from `node_modules` / the runtime-asset middleware.

## Automation and delivery

- CI runs web build, type checking, linting, tests, i18n guards, changelog/version guard, third-party license policy, and high-severity audit checks.
- Cloudflare Pages deploy is manual or release-orchestrated via the `Deploy web build to Cloudflare Pages` workflow and serves `app.linguacode.dev` from the root path. Before the Pages upload, the workflow mirrors the versioned DuckDB/Ruby WASM runtime files to the public R2 `web-runtime/` prefix, verifies their CORS headers for `https://app.linguacode.dev`, and fails if any `dist/web` asset remains above the 25 MiB Pages limit. Each deploy uploads a `cloudflare-deploy-validation` artifact with the Wrangler log, runtime-asset evidence, app-shell check, service-worker update-endpoint bypass check, and `/web/version` response.
- GitHub Release publishing is manual via the `Release` workflow, which accepts a single stable tag input in the form `vX.Y.Z`, creates that tag from `main`, and publishes from it.
- Update server deployment is manual via the `Deploy Update Server` workflow.
- The release workflow runs exact release-tag changelog validation, the production dependency audit, release compliance artifact generation, per-platform build gates, Linux package install/smoke/uninstall validation, checksum generation/re-verification, draft GitHub Release upload, and optional web deploy from the validated release tag.
- Packaged macOS, Windows, and Linux builds use electron-updater against the
  stable GitHub Release channel. Drafts receive static manifest/structure checks
  plus manual candidate installation; the real previous-to-current updater
  smoke runs immediately after promotion. See
  `docs/runbooks/desktop-update-draft-validation.md`.
- The active production release/update channel policy is stable-only; prerelease tags are rejected by the release workflow.

For the full release operator checklist and required secrets, see [`RELEASE.md`](../RELEASE.md). For the public-release security sign-off, see [`docs/RELEASE_SECURITY.md`](./RELEASE_SECURITY.md).
