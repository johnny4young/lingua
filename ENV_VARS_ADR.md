# ADR — Environment variables for execution contexts (RL-011)

| Status | Accepted — design; Slices A / B / C / D-Go shipped |
| ------ | ----------------- |
| Decision | Add a tab-overrides-project-overrides-global env-var stack for desktop child-process runners (Go, Rust, Python). JS/TS Worker mode and the web build remain env-var free. |
| Date | 2026-04-20 |
| Implementation start | Slice A (pure merger), Slice B (store + snapshot bridge shell), Slice C (Settings UI for all three tiers + trace preview), and Slice D first increment (Go compile IPC receives the merged user env, `GOOS`/`GOARCH` stay runner-owned) have shipped. Rust and Python subprocess integration each follow as their own slice. |

## Slice D — final merge order (2026-04-20 ter)

The Go compile path is the first runtime to consume the merged env end-
to-end. The merge order lives in `resolveGoCompileEnv` in
`src/main/go-compiler.ts` and is this, in order of increasing
precedence:

1. `process.env` (host — comes in via the main process, not via
   preload; preserves credentials and machine-specific values).
2. The user-space record composed by `useEnvVarsStore.resolveEffectiveEnv`
   in the renderer (global → project → tab).
3. Runner-owned keys (`GOOS=js`, `GOARCH=wasm` for Go) — these
   **cannot** be overridden by the user env. Writing them in the user
   tier is allowed (the Slice A validator lets them through) but they
   get dropped during this final merge so the WASM build never breaks
   silently.

Non-string user values are dropped defensively at this step even though
`envVarsStore` already rejects them up front.

### Rust (shipped 2026-04-20 quater)

`resolveRustRunEnv` in `src/main/rust-compiler.ts` follows the same
two-tier merge — `process.env` underneath, user env on top — with one
intentional difference from Go: **there are no runner-owned keys**.
Rust's toolchain knobs are plain env vars (`RUSTC_WRAPPER`,
`RUSTFLAGS`, `CARGO_HOME`, etc.) that users legitimately want to set,
so we let them win over host values. The resolved env is passed to
both `execFileAsync('rustc', ...)` (compile tier) and
`spawn(binaryFile, ...)` (runtime tier) so the Rust program reads the
same env via `std::env::var` that the compiler saw.

Python's turn is the next slice and lives on its own IPC path —
Pyodide runs in the renderer, not via subprocess, so the env hands
off through a worker boot message rather than a spawn option.

## Context

RL-011 has been parked since the original plan because it required
three scoping decisions written down before any implementation
slice could land:

1. **Which runtimes receive env vars in desktop mode.**
2. **Which env vars (if any) exist in web mode.**
3. **Whether env vars are tab-scoped, project-scoped, or global.**

This ADR answers all three so the implementation slices can ship
without re-litigating the policy in every PR.

## Decisions

### 1. Runtimes that receive env vars

| Runtime | Receives env? | Why |
|---------|----------------|-----|
| Go (`go build` + WASM) | **Yes** — host-set env vars are forwarded to `go build` and merged into the WASM execution context where Go's `os.Getenv` can read them | Go users routinely depend on `GOOS`, `GOARCH`, `CGO_ENABLED`, `GOPROXY` |
| Rust (`rustc` + native subprocess) | **Yes** — env merged into `rustc` invocation and the spawned binary | Crates use env-driven build switches (`RUSTC_WRAPPER`, `RUSTFLAGS`); user code reads via `std::env::var` |
| Python (Pyodide Worker) | **Partial** — env exposed to Pyodide's `os.environ`-like shim, **not** propagated to the host process | Pyodide is in-renderer; there is no child process to propagate to. We surface the same dict so user snippets behave consistently across desktop and web |
| JavaScript Worker | **No** — Workers cannot read host env, and exposing `process.env` would be a misleading polyfill | Plan-explicit: "JS/TS Worker mode does NOT receive env" |
| TypeScript Worker | **No** — same as JS Worker | Same reason |

The IPC handlers in `src/main/go-compiler.ts` and
`src/main/rust-compiler.ts` already accept an env object via
`execFile`'s options; the renderer-side runners are the only side
that needs new code.

### 2. Web mode

**No env vars in web mode.** The browser sandbox has no host env
to read, and inventing a `window`-scoped polyfill would diverge
from the desktop semantics for the same code. The web adapter
will surface env-var attempts as `web-unavailable` (matching the
existing pattern for gofmt / rustfmt / crash reporter).

Pyodide on web does still get the user's typed env dict — that's
a renderer-only concept and works in both shells.

### 3. Scope: tab > project > global

Three tiers that merge with **tab > project > global** precedence:

- **Global** (`settingsStore.envVars`) — persisted across sessions,
  shipped to every runner that accepts env. The default for "set
  `RUST_BACKTRACE=1` everywhere".
- **Project** (`projectStore.envVars`) — persisted per project (only
  when a project is open). The default for "this repo's `GOPROXY`".
- **Tab** (`editorStore.tabs[i].envVars`) — ephemeral, lives only as
  long as the tab. The default for "I want to test what happens if
  `DEBUG=1` for one run."

A runner sees the **merged** env at execution time:

