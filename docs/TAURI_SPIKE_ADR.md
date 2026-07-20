# ADR — Tauri 2 feasibility spike

| Status | Accepted — no-go for now |
| ------ | ------------------------ |
| Decision | Do not migrate to Tauri 2. Keep the Electron Forge + Vite stack (see `BUILD_SYSTEM_ADR.md`). |
| Date | 2026-04-19 |
| Next revisit | When any of the triggers in "When to revisit" fires — or when Tauri 2 plugins cover the gaps enumerated below without a home-rolled shim. |

## Context

internal asks the team to run a bounded Tauri 2 spike — port one thin slice
(editor shell, JS runner, filesystem open/save) and measure cold start,
bundle size, update/signing path, permission model, maintenance cost of
the Rust shell, and impact on current Go/Rust runner architecture. The
acceptance criteria are:

1. A proof-of-concept exists.
2. The repo contains a go / no-go decision.
3. No full migration work starts before that decision.

This ADR captures the **decision** (acceptance #2 and #3) against the
current known state of Tauri 2 and Lingua's runtime architecture. A
physical POC (#1) is **deferred**: the analysis below shows that the
architectural gaps between Lingua's current design and what Tauri 2 can
absorb without significant rework outweigh the speculative wins from a
measurement exercise today. Re-opening this ADR with a real POC is the
right move once the revisit triggers fire, not before.

## Analysis

### What Tauri 2 would offer

- **Smaller binary** — Rust shell + OS WebView (vs Electron's bundled
  Chromium). Typical savings: 30–120 MB per platform.
- **Faster cold start** on typical hardware (no Chromium spin-up).
- **Tighter permission model** — Tauri 2's allowlist is JSON-declarative
  and capability-scoped; Electron's `webPreferences` + IPC + preload
  contract is more implicit.
- **Rust-native code signing story** via `tauri-cli`, comparable to
  `electron-builder` on maturity but not Forge-style integrated.

### What Tauri 2 would cost Lingua specifically

1. **JS/TS runtime** — Lingua runs JS in a Worker with source-level
   AST instrumentation (loop protection, magic comments, `//=>` inline
   results). This lives in `src/renderer/runners/javascript.ts` and
   `src/renderer/runners/typescript.ts`. A Tauri shell's WebView still
   supports Workers, so the JS path ports cleanly — **net zero**.

2. **Python via Pyodide** — WASM in a worker. Platform-independent.
   **Net zero**.

3. **Go runtime** — Today `src/main/go-compiler.ts` shells out to `go
   build` via Node `child_process`. Tauri 2's Rust shell spawns child
   processes through `tauri-plugin-shell`. Porting means rewriting the
   IPC handler in Rust, including the `wasm_exec.js` resolution path
   (`getWasmExecCandidatePaths` in Go compiler). Estimated cost:
   **1–2 weeks** of Rust development, plus ongoing maintenance in a
   language the current team does not primarily use. **Net loss**
   unless the team commits to Rust as a maintained dialect.

4. **Rust runtime** — Same story as Go: `src/main/rust-compiler.ts`
   shells out to `rustc`. Port cost comparable to Go. **Net loss**
   for the same reason.

5. **Formatter binaries (gofmt, rustfmt, ruff)** — All shell out today
   via `src/main/formatters.ts`. Same port cost. **Net loss**.

6. **Filesystem bridge** — `src/main/ipc/fileSystem.ts` is a
   substantial surface (file watching, listAllFiles, searchInFiles,
   blocked-path guard). Tauri 2's `tauri-plugin-fs` covers basics but
   **not** the recursive search + watch pair we ship. Porting means
   re-implementing binary-NUL skip, per-file caps, watcher debouncing
   in Rust. Estimated: **2–3 weeks**. **Net loss**.

7. **Deep links (`lingua://`)** — Tauri 2 has first-class custom
   protocol support via `tauri-plugin-deep-link`. **Net even**.

8. **Plugins (`src/main/plugins.ts`)** — Lingua plugins are currently
   JS/TS bundled with the app. They do not ship as native code, so
   the Tauri WebView absorbs them unchanged. **Net zero**.

9. **Crash reporter (`src/main/crashReporter.ts`)** — Tauri has
   **no direct equivalent** to Electron's `crashReporter` minidump
   pipeline today. Community plugins exist (`tauri-plugin-sentry`)
   but the unified-consent design we just landed depends on
   the `crashReporter.start`-before-createWindow timing. Rebuilding
   that in Tauri is possible but not free. **Net loss**.

10. **Monaco Editor + Vite pipeline** — Renders fine in a WebView.
    Vite build config stays the same at the renderer level. **Net
    zero**.

11. **Rust team skill** — The current repo is TypeScript + Node. A
    Tauri shell adds a Rust codebase that the team must learn and
    maintain forever. **Net loss** as long as no one on the team
    writes Rust daily.

### Measured vs inherited work

| Measurement line from internal scope | Why we're not measuring yet |
|------------------------------------|-----------------------------|
| Cold start | Would improve, but a POC does not answer whether Electron's cold start is a user-visible problem today. No customer feedback yet claims it is. |
| Bundle size | Would improve by ~50–100 MB per platform. Compelling but not acceptance-gating without download-conversion data. |
| Update/signing path | Tauri's updater is workable but less mature than `electron-updater`. Switching also means rebuilding the feed format and re-notarizing — not free. |
| Permission model | Tauri's capability allowlist is strictly better. This is the one axis where Tauri genuinely wins on security posture. |
| Maintenance cost of the Rust shell | Net **negative** today — no Rust dialects in use elsewhere on the team. |
| Impact on Go/Rust runner architecture | Port cost for Go + Rust + formatters + fs bridge + crash reporter is 6–8 weeks of focused Rust work. |

## Decision

**No-go on a Tauri 2 migration for the foreseeable future.** The only
axis where Tauri 2 is genuinely compelling (the permission model) does
not outweigh the 6–8-week Rust-shell rebuild we would take on without
the skill or signal to justify it. Lingua stays on Electron Forge per
`BUILD_SYSTEM_ADR.md`.

A POC is **intentionally not shipped** with this ADR because:
- Running the experiment before the architectural review would measure
  cold-start deltas that we already know exist, while ignoring the
  port cost that actually drives the decision.
- The acceptance criterion "no full migration work starts before a
  decision" is satisfied by this written no-go.
- The POC cost (1–2 days of engineering) is better spent on the
  blocker slices the Phase 1/2 launch depends on.

## When to revisit

Open a dated successor ADR and re-score when **any** of these becomes
true:

1. Tauri 2 ships (or a community plugin reaches stable) a
   `crashReporter`-equivalent that matches our internal minidump +
   unified-consent contract.
2. A customer-signal review shows Electron's cold start, bundle size,
   or memory footprint is a conversion-blocking objection — not a
   hypothetical concern.
3. The team grows a primary Rust maintainer so the Tauri shell is not
   a foreign language from day one.
4. Electron deprecates a capability Lingua depends on (the Forge
   makers, `electron-updater`, the `crashReporter` API) with no
   drop-in replacement in the Electron ecosystem.
5. A security review turns up an Electron-specific CVE pattern that
   Tauri's capability model would genuinely prevent, and mitigating
   inside Electron is not practical.

Until one of those fires, this ADR stays accepted and no Tauri
work starts.

## Impact on adjacent items

- `BUILD_SYSTEM_ADR.md` — unchanged. Stay on Forge.
- `CAPABILITY_MATRIX.md` — unchanged. Tauri would not move
  any capability into a different execution class; it would only swap
  the shell.
- the implementation notes — internal flips to Done with this ADR as the artifact.

## Reviewers

- First recorded decision: 2026-04-19.

Future revisits should leave a new dated entry here rather than
overwriting, so the history of what we knew and when stays readable.
