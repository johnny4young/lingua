# RunLang Project Status

This document tracks the current state of the repository, the main documentation and architecture drift that has accumulated, and the backlog that still matters. It is not the original implementation roadmap anymore.

## Current state

RunLang is already a working multi-language code runner with both desktop and web entry points.

- Desktop shell: Electron Forge with Vite-based main, preload, and renderer builds
- Renderer: React 19, TypeScript, Monaco Editor, Zustand stores, command palette, quick open, settings, and resizable layouts
- Language execution:
  - JavaScript and TypeScript via renderer workers
  - Go via desktop IPC compilation to WebAssembly using a local Go toolchain
  - Python via Pyodide
  - Rust via desktop IPC native compilation and execution using `rustc`
- File system support: open directory, browse tree, read, write, create, rename, delete, and file watching through the preload bridge
- Web support: separate browser entry point with a web filesystem adapter and desktop-only stubs for Go and Rust
- Verification status: the repository currently passes linting, tests, and TypeScript type checking
- Delivery:
  - CI runs type check, lint, tests, and a non-blocking audit
  - GitHub Pages deploys the web build after successful `main` branch CI
  - Tagged releases build desktop packages and publish to GitHub Releases

## Documentation and architecture drift

The repository had a large mismatch between the previous planning document and the implemented code. The main confirmed issues were:

1. Stack versions in the old plan no longer matched `package.json`.
   - The prior document described Electron 40, TypeScript 5.9, Vite 7, and Vitest 4.
   - The current repository uses Electron 41.1.0, TypeScript 5.7.x, Vite 5.4.x, and Vitest 3.x.

2. The old folder structure description was partially stale.
   - Some listed files no longer exist exactly as described.
   - Some implemented areas, such as the web adapter split and plugin example support, were missing or underspecified.

3. Keyboard shortcut documentation was wrong.
   - The previous docs listed `Cmd/Ctrl+J` for toggling the console.
   - The current implementation uses `Cmd/Ctrl+\`.

4. The README referenced a screenshot asset that does not exist in the repository.

5. The old phase-based roadmap still marked large portions of the implemented application as pending.
   - Base scaffolding, editor integration, resizable layout, settings, runners, IPC filesystem support, tests, web build, and release workflows are already present.

6. Plugin support exists as infrastructure, but not as a fully generalized product feature.
   - There is a plugin registry and a bundled Lua runtime.
   - The main type system and editor flow still center on the built-in language union.
   - This means plugin support should be described as partial infrastructure, not as finished extensibility.

## Real backlog

These are the meaningful pending areas that still deserve engineering attention.

### Release and delivery

#### Release pipeline hardening

Objective:
Make tagged releases reproducible, signed where applicable, and operationally auditable.

Current state:
- [release.yml](/Users/johnny4young/Personal/github/run-lang/.github/workflows/release.yml) builds macOS, Windows, and Linux artifacts on tag push.
- [forge.config.ts](/Users/johnny4young/Personal/github/run-lang/forge.config.ts) already wires macOS notarization and Windows signing inputs through environment variables.
- GitHub publishing is configured through `@electron-forge/publisher-github`.

Gaps:
- The macOS artifact path is currently ZIP-only because the DMG toolchain was not stable under the current local toolchain.
- The final tagged-release path still needs to be exercised in GitHub Actions with real secrets and certificates.

Requirements:
- Apple Developer account and notarization setup
- `APPLE_ID`
- `APPLE_ID_PASSWORD`
- `APPLE_TEAM_ID`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_CERT_P12_BASE64`
- `APPLE_CERT_PASSWORD`
- Windows signing certificate and password
- `WIN_CERT_FILE`
- `WIN_CERT_PASSWORD`
- GitHub token with release publishing permissions

Planned approach:
1. Keep the workflow preflight validation and artifact verification steps in place.
2. Keep GitHub Releases as draft-first until signing and verification are proven stable with live CI credentials.
3. Validate the full tagged-release path in GitHub Actions with real secrets.

Likely files:
- [release.yml](/Users/johnny4young/Personal/github/run-lang/.github/workflows/release.yml)
- [forge.config.ts](/Users/johnny4young/Personal/github/run-lang/forge.config.ts)
- [README.md](/Users/johnny4young/Personal/github/run-lang/README.md)
- a new release operations document if the checklist outgrows the README

Acceptance criteria:
- A tagged release fails fast when signing secrets are missing or malformed.
- macOS and Windows jobs report whether signing/notarization actually ran.
- Release artifacts are attached to a draft GitHub Release only after successful platform builds.
- The repository documents the required secrets and operator expectations.