```
finalEnv = { ...processEnv, ...global, ...project, ...tab }
```

Tab keys override project, project keys override global, global
keys override the host env. Empty string is a real value (it
unsets the inherited variable for that run, matching POSIX
shell semantics).

The merge happens in a new pure helper
`src/shared/envVarScopes.ts` so renderer + main can reason about
it the same way (the renderer for the UI, main for the IPC
handler that builds the `execFile` options).

## What stays out of this ADR

- **No real implementation in this slice.** The acceptance
  criterion for RL-011 is "scoping decisions written down."
  Code lands in the implementation slices below.
- **No secret-storage UI.** Env vars persist in plain JSON in
  localStorage / on disk. Users who want secrets should use the
  host shell or a vault — Lingua is a scratchpad, not a vault.
  Settings copy MUST flag this explicitly when the UI lands.
- **No `.env` file ingestion** in the first slice. The `.env`
  validate-only mode (RL-058) is editor-only and intentionally
  does not feed the runner env. A future "import .env" button is
  tracked under `Future` follow-ups.
- **No global → project → tab precedence inversion** as a setting.
  The merge order is fixed; a future ADR can revisit if customer
  feedback reveals the inverse is more useful.

## Implementation slices (out of scope for this ADR; tracked here
for the next session)

### Slice A — pure scope merger

- `src/shared/envVarScopes.ts` (new) — types + the
  `mergeEnvScopes(scopes)` pure function. Empty string preserved.
  Unicode key validation (POSIX-name regex). Hard cap at 100 keys
  per scope to keep merge cost bounded.
- `tests/shared/envVarScopes.test.ts` — merge precedence, empty
  string overrides, key validation, cap enforcement.

### Slice B — settings + project + tab plumbing

- Extend `settingsStore` with `envVars: Record<string, string>` +
  `setEnvVar`, `unsetEnvVar`, `clearEnvVars` actions.
- Extend `projectStore` with the same shape, persisted alongside
  the project's other state.
- Extend `editorStore.FileTab` with optional `envVars`. Tab
  envVars do not survive a save → restore (they are ephemeral
  per the scope decision).
- Extend `runners/manager.ts` to call `mergeEnvScopes` at
  `execute(...)` time and pass the merged env to runner-specific
  IPC handlers.

### Slice C — Settings UI

- New `EnvVarsSection` in Settings, with a key/value table for the
  global tier and an explanatory secret-storage warning.
- Project tier surfaces in the project settings drawer (when one
  exists); fall back to "open a project to define project env
  vars" when no project is open.
- Tab tier surfaces as a small affordance in the editor tab
  context menu; resets on tab close.
- i18n: every label, every column header, every warning copy goes
  through `i18next.t()` and lands in both en + es.

### Slice D — Honest web-mode limit

- Web adapter stub returns `web-unavailable` for any IPC the
  envVars feature needs (none today, but the future implementation
  will read `window.lingua.go` / `.rust` / `.python` configs which
  the web stub already returns the correct error for).

## Verification matrix (for the implementation slices, not this ADR)

After Slice B + C ship:

1. Define a global env var `DEMO=global` and a tab env var
   `DEMO=tab`. Run the active tab — expect Go/Rust/Python to see
   `DEMO=tab` (tab wins).
2. Define `EMPTY=''` at the tab tier. Confirm the runner does
   **not** see `EMPTY` from the host process — the empty value
   masks the inherited variable.
3. Open the web build and try to define an env var — expect the
   Settings UI to render but the runner-side notice to surface
   "desktop only".
4. Define an invalid key (`123FOO`, `WITH SPACE`, etc.) and
   confirm the validator rejects it before persistence.
5. Run `npm run desktop:smoke` to confirm Go and Rust still
   execute correctly when no env vars are defined (regression
   protection for the merge plumbing).

## When to revisit

Open a successor ADR when **any** of these becomes true:

1. A customer needs the inverse precedence (global > project > tab).
2. Secret-storage demand grows beyond the current "Lingua is a
   scratchpad" boundary — at that point a proper vault integration
   ADR is the right path, not bolting it onto envVars.
3. Pyodide ships native `os.environ` parity that requires a
   different shim than today's renderer-injected dict.
4. WebContainers (RL-029) ship and grow a real Node environment in
   the browser — that flips the web-mode answer.

## Cross-links

- `BUILD_SYSTEM_ADR.md` — unchanged. Stay-on-Forge means env
  forwarding goes through the existing `execFile` IPC path.
- `CAPABILITY_MATRIX.md` — env vars become a new row in the
  shell-feature matrix when Slice C ships ("Hybrid: desktop-native
  for child processes, renderer-only for Pyodide").
- `LANGUAGE_PACK_ADR.md` — RL-038 Slice A's `LanguagePack` already
  carries the runtime-deps array; Slice B can hang an
  `acceptsHostEnv: boolean` capability flag on the same descriptor
  if needed.
- `PLAN.md` RL-011 — flips from `Planned` to `Partial` once this
  ADR lands, with the implementation slices unblocked.

## Reviewers

- First recorded decision: 2026-04-20.

Future revisits leave a dated entry rather than overwrite, so the
history of why each scope decision was made stays auditable.
