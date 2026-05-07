# Development workflow

This file collects the contributor-facing workflow for Lingua: clone, run, test, smoke, build, and ship from a local checkout. The repo's product overview, requirements, and licensing summary live in [`README.md`](../README.md). End-user product reference (keyboard shortcuts, deep links, plugin format) lives in [`USAGE.md`](./USAGE.md).

## Quickstart

```bash
git clone https://github.com/johnny4young/lingua.git
cd lingua
npm install
npm run dev:desktop
```

For browser-only iteration, use:

```bash
npm run dev:web
```

Renderer architecture notes:

- The editor shell is split so Monaco theme registration, editor option construction, and the empty-state surface live in focused modules instead of one oversized `CodeEditor` file.
- The explorer shell is split so recursive tree rendering, inline creation input, and the no-project surface live in focused `FileTree` modules instead of one monolithic component file.
- The command palette delegates command construction/filtering and result-list rendering to focused modules, keeping the modal container centered on interaction state instead of catalog assembly.
- The project store delegates pure file-tree shaping and mutation helpers to a dedicated module, leaving the Zustand store focused on project lifecycle, file-system IPC, and watch-state transitions.

## Configuration env vars

Renderer + main-process build-time variables Lingua reads. The renderer keys are substituted into the bundle by Vite at build time; main-process keys are read by `defineConfig` at config-load time. See `vite.web.config.mts`, `vite.renderer.config.mts`, and `vite.main.config.mts` for the wiring.

| Name                                 | Scope          | Purpose                                                                                                         |
| ------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------- |
| `VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK` | renderer build | Ed25519 public key (JWK JSON) the app uses to verify paid-tier licenses. Missing key keeps every build on Free. |
| `VITE_LINGUA_TELEMETRY_URL`          | renderer build | HTTPS endpoint that receives redacted telemetry events when the user has opted in. Unset disables telemetry.    |
| `VITE_LINGUA_TELEMETRY_DISABLED`     | renderer build | Set to `1` to disable telemetry regardless of user choice.                                                      |
| `LINGUA_CRASH_REPORTER_URL`          | main runtime   | Minidump submission endpoint. Unset disables crash reporting.                                                   |
| `LINGUA_CRASH_REPORTER_DISABLED`     | main runtime   | Set to `1` to disable crash reporting regardless of user choice.                                                |

Use [`.env.example`](../.env.example) as the safe template for local overrides. Never commit private keys, API tokens, signing certificates, webhook secrets, or real customer license tokens.

## Quality checks

```bash
npm run lint
npm run check:i18n
npm run check:i18n:copy
npm test
npx tsc --noEmit
npm run build:web
npm run smoke:desktop
```

These are the main local verification commands. CI also runs the changelog/version guard, the third-party license policy gate, and a high-severity `npm audit`; release runs add exact release-tag changelog validation, the production-only blocking audit, plus SBOM/license artifact generation.

## i18n contributor workflow

- Locale files live in `src/renderer/i18n/locales/<language>/`. The current source locale is `src/renderer/i18n/locales/en/common.json`.
- Add new user-facing copy with stable semantic keys such as `settings.title`; do not use raw English sentences as keys.
- Resolve translated text at render/use sites with `t(...)` or shared i18n helpers instead of storing translated labels in config/state objects.
- Keep these values non-localized in the current MVP: code samples, generated file names, language ids, plugin ids, and similar internal identifiers.
- Command palette discoverability stays language-aware: localize labels/descriptions, but keep English aliases in keyword lists when they help search.
- Spanish copy uses **neutral Latin American Spanish — tuteo** (`Pega`, `Copia`, `necesitas`, `puedes`), never rioplatense voseo (`Pegá`, `Copiá`, `necesitás`, `podés`). See [`AGENTS.md`](../AGENTS.md) for the full register guide.

Verification commands:

```bash
npm run check:i18n
npm run check:i18n:copy
```

What they enforce:

- `check:i18n` fails on invalid locale JSON, missing translation keys, and orphaned keys relative to the English source locale.
- `check:i18n:copy` inspects touched `src/renderer/**/*.ts(x)` files and flags obvious hardcoded JSX copy or literal UI attributes such as `title`, `aria-label`, and `placeholder`.

## UI smoke test (web)

The most reliable interactive validation path today is the web build:

```bash
npm run build:web
npm exec vite preview -- --config vite.web.config.mts --host 127.0.0.1 --port 4173
```

Then drive the preview with the Playwright CLI wrapper:

```bash
export PWCLI="$HOME/.codex/skills/playwright/scripts/playwright_cli.sh"
"$PWCLI" --session lingua open http://127.0.0.1:4173/
"$PWCLI" --session lingua snapshot
"$PWCLI" --session lingua screenshot --full-page --filename output/playwright/lingua-web-validation.png
```

Desktop-only paths such as native Go/Rust execution, packaged auto-updates, and local plugin discovery still need targeted desktop validation — see the smoke section below.

## Desktop dev and validation

Use the desktop launcher when you need the real Electron app without going through a full `electron-forge start` cycle:

```bash
npm run dev:desktop
```

What it does:

- starts the renderer dev server on the URL expected by the current desktop bundle
- launches the Electron app from the repository root
- shuts the local renderer server down automatically when Electron exits