#### Auto-update

Objective:
Move from “update checks are enabled in packaged builds” to a documented, testable update system.

Current state:
- [src/main/index.ts](/Users/johnny4young/Personal/github/run-lang/src/main/index.ts) calls `update-electron-app` only in packaged builds.
- The release workflow already publishes to GitHub Releases, which is a plausible update source.
- Windows packaging uses Squirrel, which is the most update-friendly target in the current setup.

Gaps:
- There is no explicit verification step for update behavior in CI or release validation.
- Packaged update behavior still needs to be validated against real GitHub Release artifacts.

Requirements:
- Decide supported update platforms, with Windows as the likely first production target
- Decide release channels: stable only, or stable plus prerelease
- Decide user experience for:
  - automatic periodic checks
  - manual “check for updates”
  - “restart to apply update”
- Confirm GitHub Releases remain the intended update source

Planned approach:
1. Keep the main-process updater module and IPC bridge as the stable implementation path.
2. Keep the renderer update UI limited to the current supported packaged desktop platforms.
3. Validate packaged update behavior against the chosen stable release channel.

Likely files:
- [src/main/index.ts](/Users/johnny4young/Personal/github/run-lang/src/main/index.ts)
- a new `src/main/updater.ts`
- [src/preload/index.ts](/Users/johnny4young/Personal/github/run-lang/src/preload/index.ts)
- renderer stores or UI for update status
- [README.md](/Users/johnny4young/Personal/github/run-lang/README.md)

Acceptance criteria:
- Packaged builds expose update lifecycle state to the renderer.
- The UI can surface update-available, downloading, ready-to-restart, and failure states.
- Supported updater platforms are documented conservatively.
- The release process produces artifacts in a format compatible with the chosen updater path.

### Plugin productization

Objective:
Support a conservative local plugin model for language integrations without pretending arbitrary third-party runtime loading is production-ready.

Current state:
- The plugin registry and plugin runner interfaces exist.
- Plugin manifests are discovered from the local plugin install directory through main/preload IPC.
- The Settings UI exposes installed plugin status, diagnostics, and the active install directory.
- The renderer only activates bundled runtimes that correspond to valid installed manifests.
- The bundled Lua runtime is executable through Fengari when a matching local manifest is installed.
- Language detection and some editor affordances now tolerate plugin-provided language ids.

Gaps:
- Plugins still rely on bundled runtimes, not arbitrary third-party code loading.

Requirements:
- Keep plugin scope intentionally narrow:
  - local language manifests are supported
  - arbitrary remote install and arbitrary code loading are out of scope
- Define plugin scope:
  - language runners only, or
  - broader editor/runtime extensions later
- Define plugin package format and loading model
- Define API versioning and compatibility rules
- Define trust and execution boundaries

Planned approach:
1. Keep the manifest-driven local plugin model as the supported scope.
2. Keep bundled runtimes documented conservatively even when they are executable.
3. Revisit broader extension loading only if product requirements expand beyond bundled runtimes.

Likely files:
- [src/renderer/plugins/index.ts](/Users/johnny4young/Personal/github/run-lang/src/renderer/plugins/index.ts)
- [src/renderer/runners/manager.ts](/Users/johnny4young/Personal/github/run-lang/src/renderer/runners/manager.ts)
- [src/renderer/utils/language.ts](/Users/johnny4young/Personal/github/run-lang/src/renderer/utils/language.ts)
- [src/renderer/utils/languageMeta.ts](/Users/johnny4young/Personal/github/run-lang/src/renderer/utils/languageMeta.ts)
- main/preload plugin loading surfaces if plugins are loaded outside the renderer bundle
- tests for plugin loading, compatibility, and failure states

Acceptance criteria:
- A plugin can be installed from a documented local plugin directory and discovered on app start.
- Unsupported or incompatible plugins fail with explicit diagnostics instead of silent breakage.
- The UI can show installed plugins and their enabled/disabled state.
- Plugin language ids flow through tab creation, file detection, editor rendering, and execution without built-in-only assumptions.

### Web build hardening

Objective:
Keep the browser build accurate for GitHub Pages deployment and explicit about desktop-only features.

Current state:
- [deploy-web.yml](/Users/johnny4young/Personal/github/run-lang/.github/workflows/deploy-web.yml) builds and deploys `dist/web`.
- The web build supports JavaScript, TypeScript, Python, and the current bundled plugin UI path.
- Go and Rust are intentionally stubbed in the browser adapter.

Gaps:
- No in-repo implementation gaps remain in this track.