If `src/main` or `src/preload` changed and the existing `.vite/build` bundle may be stale, resync those artifacts once before launch:

```bash
npm run dev:desktop:sync
```

Useful flags:

```bash
# Reuse an already-running matching renderer server instead of owning it
npm run dev:desktop -- --reuse-server

# Auto-close Electron after a few seconds (useful for smoke automation)
npm run dev:desktop -- --exit-after-ms 4000
```

The launcher avoids rebuilds during normal renderer-focused desktop testing. A resync is only needed when `main` or `preload` code changes, or when `.vite/build` is missing. The Vite configs use `.mts` so the standard dev/build flow stays on Vite's supported ESM config path and avoids the deprecated CJS Node API warning.

If you specifically need the raw Electron Forge boot path, use:

```bash
npm run dev:desktop:forge
```

## Testing Pro locally

Fast paths:

```bash
npm run dev:web:pro
npm run dev:desktop:pro
```

Both commands mint a throwaway dev public key + signed token, print the token to the terminal, and start the target surface with `VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK` already wired in. Copy the token into **Settings → License → Paste a license token** to unlock Pro locally.

`dev:web:pro` binds Vite to port 5174 with `--strictPort`. If that port is already in use, stop the old web server and run the command again; otherwise the printed token would belong to a fresh keypair while the browser might still be pointed at an older server.

The desktop wrapper also forwards the managed-launcher flags you already use on `dev:desktop`:

```bash
npm run dev:desktop:pro -- --sync-main --exit-after-ms 4000
```

If you need the keypair + token as data for CI or a custom local workflow:

```bash
node scripts/mint-dev-license.mjs --tier pro --days 30 > dev-license.json
export VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK="$(jq -r .publicKeyJwk dev-license.json)"
npm run dev:desktop
```

Notes:

- The keypair is session-scoped. Once the dev server stops, the private key is gone — mint again for the next session.
- `--days 0` leaves no remaining support window so you can smoke grace/expiry handling without waiting days for the window to lapse.
- Do not commit `dev-license.json`, and never paste the private key (`privateKeyJwkDoNotShip`) into the app.

## Desktop smoke validation

Use the repeatable Electron smoke workflow when you need a contributor-friendly UI pass instead of ad hoc manual clicks:

```bash
npm run smoke:desktop
```

What it does:

- resyncs `main` and `preload`
- launches the real Electron app against the renderer dev server
- runs a built-in smoke flow across JavaScript, TypeScript, Python, Go, and Rust
- captures per-language screenshots and a JSON summary under `output/playwright/desktop-smoke`

Failure artifacts:

- `output/playwright/desktop-smoke/desktop-smoke-summary.json`
- one screenshot per exercised language

If Go or Rust toolchains are missing locally, the smoke run fails with captured artifacts instead of silently skipping those languages.

Variants:

```bash
# Offline-mode regression (no network)
npm run smoke:desktop:offline

# Packaged-app smoke against out/make/ (release-blocking gate)
npm run smoke:desktop:packaged
```

The packaged variant runs against the actual `Lingua.app` produced by `npm run make:desktop` and is the gate the release workflow runs before publishing artifacts.

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
npm run make:desktop:mac
npm run make:desktop:linux
npm run make:desktop:win
```

Artifacts are written to `out/make/`.

### Web build

```bash
npm run build:web
npm run preview:web
```

The local web build defaults to `/` as its base path. The Cloudflare Pages deployment workflow builds `dist/web` for the subdomain root at `app.linguacode.dev`; `linguacode.dev` remains reserved for the dedicated marketing/download site.

## Automation and delivery

- CI runs web build, type checking, linting, tests, i18n guards, changelog/version guard, third-party license policy, and high-severity audit checks.
- Cloudflare Pages deploy is manual or release-orchestrated via the `Deploy web build to Cloudflare Pages` workflow and serves `app.linguacode.dev` from the root path. Each deploy uploads a `cloudflare-deploy-validation` artifact with the Wrangler log, app-shell check, service-worker update-endpoint bypass check, and `/web/version` response.
- GitHub Release publishing is manual via the `Release` workflow, which accepts a single stable tag input in the form `vX.Y.Z`, creates that tag from `main`, and publishes from it.
- Update server deployment is manual via the `Deploy Update Server` workflow.
- The release workflow runs exact release-tag changelog validation, the production dependency audit, release compliance artifact generation, per-platform build gates, Linux package install/smoke/uninstall validation, checksum generation/re-verification, draft GitHub Release upload, and optional web deploy from the validated release tag.
- Packaged macOS and Windows builds use the desktop updater against the stable GitHub Release channel. Draft update validation must use an isolated update-server deployment with `GITHUB_RELEASE_CHANNEL=draft`, then `npm run check:update-feed -- --base-url <staging-updates> --old-version <previous> --expected-version <target>` to write `output/update-feed-validation/` evidence before promotion.
- The active production release/update channel policy is stable-only; prerelease tags are rejected by the release workflow.

For the full release operator checklist and required secrets, see [`RELEASE.md`](../RELEASE.md). For the public-release security sign-off, see [`docs/RELEASE_SECURITY.md`](./RELEASE_SECURITY.md).