Likely files:
- [deploy-web.yml](/Users/johnny4young/Personal/github/run-lang/.github/workflows/deploy-web.yml)
- [vite.web.config.ts](/Users/johnny4young/Personal/github/run-lang/vite.web.config.ts)
- [src/web/adapter.ts](/Users/johnny4young/Personal/github/run-lang/src/web/adapter.ts)

Acceptance criteria:
- GitHub Pages deploys a working `dist/web` artifact from `main`.
- Go and Rust remain clearly unavailable in browser mode, with intentional messaging instead of broken flows.

### Documentation and maintenance

Objective:
Keep operational documentation synchronized with code and workflows.

Planned approach:
- Keep README shortcuts, commands, and workflow descriptions synchronized with code and GitHub Actions.
- Preserve this file as current state plus backlog rather than letting it drift back into speculative roadmap writing.
- Add documentation checks or a maintenance checklist if drift becomes recurrent.

Acceptance criteria:
- README claims about builds, releases, and updates match code and workflows.
- RELEASE checklist claims match the release workflow and current artifact policy.
- This document remains a status-and-backlog file, not a historical roadmap.

## Suggested delivery order

1. Release pipeline hardening
2. Auto-update
3. Plugin productization
4. Web build hardening and documentation cleanup as supporting work

## Milestone checklist

### Milestone 1: Release pipeline hardening

- [x] Add release workflow preflight checks for required secrets on macOS and Windows
- [x] Make release jobs fail early with clear diagnostics when signing inputs are missing
- [x] Add artifact verification steps after platform builds
- [x] Confirm macOS ZIP artifacts are the intended short-term release format
- [x] Document the current macOS packaging limitation and why DMG is not in the active path
- [x] Keep GitHub Releases draft-first until signing and verification are proven stable
- [x] Document release operator requirements and secrets in repository docs
- [ ] Validate the full tagged-release path in GitHub Actions with real secrets

Exit gate:
- Tagged releases produce verified artifacts and publish a draft GitHub Release without ambiguous signing state.

### Milestone 2: Auto-update foundation

- [x] Decide which platforms officially support auto-update in the first production version
- [x] Decide stable/prerelease channel policy
- [x] Extract updater behavior from [src/main/index.ts](/Users/johnny4young/Personal/github/run-lang/src/main/index.ts) into a dedicated main-process module
- [x] Add preload-exposed updater IPC events and commands
- [x] Add renderer-visible update lifecycle state
- [x] Add a minimal manual “check for updates” action
- [x] Add a minimal “restart to apply update” flow
- [x] Document supported updater platforms conservatively in the README
- [ ] Validate packaged update behavior against the chosen release channel

Exit gate:
- Supported packaged builds can report update state to the UI and complete the intended update flow against real release artifacts.

### Milestone 3: Signed publishing readiness

- [ ] Verify macOS signing identity and notarization flow in CI
- [ ] Verify Windows signing flow in CI
- [x] Add post-build reporting that makes signing/notarization status explicit in workflow logs
- [x] Add checksum generation for release artifacts
- [x] Decide whether release publication should remain draft-only or include a promotion step
- [x] Document the human release checklist for version tagging, validation, and publishing

Exit gate:
- macOS and Windows signing state is explicit, reproducible, and documented for operators.

### Milestone 4: Plugin system productization

- [x] Decide whether plugins are a product goal or remain example-only infrastructure
- [x] Define the plugin manifest format
- [x] Define plugin API versioning and compatibility rules
- [x] Define the trust model for local plugins
- [x] Implement plugin discovery from a fixed local plugin directory
- [x] Add compatibility validation and explicit failure diagnostics for bad plugins
- [x] Generalize any remaining built-in-only UI and editor assumptions
- [x] Add a basic installed-plugins management view
- [x] Add tests for plugin discovery, compatibility failures, and execution routing
- [x] Decide whether the bundled Lua plugin remains a stub or becomes a real backend

Exit gate:
- A documented local plugin can be installed, discovered, shown in the UI, and executed through the supported plugin lifecycle without relying on built-in-only assumptions.

### Milestone 5: Web and delivery cleanup

- [x] Re-validate GitHub Pages deployment after the release/update changes
- [x] Re-check web base-path and asset behavior
- [x] Keep Go and Rust browser behavior explicitly stubbed with clear messaging
- [x] Reconcile README release/update claims with the final implementation
- [x] Reconcile this plan with the final implementation state

Exit gate:
- Documentation, web deployment, and delivery claims all match the implemented system.

## Operating defaults

- Treat this document as an operational status file
- Describe only implemented behavior as current capability
- Record speculative ideas only when they are concrete backlog items
- Keep product claims conservative when a feature is only partially wired
